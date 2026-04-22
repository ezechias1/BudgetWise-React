import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSync as bcryptHashSync } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function derivePassword(pin: string, memberId: string): string {
  // Supabase requires >= 6 chars. Combine PIN with a slice of the member UUID
  // so two kids with the same PIN don't collide at auth provider level.
  const suffix = memberId.replace(/-/g, "").slice(0, 8);
  return `kid_${pin}_${suffix}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "POST only" });
  }

  try {
    // Verify caller is an authenticated parent via their JWT
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: parent } } = await anonClient.auth.getUser();
    if (!parent) return json(401, { error: "Not signed in" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Reject kids calling this endpoint — contract is "parents create kids"
    {
      const { data: kidRow } = await admin
        .from("family_members")
        .select("id")
        .eq("auth_user_id", parent.id)
        .maybeSingle();
      if (kidRow) return json(403, { error: "Only parents can add kids" });
    }

    const body = await req.json();
    const {
      member_id,
      name,
      pin,
      color,
      age,
      date_of_birth,
    } = body as {
      member_id?: string;
      name?: string;
      pin?: string;
      color?: string;
      age?: number | null;
      date_of_birth?: string | null;
    };

    if (!name || !pin) {
      return json(400, { error: "name and pin are required" });
    }
    if (!/^\d{4}$/.test(pin)) {
      return json(400, { error: "pin must be exactly 4 digits" });
    }

    // Either create a new family_members row or update the one provided
    let memberRow: { id: string } | null = null;
    let createdNewMember = false;

    if (member_id) {
      const { data, error } = await admin
        .from("family_members")
        .select("id, user_id, auth_user_id")
        .eq("id", member_id)
        .eq("user_id", parent.id)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: "Member not found or not owned by caller" });
      if (data.auth_user_id) {
        return json(409, { error: "Member already has credentials" });
      }
      memberRow = { id: data.id };
    } else {
      const { data, error } = await admin
        .from("family_members")
        .insert({
          user_id: parent.id,
          name,
          role: "child",
          color: color || "#8b5cf6",
          age: age ?? null,
          allowance: 0,
          spent: 0,
          earned: 0,
        })
        .select("id")
        .single();
      if (error) return json(500, { error: error.message });
      memberRow = { id: data!.id };
      createdNewMember = true;
    }

    const internalEmail = `kid-${memberRow.id}@budgetwise.app`;
    const password = derivePassword(pin, memberRow.id);
    const pinHash = bcryptHashSync(pin);

    // Create the child's Supabase auth user
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { kind: "child", parent_id: parent.id, member_id: memberRow.id },
    });
    if (userErr) {
      if (createdNewMember) {
        await admin.from("family_members").delete().eq("id", memberRow.id);
      }
      return json(500, { error: userErr.message });
    }

    // Wire the child's auth_user_id back onto the family_members row
    const { error: updErr } = await admin
      .from("family_members")
      .update({
        auth_user_id: userData.user!.id,
        pin_hash: pinHash,
        role: "child",
        date_of_birth: date_of_birth || null,
      })
      .eq("id", memberRow.id);
    if (updErr) {
      if (createdNewMember) {
        // Roll back BOTH: the family_members row and the auth user we just created.
        await admin.from("family_members").delete().eq("id", memberRow.id);
        await admin.auth.admin.deleteUser(userData.user!.id);
      }
      return json(500, { error: updErr.message });
    }

    return json(200, {
      member_id: memberRow.id,
      child_email: internalEmail,
    });
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});

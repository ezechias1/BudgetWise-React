import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// AUDIT Imp #1: bcryptHashSync blocked the V8 isolate at cost-10 for hundreds
// of ms per call, a DoS vector. pin_hash was also never read — real auth goes
// through the derived-password Supabase auth user. Dropping bcrypt entirely.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Origin allowlist — only BudgetWise's own origins can call this endpoint.
// Fixes AUDIT.md C3 (was Access-Control-Allow-Origin: "*" which let any
// website the parent visits call this authenticated function via their JWT).
const ALLOWED_ORIGINS = new Set([
  "https://budget-wise-react.vercel.app",
  "https://budget-wise-ruby.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

function json(origin: string | null, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });
}

function derivePassword(pin: string, memberId: string): string {
  // Supabase requires >= 6 chars. Combine PIN with a slice of the member UUID
  // so two kids with the same PIN don't collide at auth provider level.
  const suffix = memberId.replace(/-/g, "").slice(0, 8);
  return `kid_${pin}_${suffix}`;
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }
  if (req.method !== "POST") {
    return json(origin, 405, { error: "POST only" });
  }

  try {
    // Verify caller is an authenticated parent via their JWT
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: parent } } = await anonClient.auth.getUser();
    if (!parent) return json(origin, 401, { error: "Not signed in" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Reject kids calling this endpoint — contract is "parents create kids"
    {
      const { data: kidRow } = await admin
        .from("family_members")
        .select("id")
        .eq("auth_user_id", parent.id)
        .maybeSingle();
      if (kidRow) return json(origin, 403, { error: "Only parents can add kids" });
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
      return json(origin, 400, { error: "name and pin are required" });
    }
    if (!/^\d{4}$/.test(pin)) {
      return json(origin, 400, { error: "pin must be exactly 4 digits" });
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
      if (error) {
        // AUDIT Imp #2: log detail server-side, return sanitized message.
        console.error("[create-kid-user] lookup member failed", { parent: parent.id, member_id, error });
        return json(origin, 500, { error: "Could not verify member ownership." });
      }
      if (!data) return json(origin, 404, { error: "Member not found or not owned by caller" });
      if (data.auth_user_id) {
        return json(origin, 409, { error: "Member already has credentials" });
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
      if (error) {
        console.error("[create-kid-user] insert member failed", { parent: parent.id, error });
        return json(origin, 500, { error: "Could not create member. Try again." });
      }
      memberRow = { id: data!.id };
      createdNewMember = true;
    }

    const internalEmail = `kid-${memberRow.id}@budgetwise.app`;
    const password = derivePassword(pin, memberRow.id);

    // Create the child's Supabase auth user
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { kind: "child", parent_id: parent.id, member_id: memberRow.id },
    });
    if (userErr) {
      console.error("[create-kid-user] createUser failed", { parent: parent.id, member: memberRow.id, error: userErr });
      if (createdNewMember) {
        await admin.from("family_members").delete().eq("id", memberRow.id);
      }
      return json(origin, 500, { error: "Could not create child account. Try again." });
    }

    // Wire the child's auth_user_id back onto the family_members row.
    // pin_hash intentionally omitted (AUDIT Imp #1 — unused column).
    const { error: updErr } = await admin
      .from("family_members")
      .update({
        auth_user_id: userData.user!.id,
        role: "child",
        date_of_birth: date_of_birth || null,
      })
      .eq("id", memberRow.id);
    if (updErr) {
      console.error("[create-kid-user] link auth_user_id failed", { parent: parent.id, member: memberRow.id, error: updErr });
      // Always delete the freshly-created auth user on rollback to avoid
      // orphans; also clean the family_members row if we created it.
      await admin.auth.admin.deleteUser(userData.user!.id);
      if (createdNewMember) {
        await admin.from("family_members").delete().eq("id", memberRow.id);
      } else {
        // Clear the stale auth_user_id pointer on the existing row.
        await admin
          .from("family_members")
          .update({ auth_user_id: null })
          .eq("id", memberRow.id);
      }
      return json(origin, 500, { error: "Could not finalise child account." });
    }

    console.info("[create-kid-user] ok", { parent: parent.id, member: memberRow.id });
    return json(origin, 200, {
      member_id: memberRow.id,
    });
  } catch (err) {
    console.error("[create-kid-user] unhandled", err);
    return json(origin, 500, { error: "Unexpected error. Try again." });
  }
});

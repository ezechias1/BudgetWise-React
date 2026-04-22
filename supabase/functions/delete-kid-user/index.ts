import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Task #23: deleting a family_members row used to leave the kid's auth.users
// row behind (FK is on delete set null, not cascade). This edge function
// verifies ownership, deletes the auth user first, then the member row.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

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

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }
  if (req.method !== "POST") return json(origin, 405, { error: "POST only" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: parent } } = await anonClient.auth.getUser();
    if (!parent) return json(origin, 401, { error: "Not signed in" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Reject kids calling this endpoint
    const { data: kidRow } = await admin
      .from("family_members")
      .select("id")
      .eq("auth_user_id", parent.id)
      .maybeSingle();
    if (kidRow) return json(origin, 403, { error: "Only parents can delete kids" });

    const body = await req.json();
    const { member_id } = body as { member_id?: string };
    if (!member_id) return json(origin, 400, { error: "member_id is required" });

    // Verify ownership: the caller must own this member's family row
    const { data: member, error: lookupErr } = await admin
      .from("family_members")
      .select("id, user_id, auth_user_id, name")
      .eq("id", member_id)
      .eq("user_id", parent.id)
      .maybeSingle();
    if (lookupErr) {
      console.error("[delete-kid-user] lookup failed", { parent: parent.id, member_id, error: lookupErr });
      return json(origin, 500, { error: "Could not verify member ownership." });
    }
    if (!member) return json(origin, 404, { error: "Member not found or not owned by caller" });

    // Delete auth user first (if any); family_members FK is set-null on
    // auth.users delete, so the member row stays valid while we finish.
    if (member.auth_user_id) {
      const { error: authErr } = await admin.auth.admin.deleteUser(member.auth_user_id);
      if (authErr) {
        console.error("[delete-kid-user] auth.admin.deleteUser failed", {
          parent: parent.id, member: member.id, error: authErr,
        });
        return json(origin, 500, { error: "Could not delete child login." });
      }
    }

    // Now delete the member row. Child tables (kid_ledger, kid_mission_progress,
    // kid_streaks, kid_notifications, kid_devices, family_chores assignments,
    // family_goal_contributions) cascade via FK on member_id.
    const { error: delErr } = await admin
      .from("family_members")
      .delete()
      .eq("id", member.id)
      .eq("user_id", parent.id);
    if (delErr) {
      console.error("[delete-kid-user] delete member failed", {
        parent: parent.id, member: member.id, error: delErr,
      });
      return json(origin, 500, { error: "Could not delete member row." });
    }

    console.info("[delete-kid-user] ok", {
      parent: parent.id, member: member.id, had_auth_user: !!member.auth_user_id,
    });
    return json(origin, 200, { ok: true });
  } catch (err) {
    console.error("[delete-kid-user] unhandled", err);
    return json(origin, 500, { error: "Unexpected error. Try again." });
  }
});

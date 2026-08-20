import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Task #23: deleting a family_members row on its own leaves the kid's
// auth.users row behind — family_members.auth_user_id is ON DELETE SET NULL,
// so the login survives and still authenticates. This edge function verifies
// ownership, clears the two member references that would block the row
// delete, removes the member row, and only THEN destroys the login.
//
// The header used to say "deletes the auth user first, then the member row",
// which was both a description of the code and the reason it lost kids their
// accounts. See the block comment on the ordering below — the sequence is now
// the reverse, and the header is kept in step with it deliberately.
//
// Nothing else needs hand-deleting. Every FK from a public table to auth.users
// is ON DELETE CASCADE, so destroying the kid's login cleans up anything that
// login owned by itself. (This is why the final step is now genuinely
// reachable: it used to fail 23503 for every real kid, because each had a
// user_settings row behind a NO ACTION FK. Those rows are gone and the FK
// cascades.) The member-keyed tables are a separate matter — they hang off
// family_members, not auth.users, and are handled below.

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

    // The order below used to be exactly backwards, and it cost the kid their
    // account. The auth user was deleted first — irreversibly — and the
    // family_members delete that followed then failed on
    // kid_money_requests_member_id_fkey or family_goals_member_id_fkey, which
    // are ON DELETE NO ACTION. (The old comment here claimed every child table
    // cascades. kid_ledger, kid_mission_progress, kid_streaks, kid_devices and
    // family_goal_contributions do; those two do not, and they are the two a
    // real Junior kid actually populates.) The kid was left with no login on a
    // row that could never be removed, and every retry failed identically.
    // So: clear the two blocking references, remove the member row, and only
    // then destroy the login. A kid who still has a login is recoverable; a
    // kid without one is not.
    const { error: reqErr } = await admin
      .from("kid_money_requests")
      .delete()
      .eq("member_id", member.id);
    if (reqErr) {
      console.error("[delete-kid-user] clear money requests failed", {
        parent: parent.id, member: member.id, error: reqErr,
      });
      return json(origin, 500, {
        error: "Could not clear this child's money requests. Nothing was deleted — their login still works.",
      });
    }

    // Goals the kid proposed are rows the PARENT owns (family_goals.user_id)
    // and carry a real saved amount, so detach them instead of deleting them.
    const { error: goalErr } = await admin
      .from("family_goals")
      .update({ member_id: null })
      .eq("member_id", member.id);
    if (goalErr) {
      console.error("[delete-kid-user] detach family goals failed", {
        parent: parent.id, member: member.id, error: goalErr,
      });
      return json(origin, 500, {
        error: "Could not detach this child's family goals. Nothing was deleted — their login still works.",
      });
    }

    // Now the member row. Its remaining children (kid_ledger,
    // kid_mission_progress, kid_streaks, kid_devices, family_goal_contributions)
    // cascade on member_id; family_chores.assignee is set null.
    // `.select("id")` because a delete that matches zero rows returns
    // error: null, and we must not read that as "removed" and then go on to
    // destroy a login the row still points at.
    const { data: deleted, error: delErr } = await admin
      .from("family_members")
      .delete()
      .eq("id", member.id)
      .eq("user_id", parent.id)
      .select("id");
    if (delErr || !deleted || deleted.length === 0) {
      console.error("[delete-kid-user] delete member failed", {
        parent: parent.id, member: member.id, error: delErr, removed: deleted?.length ?? 0,
      });
      return json(origin, 500, {
        error: "Could not delete member row. The child's login was left intact so you can try again.",
      });
    }

    // Only now is the login safe to destroy. Every FK from a public table to
    // auth.users cascades, so this deletes whatever the kid's own login owned
    // along with it. It used to fail 23503 on every real kid — each had a
    // user_settings row behind a NO ACTION FK — which made the branch below
    // the permanent outcome rather than the rare one; both are fixed at the
    // database, so this is now the normal path.
    if (member.auth_user_id) {
      const { error: authErr } = await admin.auth.admin.deleteUser(member.auth_user_id);
      if (authErr) {
        console.error("[delete-kid-user] auth.admin.deleteUser failed", {
          parent: parent.id, member: member.id, error: authErr,
        });
        // The member row really is gone, so the login can no longer reach any
        // data. 207 rather than a 500 the caller would show as "removal
        // failed" for a removal that did happen — and rather than a flat 200,
        // which would claim a clean run. MembersPage treats both as success
        // (`res.ok`), so this changes nothing for the parent while keeping the
        // status honest for anyone reading logs.
        return json(origin, 207, {
          ok: true,
          warning:
            "The child was removed, but their sign-in could not be deleted. It can no longer open anything in the app.",
        });
      }
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

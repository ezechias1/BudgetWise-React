import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT Imp #7 full version: true whole-account purge, for the user's
// "delete everything" flow. The existing "Delete Expenses & Savings" in
// AccountPage is still the scoped option; this one is the nuclear one the
// label always implied.
//
// NOTE: caller must pass their Supabase JWT. Service role is used only
// inside this function for the deletes.
//
// HOW THIS WORKS NOW — read before adding a table back.
// Every foreign key from a public table to auth.users is ON DELETE CASCADE
// (verified live: audit_logs, budgetsmart_usage, clients, custom_categories,
// expenses, family_chores, family_goals, family_groups.owner_id, family_links,
// family_members.user_id, family_pending.requested_by, invoices, kid_ledger,
// kid_mission_rewards, kid_money_requests, kid_notifications, linked_accounts,
// login_events, push_subscriptions, savings_goals, stokvel_contributions,
// stokvel_groups.owner_id, stokvel_members, stokvel_payouts.recipient_id,
// trips, user_settings). The member-keyed tables that have no owner column of
// their own — kid_ledger, kid_mission_progress, kid_streaks, kid_devices,
// family_goal_contributions — cascade from family_members / family_goals, which
// themselves cascade from auth.users. So ONE `auth.admin.deleteUser` removes
// everything, in a single statement, atomically.
//
// That replaces a hand-written 26-table delete loop that had to be kept in
// step with the schema by hand and never was. It named `family_spending`
// (dropped from the database) and scoped three tables by a `user_id` column
// they do not have, so four entries errored on every single invocation, the
// function returned 207 every time, and AccountPage's "purged, signing you
// out" branch was unreachable for every account that ever used this — while
// the other eighteen tables really were deleted. It also missed trips,
// push_subscriptions, kid_money_requests, budgetsmart_usage, family_pending
// and stokvel_payouts entirely, and never touched auth.users at all, so the
// purged email still signed straight back in.
//
// The one thing the cascade cannot reach is a CHILD's login. Kids are tied to
// this account only through family_members, and family_members.auth_user_id is
// ON DELETE SET NULL (the opposite direction). Once the cascade removes the
// member rows those auth users are unreachable orphans that still
// authenticate, so their ids have to be read BEFORE the purge and deleted
// after it. The purge dialog explicitly promises "kid logins".
//
// Known residual hazard, currently unreachable: trips.group_id ->
// family_groups is ON DELETE NO ACTION, the only cross-user NO ACTION FK left
// in the schema. If somebody else's trip ever pointed at a group this caller
// owns, the cascade would raise 23503 and the whole purge would fail — safely,
// with nothing deleted and a named error. Nothing in the app writes
// trips.group_id (NewTrip has name/start_date/end_date only) and no live row
// carries one, so this is documentation, not a gap.

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
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) return json(origin, 401, { error: "Not signed in" });

    const body = await req.json().catch(() => ({}));
    const { confirm } = body as { confirm?: string };
    // Require an explicit typed string to prevent accidental triggers.
    if (confirm !== "PURGE") {
      return json(origin, 400, {
        error: "Missing confirm token. Send { confirm: \"PURGE\" }.",
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Reject Junior kids, same as delete-kid-user does. This matters now that
    // the purge really does delete the caller's auth user: a kid owns almost
    // no rows of their own, so this endpoint would wipe out a login only their
    // parent is allowed to remove and destroy nothing else.
    const { data: kidCaller, error: kidCallerErr } = await admin
      .from("family_members")
      .select("id")
      .eq("auth_user_id", caller.id)
      .limit(1)
      .maybeSingle();
    if (kidCallerErr) {
      console.error("[purge-account] caller check failed", {
        user: caller.id, error: kidCallerErr,
      });
      return json(origin, 500, {
        error: "Could not verify your account. Nothing was deleted.",
      });
    }
    if (kidCaller) {
      return json(origin, 403, {
        error: "A child account cannot purge itself. Ask your parent.",
      });
    }

    // Read the kids' auth ids first. After the cascade the family_members rows
    // are gone and there is no way left to find these logins, so a failure
    // here must abort before anything is destroyed.
    const { data: kidRows, error: kidLookupErr } = await admin
      .from("family_members")
      .select("auth_user_id")
      .eq("user_id", caller.id)
      .not("auth_user_id", "is", null);
    if (kidLookupErr) {
      console.error("[purge-account] kid login lookup failed", {
        user: caller.id, error: kidLookupErr,
      });
      return json(origin, 500, {
        error: "Could not list this account's child logins. Nothing was deleted.",
      });
    }
    // De-duplicated: two member rows sharing one login would otherwise make
    // the second delete report "user not found" and turn a clean run into a
    // 207 that names a login which is in fact already gone.
    const kidAuthIds = [
      ...new Set((kidRows ?? []).map((r) => r.auth_user_id as string).filter(Boolean)),
    ];

    // The account itself. This is the whole purge — one statement, all or
    // nothing. Doing it BEFORE the kid logins is deliberate: if it fails we
    // have destroyed nothing and can say so honestly, whereas deleting the
    // kids first and then failing here would leave children permanently
    // locked out of profiles that still exist — the exact shape of the
    // delete-kid-user blocker.
    const { error: authErr } = await admin.auth.admin.deleteUser(caller.id);
    if (authErr) {
      console.error("[purge-account] auth user delete failed", {
        user: caller.id, error: authErr,
      });
      return json(origin, 500, {
        error:
          `Could not delete your account (${authErr.message}). Nothing was deleted — you are still signed in and your data is intact.`,
      });
    }

    // Everything the caller owned is gone. The orphaned child logins are all
    // that can still fail, and each failure is named so the user can say
    // exactly what survived instead of getting a vague "some data may remain".
    const errors: Record<string, string> = {};
    for (const kidAuthId of kidAuthIds) {
      const { error } = await admin.auth.admin.deleteUser(kidAuthId);
      if (error) {
        errors[`kid login ${kidAuthId}`] = error.message;
        console.error("[purge-account] kid auth delete failed", {
          user: caller.id, kid: kidAuthId, error,
        });
      }
    }

    const ok = Object.keys(errors).length === 0;
    console.info("[purge-account] done", {
      user: caller.id, ok, kid_logins: kidAuthIds.length, errors: Object.keys(errors),
    });
    return json(origin, ok ? 200 : 207, { ok, errors });
  } catch (err) {
    console.error("[purge-account] unhandled", err);
    return json(origin, 500, { error: "Unexpected error. Try again." });
  }
});

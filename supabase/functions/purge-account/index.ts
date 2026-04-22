import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT Imp #7 full version: true whole-account purge, for the user's
// "delete everything" flow. Deletes every user-owned row across every table,
// collects per-table errors, returns a summary. Does NOT delete the auth
// user itself — the existing "Delete Expenses & Savings" in AccountPage
// is still scoped; this one is the nuclear option the label used to imply.
//
// NOTE: caller must pass their Supabase JWT. Service role is used only
// inside this function for the deletes.

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

// Ordered: children before parents (FK dependents first).
// Tables with user_id column directly scoped to the caller.
const TABLES_IN_ORDER: string[] = [
  // Family + stokvel join children
  "family_goal_contributions",
  "stokvel_members",
  "stokvel_contributions",
  // Kid children (also cascade via family_members, but belt-and-suspenders)
  "kid_ledger",
  "kid_mission_rewards",
  "kid_notifications",
  // Family parents
  "family_chores",
  "family_goals",
  "family_groups",
  "family_links",
  "family_spending",
  "family_members", // cascades kid_mission_progress, kid_streaks, kid_devices
  // Stokvel parents
  "stokvel_groups",
  // Business
  "invoices",
  "clients",
  // Personal
  "expenses",
  "savings_goals",
  "linked_accounts",
  "custom_categories",
  // Logs + settings last
  "login_events",
  "audit_logs",
  "user_settings",
];

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
    const errors: Record<string, string> = {};
    for (const table of TABLES_IN_ORDER) {
      const { error } = await admin.from(table).delete().eq("user_id", caller.id);
      if (error) {
        errors[table] = error.message;
        console.error(`[purge-account] ${table} delete failed`, {
          user: caller.id, error,
        });
      }
    }

    const ok = Object.keys(errors).length === 0;
    console.info("[purge-account] done", {
      user: caller.id, ok, errors: Object.keys(errors),
    });
    return json(origin, ok ? 200 : 207, { ok, errors });
  } catch (err) {
    console.error("[purge-account] unhandled", err);
    return json(origin, 500, { error: "Unexpected error. Try again." });
  }
});

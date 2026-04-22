import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT Imp #4: useParentProForKid failed open (treated RLS-blocked reads
// of the parent's user_settings.is_pro as Pro). Safe while Pro system is
// off; unsafe the moment it's flipped on. This function returns the parent's
// is_pro status to a signed-in kid, scoped to the parent they're linked to
// via family_members.

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Look up the kid's family_members row to find their parent's user_id.
    const { data: member, error: memberErr } = await admin
      .from("family_members")
      .select("user_id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (memberErr) {
      console.error("[kid-pro-status] member lookup failed", { caller: caller.id, error: memberErr });
      return json(origin, 500, { error: "Could not verify caller." });
    }
    if (!member) {
      // Caller is a parent (or no role yet). Let them check their own flag too.
      const { data: own } = await admin
        .from("user_settings")
        .select("is_pro, subscription_end")
        .eq("user_id", caller.id)
        .maybeSingle();
      return json(origin, 200, {
        is_pro: own?.is_pro === true,
        subscription_end: own?.subscription_end ?? null,
      });
    }

    const { data: parentSettings, error: settingsErr } = await admin
      .from("user_settings")
      .select("is_pro, subscription_end")
      .eq("user_id", member.user_id)
      .maybeSingle();
    if (settingsErr) {
      console.error("[kid-pro-status] parent settings lookup failed", {
        caller: caller.id, parent: member.user_id, error: settingsErr,
      });
      return json(origin, 500, { error: "Could not read Pro status." });
    }

    return json(origin, 200, {
      is_pro: parentSettings?.is_pro === true,
      subscription_end: parentSettings?.subscription_end ?? null,
    });
  } catch (err) {
    console.error("[kid-pro-status] unhandled", err);
    return json(origin, 500, { error: "Unexpected error." });
  }
});

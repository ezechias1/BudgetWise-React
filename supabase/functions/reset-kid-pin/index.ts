import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Task #22: parent couldn't recover from a kid forgetting their PIN.
// This edge function updates the kid's Supabase auth password (derived from
// the new PIN) so the kid can log in again with a fresh 4-digit code.
// Must stay byte-for-byte identical to derivePassword in
// src/lib/junior-auth.ts and the create-kid-user edge function.

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

function derivePassword(pin: string, memberId: string): string {
  const suffix = memberId.replace(/-/g, "").slice(0, 8);
  return `kid_${pin}_${suffix}`;
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
    if (kidRow) return json(origin, 403, { error: "Only parents can reset kid PINs" });

    const body = await req.json();
    const { member_id, new_pin } = body as { member_id?: string; new_pin?: string };
    if (!member_id || !new_pin) {
      return json(origin, 400, { error: "member_id and new_pin are required" });
    }
    if (!/^\d{4}$/.test(new_pin)) {
      return json(origin, 400, { error: "new_pin must be exactly 4 digits" });
    }

    // Verify ownership + find auth_user_id
    const { data: member, error: lookupErr } = await admin
      .from("family_members")
      .select("id, user_id, auth_user_id")
      .eq("id", member_id)
      .eq("user_id", parent.id)
      .maybeSingle();
    if (lookupErr) {
      console.error("[reset-kid-pin] lookup failed", { parent: parent.id, member_id, error: lookupErr });
      return json(origin, 500, { error: "Could not verify member ownership." });
    }
    if (!member) return json(origin, 404, { error: "Member not found or not owned by caller" });
    if (!member.auth_user_id) {
      return json(origin, 409, { error: "This kid doesn't have a login yet." });
    }

    const newPassword = derivePassword(new_pin, member.id);
    const { error: updErr } = await admin.auth.admin.updateUserById(
      member.auth_user_id,
      { password: newPassword },
    );
    if (updErr) {
      console.error("[reset-kid-pin] updateUserById failed", {
        parent: parent.id, member: member.id, error: updErr,
      });
      return json(origin, 500, { error: "Could not reset PIN. Try again." });
    }

    console.info("[reset-kid-pin] ok", { parent: parent.id, member: member.id });
    return json(origin, 200, { ok: true });
  } catch (err) {
    console.error("[reset-kid-pin] unhandled", err);
    return json(origin, 500, { error: "Unexpected error. Try again." });
  }
});

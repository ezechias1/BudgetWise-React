// Stitch (South Africa open banking) — Link initiation.
//
// Called by an authenticated user from BankPage.tsx's "Add Account" →
// Stitch flow. Returns a hosted Stitch consent-screen URL to redirect to.
// The user completes consent on Stitch's side and is redirected back to
// stitch-oauth-callback with an authorization code.
//
// NOT FUNCTIONAL YET — requires real credentials only the account owner can
// obtain by registering as a Stitch client and getting approved:
//   STITCH_CLIENT_ID      — issued by Stitch
//   STITCH_REDIRECT_URI   — must be registered with Stitch as an allowed
//                           redirect target (this function's deployed
//                           stitch-oauth-callback URL)
//   STITCH_STATE_SECRET   — NOT a Stitch credential; any random value you
//                           generate yourself (e.g. `openssl rand -hex 32`),
//                           used only to sign the anti-CSRF `state` param.
//
// Stitch's exact authorize-endpoint path/scopes below are best-effort from
// public docs as of this writing and were not verified against a live
// Stitch account (this session has no way to do that) — confirm against
// https://stitch.money/docs before relying on this.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const STITCH_CLIENT_ID = Deno.env.get('STITCH_CLIENT_ID') || '';
const STITCH_REDIRECT_URI = Deno.env.get('STITCH_REDIRECT_URI') || '';
const STITCH_STATE_SECRET = Deno.env.get('STITCH_STATE_SECRET') || '';
const STITCH_AUTHORIZE_URL = 'https://secure.stitch.money/connect/authorize';
const STITCH_SCOPES = 'accounts transactions offline_access';

const ALLOWED_ORIGINS = new Set([
  'https://budget-wise-react.vercel.app',
  'https://budget-wise-ruby.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

function json(origin: string | null, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), 'Content-Type': 'application/json' },
  });
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signState(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${base64url(sig)}`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(origin) });
  if (req.method !== 'POST') return json(origin, 405, { error: 'POST only' });

  if (!STITCH_CLIENT_ID || !STITCH_REDIRECT_URI || !STITCH_STATE_SECRET) {
    return json(origin, 501, {
      error:
        'Stitch is not configured yet — STITCH_CLIENT_ID / STITCH_REDIRECT_URI / STITCH_STATE_SECRET missing.',
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return json(origin, 401, { error: 'Not signed in' });

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'family' ? 'family' : 'personal';

    const state = await signState(
      { user_id: user.id, mode, iat: Date.now() },
      STITCH_STATE_SECRET,
    );

    const url = new URL(STITCH_AUTHORIZE_URL);
    url.searchParams.set('client_id', STITCH_CLIENT_ID);
    url.searchParams.set('redirect_uri', STITCH_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', STITCH_SCOPES);
    url.searchParams.set('state', state);

    return json(origin, 200, { authorize_url: url.toString() });
  } catch (err) {
    return json(origin, 500, { error: (err as Error).message });
  }
});

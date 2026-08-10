// Stitch (South Africa open banking) — OAuth callback.
//
// Stitch redirects the user's browser here after they approve the consent
// screen from stitch-link-initiate, with ?code=...&state=.... Verifies the
// signed state, exchanges the code for tokens via a JWT client-assertion
// signed RS256, fetches the account(s) via Stitch's GraphQL API, upserts
// linked_accounts rows, then redirects back into the app.
//
// Unauthenticated — this is hit by a plain browser redirect, not a logged-in
// fetch, so there's no user JWT to verify. Deployed with --no-verify-jwt.
// The state param (signed in stitch-link-initiate) is what proves which
// user this belongs to and stands in for auth here.
//
// NOT FUNCTIONAL YET — requires:
//   STITCH_CLIENT_ID     — issued by Stitch
//   STITCH_PRIVATE_KEY   — RSA private key (PEM), the public half of which
//                          is registered with Stitch for client-assertion
//                          auth (Stitch does not use a plain client_secret)
//   STITCH_STATE_SECRET  — must match the value used in stitch-link-initiate
//   SUPABASE_SERVICE_ROLE_KEY — to write linked_accounts without a user JWT
//
// Stitch's token/GraphQL endpoints and response shapes below are best-effort
// from public docs and were not verified against a live Stitch account
// (this session has no way to do that) — confirm against
// https://stitch.money/docs before relying on this.

import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STITCH_CLIENT_ID = Deno.env.get('STITCH_CLIENT_ID') || '';
const STITCH_PRIVATE_KEY = Deno.env.get('STITCH_PRIVATE_KEY') || '';
const STITCH_STATE_SECRET = Deno.env.get('STITCH_STATE_SECRET') || '';
const STITCH_TOKEN_URL = 'https://secure.stitch.money/connect/token';
const STITCH_GRAPHQL_URL = 'https://api.stitch.money/graphql';
const APP_URL = Deno.env.get('APP_URL') || 'https://budget-wise-ruby.vercel.app';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function base64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyState(
  state: string,
  secret: string,
): Promise<{ user_id: string; mode: 'personal' | 'family'; isBusinessCard: boolean; iat: number } | null> {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlToBytes(sig),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(body)));
  // 10 minute expiry on the link session.
  if (Date.now() - payload.iat > 10 * 60 * 1000) return null;
  return payload;
}

async function buildClientAssertion(): Promise<string> {
  const key = await importPKCS8(STITCH_PRIVATE_KEY, 'RS256');
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(STITCH_CLIENT_ID)
    .setSubject(STITCH_CLIENT_ID)
    .setAudience(STITCH_TOKEN_URL)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${APP_URL}${path}` } });
}

Deno.serve(async (req) => {
  if (!STITCH_CLIENT_ID || !STITCH_PRIVATE_KEY || !STITCH_STATE_SECRET) {
    return new Response('Stitch is not configured yet.', { status: 501 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return redirectTo('/dashboard/bank?stitch_error=missing_code_or_state');
  }

  const verified = await verifyState(state, STITCH_STATE_SECRET);
  if (!verified) {
    return redirectTo('/dashboard/bank?stitch_error=invalid_state');
  }

  try {
    const assertion = await buildClientAssertion();
    const tokenRes = await fetch(STITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: STITCH_CLIENT_ID,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      }),
    });
    if (!tokenRes.ok) {
      console.error('[stitch-oauth-callback] token exchange failed', await tokenRes.text());
      return redirectTo('/dashboard/bank?stitch_error=token_exchange_failed');
    }
    const tokens = await tokenRes.json() as { access_token: string; refresh_token: string };

    // Fetch linked account(s) — shape is best-effort, see file header.
    const gqlRes = await fetch(STITCH_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({
        query: `query { user { bankAccounts { id name accountType accountNumber
          currentBalance { quantity currency } availableBalance { quantity currency }
          institution { name } } } }`,
      }),
    });
    if (!gqlRes.ok) {
      console.error('[stitch-oauth-callback] account fetch failed', await gqlRes.text());
      return redirectTo('/dashboard/bank?stitch_error=account_fetch_failed');
    }
    const gql = await gqlRes.json();
    const accounts = gql?.data?.user?.bankAccounts ?? [];

    for (const acc of accounts) {
      await sb.from('linked_accounts').upsert({
        user_id: verified.user_id,
        provider: 'stitch',
        plaid_access_token: tokens.refresh_token, // reusing this generic column
        account_id: acc.id,
        account_name: acc.name,
        account_type: acc.accountType,
        account_subtype: acc.accountType,
        institution_name: acc.institution?.name ?? 'Bank',
        mask: (acc.accountNumber ?? '').slice(-4) || '****',
        balance_current: acc.currentBalance?.quantity ?? 0,
        balance_available: acc.availableBalance?.quantity ?? 0,
        currency_code: acc.currentBalance?.currency ?? 'ZAR',
        last_synced: new Date().toISOString(),
        account_mode: verified.mode,
        is_business: verified.isBusinessCard,
      }, { onConflict: 'user_id,account_id' });
    }

    return redirectTo('/dashboard/bank?stitch_linked=1');
  } catch (err) {
    console.error('[stitch-oauth-callback] error', err);
    return redirectTo('/dashboard/bank?stitch_error=unexpected');
  }
});

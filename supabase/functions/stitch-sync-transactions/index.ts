// Stitch (South Africa open banking) — transaction sync.
//
// For every linked_accounts row with provider='stitch': refresh the access
// token, pull transactions since last_synced, and insert new ones into
// `expenses`. Invoked two ways — a pg_cron tick every 15-30 min (belt) and
// stitch-webhook firing immediately on a refresh event (suspenders).
//
// business_expense on insert:
//   - is_business = true  -> null  (still needs a human's Business/
//     Personal answer — the flag says *where* to ask, not the answer)
//   - is_business = false -> false (unambiguously the employee's own
//     money; never enters the review queue even inside a trip window)
// The existing auto_tag_trip trigger fires automatically on insert — no
// changes needed there. NOTE: linked_account_id and the discard-outside-
// trip enforcement below assume a migration that hasn't been applied and
// isn't scheduled without checking in first — see the code comment further
// down before deploying this function.
//
// external_ref (Stitch's transaction id) is used to dedupe re-delivered or
// re-polled transactions via the partial unique index on
// (user_id, external_ref) added in 20260810000001_trip_expense_review_infra.sql.
//
// NOT FUNCTIONAL YET — requires:
//   STITCH_CLIENT_ID, STITCH_PRIVATE_KEY — same as stitch-oauth-callback
//   CRON_INVOKE_SECRET                   — already exists; reused here
//   SUPABASE_SERVICE_ROLE_KEY            — to read/write across all users
//
// Stitch's refresh/transactions GraphQL shapes below are best-effort from
// public docs and were not verified against a live Stitch account (this
// session has no way to do that) — confirm against https://stitch.money/docs
// before relying on this.
//
// Category guessing here is a deliberately small stand-in, not a full port
// of src/lib/csv-import.ts's guessCategory() — that function depends on the
// mode-aware category catalog (getCategoriesForMode) which isn't easily
// shared into a Deno edge function's own deploy bundle. Reconcile the two
// once this path is actually live and category quality matters.

import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STITCH_CLIENT_ID = Deno.env.get('STITCH_CLIENT_ID') || '';
const STITCH_PRIVATE_KEY = Deno.env.get('STITCH_PRIVATE_KEY') || '';
const STITCH_TOKEN_URL = 'https://secure.stitch.money/connect/token';
const STITCH_GRAPHQL_URL = 'https://api.stitch.money/graphql';
const CRON_SECRET = Deno.env.get('CRON_INVOKE_SECRET') || '';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface LinkedAccountRow {
  id: string;
  user_id: string;
  account_id: string | null;
  account_mode: string | null;
  is_business: boolean | null;
  plaid_access_token: string | null; // holds the Stitch refresh token
  last_synced: string | null;
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

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const assertion = await buildClientAssertion();
  const res = await fetch(STITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: STITCH_CLIENT_ID,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

// Small, deliberately basic stand-in — see file header.
const KEYWORD_CATEGORY: Array<[string, string]> = [
  ['uber', 'Transport'], ['bolt', 'Transport'], ['gautrain', 'Transport'],
  ['woolworths', 'Food'], ['checkers', 'Food'], ['pick n pay', 'Food'], ['spar', 'Food'],
  ['netflix', 'Subscriptions'], ['spotify', 'Subscriptions'], ['showmax', 'Subscriptions'],
  ['eskom', 'Utilities'], ['telkom', 'Utilities'], ['vodacom', 'Utilities'], ['mtn', 'Utilities'],
  ['clicks', 'Health'], ['dischem', 'Health'], ['pharmacy', 'Health'],
];

function guessCategoryBasic(description: string): string {
  const desc = description.toLowerCase();
  for (const [kw, category] of KEYWORD_CATEGORY) {
    if (desc.includes(kw)) return category;
  }
  return 'Other';
}

interface StitchTransaction {
  id: string;
  description: string;
  amount: { quantity: number };
  date: string;
}

async function fetchTransactions(accessToken: string, sinceIso: string | null): Promise<StitchTransaction[]> {
  const res = await fetch(STITCH_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      query: `query($since: DateTime) { user { bankAccounts { transactions(input: { since: $since }) {
        edges { node { id description amount { quantity } date } } } } } }`,
      variables: { since: sinceIso },
    }),
  });
  if (!res.ok) throw new Error(`transaction fetch failed: ${await res.text()}`);
  const json = await res.json();
  const edges = json?.data?.user?.bankAccounts?.flatMap(
    (a: { transactions?: { edges?: Array<{ node: StitchTransaction }> } }) => a.transactions?.edges ?? [],
  ) ?? [];
  return edges.map((e: { node: StitchTransaction }) => e.node);
}

async function syncAccount(acc: LinkedAccountRow): Promise<{ inserted: number; error?: string }> {
  if (!acc.plaid_access_token) return { inserted: 0, error: 'no refresh token stored' };
  try {
    const accessToken = await refreshAccessToken(acc.plaid_access_token);
    const transactions = await fetchTransactions(accessToken, acc.last_synced);

    // Debits only — amount sign convention depends on Stitch's actual
    // response shape; assuming negative = money out, matching most
    // aggregator APIs. Confirm once this is live.
    const debits = transactions.filter((t) => t.amount.quantity < 0);
    if (debits.length === 0) {
      const { error: stampErr } = await sb.from('linked_accounts').update({ last_synced: new Date().toISOString() }).eq('id', acc.id);
      // A dropped stamp makes the account look never-synced, so the next run
      // re-fetches the same window. Harmless but wasteful, and invisible
      // without this log.
      if (stampErr) console.error('[stitch-sync] last_synced not updated for', acc.id, stampErr.message);
      return { inserted: 0 };
    }

    const businessExpense = acc.is_business ? null : false;
    const rows = debits.map((t) => ({
      user_id: acc.user_id,
      account_mode: acc.account_mode ?? 'personal',
      category: guessCategoryBasic(t.description),
      description: t.description,
      amount: Math.abs(t.amount.quantity),
      date: t.date,
      recurring: 'no' as const,
      business_expense: businessExpense,
      external_ref: t.id,
      // linked_account_id and the discard-outside-trip enforcement it was
      // meant to enable (20260810000004_business_card_trip_gate.sql) depend
      // on a migration that was never applied and conflicts with the trips
      // schema actually live in Supabase (built in a separate session) — do
      // not add this column back without checking in on the real schema
      // first. Dropped from this insert until that's resolved.
    }));

    // Rows sharing the (user_id, external_ref) unique index are silently
    // skipped rather than erroring the whole batch.
    const { error, count } = await sb
      .from('expenses')
      .upsert(rows, { onConflict: 'user_id,external_ref', ignoreDuplicates: true, count: 'exact' });
    if (error) return { inserted: 0, error: error.message };

    const { error: stampErr } = await sb.from('linked_accounts').update({ last_synced: new Date().toISOString() }).eq('id', acc.id);
      // A dropped stamp makes the account look never-synced, so the next run
      // re-fetches the same window. Harmless but wasteful, and invisible
      // without this log.
      if (stampErr) console.error('[stitch-sync] last_synced not updated for', acc.id, stampErr.message);
    return { inserted: count ?? rows.length };
  } catch (err) {
    return { inserted: 0, error: (err as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  if (!STITCH_CLIENT_ID || !STITCH_PRIVATE_KEY) {
    return Response.json({ error: 'Stitch is not configured yet.' }, { status: 501 });
  }

  const { data: accountsRaw, error } = await sb
    .from('linked_accounts')
    .select('id, user_id, account_id, account_mode, is_business, plaid_access_token, last_synced')
    .eq('provider', 'stitch');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const accounts = (accountsRaw ?? []) as LinkedAccountRow[];
  const results = [];
  for (const acc of accounts) {
    results.push({ account_id: acc.id, ...(await syncAccount(acc)) });
  }

  return Response.json({ synced: accounts.length, results });
});

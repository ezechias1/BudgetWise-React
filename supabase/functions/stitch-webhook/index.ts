// Stitch (South Africa open banking) — webhook receiver.
//
// Stitch calls this when a linked account's transactions refresh. Verifies
// the webhook signature, then triggers stitch-sync-transactions so new
// transactions land in `expenses` without waiting for the next cron tick.
//
// Unauthenticated (this is Stitch calling us, not a logged-in user) —
// deployed with --no-verify-jwt. Authenticity comes from the signature
// check below instead of a JWT.
//
// NOT FUNCTIONAL YET — requires:
//   STITCH_WEBHOOK_SECRET — issued by Stitch when you register this
//                            function's deployed URL as your webhook
//                            endpoint in their dashboard (a manual step only
//                            the account owner can do)
//   CRON_INVOKE_SECRET     — already exists (shared with the Junior push
//                            cron); reused here to call
//                            stitch-sync-transactions safely
//
// Stitch's exact signature header/scheme below is a best-effort guess
// (common `x-stitch-signature: sha256=<hmac>` shape) and was not verified
// against a live Stitch account (this session has no way to do that) —
// confirm against https://stitch.money/docs before relying on this.

const STITCH_WEBHOOK_SECRET = Deno.env.get('STITCH_WEBHOOK_SECRET') || '';
const CRON_SECRET = Deno.env.get('CRON_INVOKE_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';

async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const provided = header.replace(/^sha256=/, '');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // Fixed-length inputs (both hex-encoded SHA-256) — safe to compare directly
  // without a timing-safe helper's usual variable-length caveat.
  return expected === provided;
}

Deno.serve(async (req) => {
  if (!STITCH_WEBHOOK_SECRET) {
    return new Response('Stitch webhook is not configured yet.', { status: 501 });
  }
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const rawBody = await req.text();
  const ok = await verifySignature(rawBody, req.headers.get('x-stitch-signature'), STITCH_WEBHOOK_SECRET);
  if (!ok) return new Response('invalid signature', { status: 401 });

  // Fire-and-forget the sync job rather than doing the work inline, so a
  // slow Stitch API call can't make this webhook time out and get retried
  // needlessly by Stitch.
  fetch(`${SUPABASE_URL}/functions/v1/stitch-sync-transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': CRON_SECRET },
    body: '{}',
  }).catch((err) => console.error('[stitch-webhook] failed to trigger sync', err));

  return Response.json({ received: true });
});

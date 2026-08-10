// Trip expense review — server-side VAPID push sender.
// Drains notification_queue rows where status='pending' and pushes to all
// matching push_subscriptions. Called by pg_cron every minute via pg_net
// (see 20260810000003_expense_review_push_cron.sql).
//
// Sibling to send-junior-push rather than a shared/parameterized function:
// isolates this feature so a bug here can't regress the working kid-approval
// push flow, matching this project's convention of small single-purpose
// functions (create-kid-user, delete-kid-user, reset-kid-pin are all
// separate too). Deployed with --no-verify-jwt — same ES256 gateway
// footnote as send-junior-push, though here it's also genuinely correct
// since the only caller is the cron helper, not a logged-in user.

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CRON_SECRET = Deno.env.get('CRON_INVOKE_SECRET')!;

interface Row {
  id: string;
  user_id: string;
  kind: 'expense_review' | string;
  payload: Record<string, unknown>;
}

interface Sub {
  id: string;
  user_id: string;
  platform: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
}

interface Built {
  title: string;
  body: string;
  url: string;
}

function buildPayload(row: Row): Built | null {
  if (row.kind === 'expense_review') {
    const p = row.payload as { description?: string; amount?: number; date?: string };
    const amount = typeof p.amount === 'number' ? p.amount.toFixed(2) : '';
    return {
      title: 'Sort a trip expense',
      body: p.description
        ? `${p.description}${amount ? ` — ${amount}` : ''} — is this Business or Personal?`
        : 'You have an expense that needs a Business/Personal decision.',
      url: '/dashboard/expenses',
    };
  }
  return null;
}

function markSent(id: string) {
  return sb
    .from('notification_queue')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const { data: rowsRaw, error: rowsErr } = await sb
    .from('notification_queue')
    .select('id, user_id, kind, payload')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(200);
  if (rowsErr) {
    console.error('[send-expense-review-push] queue read failed', rowsErr);
    return new Response('queue read failed', { status: 500 });
  }
  const rows = (rowsRaw ?? []) as Row[];
  if (rows.length === 0) return Response.json({ drained: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: subsRaw } = await sb
    .from('push_subscriptions')
    .select('id, user_id, platform, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .eq('platform', 'webpush');
  const subs = (subsRaw ?? []) as Sub[];

  const byUser = new Map<string, Sub[]>();
  for (const s of subs) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }

  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const row of rows) {
    const built = buildPayload(row);
    if (!built) continue;

    const userSubs = byUser.get(row.user_id) ?? [];
    if (userSubs.length === 0) {
      // Mark sent so we don't retry forever for users with no subscription.
      await markSent(row.id);
      continue;
    }

    let anySuccess = false;
    for (const s of userSubs) {
      if (!s.endpoint || !s.p256dh || !s.auth) continue;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(built),
        );
        sent++;
        anySuccess = true;
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await sb.from('push_subscriptions').delete().eq('id', s.id);
          gone++;
        } else {
          console.warn('[send-expense-review-push] push failed', { sub: s.id, statusCode, error: String(e) });
          failed++;
        }
      }
    }

    if (anySuccess) await markSent(row.id);
    // else: row stays 'pending'; next cron tick retries.
  }

  return Response.json({ drained: rows.length, sent, gone, failed });
});

// Junior Phase 5 — server-side VAPID push sender.
// Drains kid_notifications rows where status='pending' and pushes to all
// matching push_subscriptions. Called by pg_cron every minute via pg_net.
// Deployed with --no-verify-jwt (ES256 gateway gotcha on this project).

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
  kind: 'approval_nudge' | 'sunday_reminder' | string;
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
  if (row.kind === 'approval_nudge') {
    const p = row.payload as {
      kid_name: string;
      action_type: 'chore' | 'mission' | 'goal_proposal' | 'money_request';
      item_title: string;
      link: string;
    };
    if (p.action_type === 'chore') {
      return {
        title: `${p.kid_name} has a chore waiting`,
        body: `They marked "${p.item_title}" done — tap to approve.`,
        url: p.link,
      };
    }
    if (p.action_type === 'mission') {
      return {
        title: `${p.kid_name} finished a money mission`,
        body: `They completed "${p.item_title}" — tap to review.`,
        url: p.link,
      };
    }
    if (p.action_type === 'goal_proposal') {
      return {
        title: `${p.kid_name} proposed a new goal`,
        body: `"${p.item_title}" — tap to approve or decline.`,
        url: p.link,
      };
    }
    if (p.action_type === 'money_request') {
      return {
        title: `${p.kid_name} is asking for money`,
        body: `${p.item_title} — tap to decide.`,
        url: p.link,
      };
    }
    return null;
  }
  if (row.kind === 'sunday_reminder') {
    const p = row.payload as { total_owed_cents: number; kids_count: number };
    return {
      title: 'Sunday settle-up',
      body: `You owe your kids R${(p.total_owed_cents / 100).toFixed(2)} across ${p.kids_count} ${p.kids_count === 1 ? 'child' : 'children'}. Tap to settle.`,
      url: '/dashboard/junior',
    };
  }
  return null;
}

function markSent(id: string) {
  return sb
    .from('kid_notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const { data: rowsRaw, error: rowsErr } = await sb
    .from('kid_notifications')
    .select('id, user_id, kind, payload')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(200);
  if (rowsErr) {
    console.error('[send-junior-push] queue read failed', rowsErr);
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
      // Mark sent so we don't retry forever for opted-out users.
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
          console.warn('[send-junior-push] push failed', { sub: s.id, statusCode, error: String(e) });
          failed++;
        }
      }
    }

    if (anySuccess) await markSent(row.id);
    // else: row stays 'pending'; next cron tick retries.
  }

  return Response.json({ drained: rows.length, sent, gone, failed });
});

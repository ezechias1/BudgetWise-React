import { supabase } from '@/lib/supabase';

/**
 * Junior Phase 4 · P4-T2 — approval-nudge notifications.
 *
 * When a kid marks a chore done or completes a mission, we enqueue a row
 * into `kid_notifications` addressed to the parent. A client-side poller
 * running in the parent's DashboardLayout drains pending rows and surfaces
 * them via the existing service worker's `showNotification` (same pattern
 * StokvelPage uses).
 *
 * Phase 4 is client-only — no server-side VAPID push sender. That lives
 * in Phase 5 infra.
 */

export type ApprovalAction = 'chore' | 'mission' | 'goal_proposal' | 'money_request';

export interface ApprovalNudgePayload {
  kid_name: string;
  action_type: ApprovalAction;
  item_title: string;
  link: string;
}

/**
 * Insert a `kid_notifications` row for the parent. Called from the kid
 * client after the chore/mission update succeeds. RLS lets the kid insert
 * because of the `kid inserts parent notification` policy.
 */
export async function enqueueApprovalNudge(
  parentUserId: string,
  kidName: string,
  actionType: ApprovalAction,
  itemTitle: string,
  link: string,
): Promise<void> {
  const payload: ApprovalNudgePayload = {
    kid_name: kidName,
    action_type: actionType,
    item_title: itemTitle,
    link,
  };
  const { error } = await supabase.from('kid_notifications').insert({
    user_id: parentUserId,
    kind: 'approval_nudge',
    payload,
    // scheduled_for + status use DB defaults (now(), 'pending')
  });
  if (error) {
    // Swallow — the kid's primary action already succeeded; missing a
    // notification is not worth failing the UI over. Log for telemetry.
    console.warn('[junior-notifications] enqueueApprovalNudge failed', error);
  }
}

interface PendingRow {
  id: string;
  kind: string;
  payload: ApprovalNudgePayload;
}

function buildNotification(row: PendingRow): { title: string; body: string; url: string } | null {
  if (row.kind !== 'approval_nudge') return null;
  const { kid_name, action_type, item_title, link } = row.payload;
  if (action_type === 'chore') {
    return {
      title: `${kid_name} has a chore waiting`,
      body: `They marked "${item_title}" done — tap to approve.`,
      url: link,
    };
  }
  if (action_type === 'mission') {
    return {
      title: `${kid_name} finished a money mission`,
      body: `They completed "${item_title}" — tap to review.`,
      url: link,
    };
  }
  if (action_type === 'goal_proposal') {
    return {
      title: `${kid_name} proposed a new goal`,
      body: `"${item_title}" — tap to approve or decline.`,
      url: link,
    };
  }
  if (action_type === 'money_request') {
    return {
      title: `${kid_name} is asking for money`,
      body: `${item_title} — tap to decide.`,
      url: link,
    };
  }
  return null;
}

async function drainPendingNotifications(parentUserId: string): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  const { data, error } = await supabase
    .from('kid_notifications')
    .select('id, kind, payload')
    .eq('user_id', parentUserId)
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString());
  if (error || !data || data.length === 0) return;

  const reg = await navigator.serviceWorker.ready;

  for (const row of data as PendingRow[]) {
    const n = buildNotification(row);
    if (!n) continue;
    try {
      await reg.showNotification(n.title, {
        body: n.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `bw-junior-${row.id}`,
        data: n.url,
      });
      // Previously discarded: if this update failed the row stayed 'pending',
      // so the poller re-showed the same notification every 30 seconds
      // forever — and nothing said why. No user is present in this polling
      // context, so log rather than alert.
      const { error: markErr } = await supabase
        .from('kid_notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      if (markErr) {
        console.error(
          '[junior-notifications] could not mark notification sent — it will be shown again on the next poll',
          { id: row.id, error: markErr.message },
        );
      }
    } catch (e) {
      console.warn('[junior-notifications] showNotification failed', e);
    }
  }
}

/**
 * Starts a 30-second poller that drains pending approval nudges for the
 * given parent user. Returns a cleanup function that stops the poller.
 * Call from DashboardLayout's useEffect with the current auth user's id.
 */
export function setupParentNotificationPolling(parentUserId: string): () => void {
  // Fire once immediately so notifications queued while the tab was closed
  // appear without waiting 30s.
  void drainPendingNotifications(parentUserId);
  const interval = window.setInterval(() => {
    void drainPendingNotifications(parentUserId);
  }, 30_000);
  return () => window.clearInterval(interval);
}

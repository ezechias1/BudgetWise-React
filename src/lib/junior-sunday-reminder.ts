import { supabase } from '@/lib/supabase';

function isoWeek(d: Date): string {
  const target = new Date(d);
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((target.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export async function maybeFireSundayReminder(
  parentUserId: string,
): Promise<{ fired: boolean; totalOwedCents: number; kidsCount: number }> {
  const now = new Date();
  // Only run on Sundays (day 0)
  if (now.getDay() !== 0) {
    return { fired: false, totalOwedCents: 0, kidsCount: 0 };
  }
  const key = `budgetwise-junior-sunday-reminder-${isoWeek(now)}`;
  if (localStorage.getItem(key) === 'sent') {
    return { fired: false, totalOwedCents: 0, kidsCount: 0 };
  }

  // Aggregate owed across all kids for this parent
  const { data, error } = await supabase
    .from('kid_ledger')
    .select('member_id, amount_cents, status')
    .eq('user_id', parentUserId)
    .eq('status', 'owed');
  if (error) return { fired: false, totalOwedCents: 0, kidsCount: 0 };

  const rows = data as Array<{ member_id: string; amount_cents: number }>;
  if (rows.length === 0) return { fired: false, totalOwedCents: 0, kidsCount: 0 };

  const totalOwedCents = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const kidsCount = new Set(rows.map((r) => r.member_id)).size;

  // Fire the notification via SW if permission granted; otherwise no-op.
  if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Sunday settle-up', {
        body: `You owe your kids R${(totalOwedCents / 100).toFixed(2)} across ${kidsCount} ${kidsCount === 1 ? 'child' : 'children'}. Tap to settle.`,
        icon: '/icons/icon-192.png',
        tag: `bw-junior-sunday-${isoWeek(now)}`,
      });
    } catch {
      /* swallow — permission/Network issues shouldn't block the banner */
    }
  }

  localStorage.setItem(key, 'sent');
  return { fired: true, totalOwedCents, kidsCount };
}

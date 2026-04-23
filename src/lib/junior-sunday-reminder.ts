import { supabase } from '@/lib/supabase';

// AUDIT Minor #12: compute the ISO week key in LOCAL time to match the
// local-time Sunday check in maybeFireSundayReminder. Previously mixed
// local `getDay()` with UTC isoWeek, which let the reminder double-fire
// across the SA Sun/Mon midnight boundary.
function isoWeek(d: Date): string {
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4);
  const weekNum =
    1 +
    Math.round(
      ((target.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return `${target.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
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

  // NOTE (Junior Phase 5): the system push notification used to fire here
  // via `reg.showNotification`. The server-side cron now owns push
  // delivery (see supabase/functions/send-junior-push/index.ts), so we
  // only compute the totals and let DashboardLayout render the in-app
  // banner. Keeping the localStorage flag means the banner still respects
  // weekly dedup if the parent dismisses it.

  localStorage.setItem(key, 'sent');
  return { fired: true, totalOwedCents, kidsCount };
}

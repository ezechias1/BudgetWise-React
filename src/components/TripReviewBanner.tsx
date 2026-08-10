import { useEffect, useState } from 'react';
import { usePendingTripReviews } from '@/hooks/usePendingTripReviews';

const SESSION_KEY = 'bw-trip-review-banner-shown';

/**
 * Low-friction nudge, not a gate: replaces the earlier app-wide blocking
 * TripReviewGateModal, which forced a decision before the rest of the app
 * was usable. This just surfaces the count once and gets out of the way —
 * the "needs review" badges on the Trips tab (a separate query in
 * TripsTab.tsx) are the passive indicator the rest of the time.
 *
 * Shows at most once per browser session: the moment there's something to
 * show, it flags sessionStorage immediately (not just on dismiss), so a
 * refresh or route change within the same session won't bring it back.
 */
export function TripReviewBanner() {
  const { pendingExpenses, loading } = usePendingTripReviews();
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (loading || checked) return;
    setChecked(true);
    if (sessionStorage.getItem(SESSION_KEY) === 'true') return;
    if (pendingExpenses.length > 0) {
      sessionStorage.setItem(SESSION_KEY, 'true');
      setVisible(true);
    }
  }, [loading, checked, pendingExpenses.length]);

  if (!visible) return null;

  const count = pendingExpenses.length;

  return (
    <div role="status" className="trip-review-banner">
      <span>
        You have {count} trip {count === 1 ? 'expense' : 'expenses'} to review.{' '}
        <a href="/dashboard/expenses?tab=trips">Review now →</a>
      </span>
      <button onClick={() => setVisible(false)} aria-label="Dismiss">×</button>
    </div>
  );
}

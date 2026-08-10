import { useState } from 'react';
import { usePendingTripReviews } from '@/hooks/usePendingTripReviews';
import { useUserSettings } from '@/hooks/useUserSettings';
import { TripExpenseReviewPrompt } from '@/components/TripExpenseReviewPrompt';

/**
 * App-wide blocking gate: the first thing an authenticated user sees,
 * regardless of which dashboard route they land on, whenever they have any
 * trip expense still needing a Business/Personal decision. No backdrop
 * dismissal, no close button — every item must be answered before it
 * unmounts itself. Shows even while the active mode is Business, since this
 * is a money-integrity concern independent of the current tab.
 */
export function TripReviewGateModal() {
  const { pendingExpenses, loading, classify } = usePendingTripReviews();
  const { currency } = useUserSettings();
  const [submitting, setSubmitting] = useState(false);

  if (loading || pendingExpenses.length === 0) return null;

  const current = pendingExpenses[0];
  const total = pendingExpenses.length;

  const handleChoose = async (value: boolean) => {
    setSubmitting(true);
    await classify(current.id, value);
    setSubmitting(false);
  };

  return (
    <div className="modal-overlay trip-gate-overlay" style={{ zIndex: 400 }}>
      <div className="modal">
        <div className="modal-header">
          <h2>Sort your trip expenses</h2>
        </div>
        <p className="trip-gate-progress">
          {total === 1 ? '1 expense needs review' : `${total} expenses need review`} &mdash; this one first
        </p>
        <TripExpenseReviewPrompt
          expense={current}
          currency={currency}
          onChoose={handleChoose}
          submitting={submitting}
        />
      </div>
    </div>
  );
}

import { formatCurrency } from '@/lib/format';
import type { Expense } from '@/types';

interface Props {
  expense: Expense;
  currency: string;
  onChoose: (value: boolean) => void | Promise<void>;
  submitting?: boolean;
}

/**
 * Standalone "Business or Personal?" decision card — used wherever an
 * expense needs sorting outside the Trip Detail table (currently just the
 * post-save popup in ExpenseModal). Reuses the same .trip-review-* classes
 * as TripsTab's inline per-row prompt so it reads as the same UI wherever
 * it shows up.
 */
export function TripExpenseReviewPrompt({ expense, currency, onChoose, submitting }: Props) {
  return (
    <div className="trip-review-standalone">
      <div className="trip-review-standalone-summary">
        <div className="trip-review-standalone-desc">{expense.description}</div>
        <div className="trip-review-standalone-meta">
          {expense.date} &middot; {formatCurrency(expense.amount, currency)}
        </div>
      </div>
      <p className="trip-review-standalone-question">
        Was this paid for with your own money, or a business card?
      </p>
      <div className="trip-review-standalone-actions">
        <button
          type="button"
          className="trip-review-btn trip-review-btn-lg"
          disabled={submitting}
          onClick={() => onChoose(true)}
        >
          Business
        </button>
        <button
          type="button"
          className="trip-review-btn trip-review-btn-lg is-personal"
          disabled={submitting}
          onClick={() => onChoose(false)}
        >
          Personal
        </button>
      </div>
    </div>
  );
}

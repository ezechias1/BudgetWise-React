import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useCategories } from '@/hooks/useCategories';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { todayIso } from '@/lib/format';
import { useUserSettings } from '@/hooks/useUserSettings';
import { supabase } from '@/lib/supabase';
import { reportWriteFailure } from '@/lib/db';
import { isPendingTripReview } from '@/lib/trip-review';
import { TripExpenseReviewPrompt } from '@/components/TripExpenseReviewPrompt';
import type { Expense, NewExpense } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (expense: NewExpense) => Promise<{ error: string | null; expense?: Expense }>;
  /** Pre-select a category when the modal opens (e.g. "Savings" from the Savings page). */
  defaultCategory?: string;
  /**
   * Seed values for the form when the modal opens - used by the receipt
   * scanner to pre-fill amount/description/date from OCR output. Category
   * is intentionally left to `defaultCategory` so the user still picks it.
   */
  defaultValues?: {
    amount?: string;
    description?: string;
    date?: string;
  };
  /** Called after a trip-review decision is saved, so the caller can refresh its list. */
  onAfterClassify?: () => void;
}

/**
 * Ports the `#expenseModal` + `#expenseForm` markup from dashboard.html
 * lines 346-395 and the submit handler logic from js/app.js
 * `setupExpenseForm()` (line 1909), minus the family approval flow.
 *
 * The Tithe auto-fill behavior is preserved: picking "Tithe" fills the
 * amount with 10% of the stored monthly income and sets a description.
 */
export function ExpenseModal({
  open,
  onClose,
  onSubmit,
  defaultCategory,
  defaultValues,
  onAfterClassify,
}: Props) {
  const { income, currency } = useUserSettings();
  // Includes the user's own categories, not just the built-in list.
  const { categories: modeCategories, refreshCategories } = useCategories();

  const [category, setCategory] = useState(defaultCategory ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso);
  const [recurring, setRecurring] = useState<'no' | 'weekly' | 'monthly'>('no');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once a just-saved expense lands inside a trip's date range and still
  // needs a Business/Personal decision — while this is set, the modal shows
  // TripExpenseReviewPrompt instead of the form, and cannot be dismissed.
  const [pendingReview, setPendingReview] = useState<Expense | null>(null);
  const [classifying, setClassifying] = useState(false);

  const dialog = useDialogA11y<HTMLDivElement>(open);
  const reviewDialog = useDialogA11y<HTMLDivElement>(pendingReview !== null);

  // What the reset below seeds the form with, held in a ref so it can be read
  // without being a dependency of that effect. Kept in sync on every commit,
  // so the reset always reads the values from the render that opened the modal.
  const seedsRef = useRef({ defaultCategory, defaultValues, refreshCategories });
  useEffect(() => {
    seedsRef.current = { defaultCategory, defaultValues, refreshCategories };
  });

  // Reset form every time the modal opens so it doesn't show stale state.
  // `defaultValues` (from the receipt scanner) seeds amount/description/date
  // when provided; otherwise fall back to empty + today's date.
  //
  // This effect depends on `open` ALONE, and deliberately so. It used to also
  // list defaultCategory/defaultValues/refreshCategories, which meant it fired
  // on any identity change and not just on the open transition:
  // refreshCategories is rebuilt whenever the auth user object changes, and
  // auth-js re-emits SIGNED_IN with a freshly deserialised session on every
  // hidden→visible transition. So backgrounding the phone with the modal open
  // — switching to a banking app to check a figure, or just the screen locking
  // — reset the form underneath the user: the category they had picked dropped
  // back to "Select...", and an amount they had corrected reverted to the raw
  // OCR value, which then got saved to the ledger as if they had typed it.
  useEffect(() => {
    if (!open) return;
    const { defaultCategory: seedCategory, defaultValues: seed, refreshCategories: refresh } =
      seedsRef.current;
    setCategory(seedCategory ?? '');
    setDescription(seed?.description ?? '');
    setAmount(seed?.amount ?? '');
    setDate(seed?.date ?? todayIso());
    setRecurring('no');
    setError(null);
    setPendingReview(null);
    // This modal stays mounted between opens, so its category list would
    // otherwise be whatever existed at page load — a category added under
    // Expenses → Categories a moment ago would be missing from the picker.
    void refresh();
  }, [open]);

  // Drop the picked category the moment it stops existing in the current
  // mode's list, and nothing else.
  //
  // The mode switcher is genuinely reachable with the modal open: .main-content
  // is `position: relative; z-index: 1`, so it opens a stacking context that
  // traps .modal-overlay's z-index:500 inside it, while .sidebar is a
  // root-level `position: fixed; z-index: 50` — the sidebar paints on top of
  // the overlay and takes clicks. Sidebar's handler then navigates to
  // /dashboard, which from OverviewPage is a same-route navigation, so nothing
  // unmounts and this modal survives with its state.
  //
  // Before this, switching Personal → Family with "Housing" picked left
  // `category` as the Personal string while the picker showed the Family list.
  // A controlled <select> with no matching <option> renders blank but never
  // writes back, so handleSubmit's `if (!category)` guard sailed past the
  // truthy stale value and filed a Family expense under the Personal category
  // "Housing". Clearing it puts the picker back to "Select...", where both
  // `required` and that guard actually stop the submit.
  //
  // Functional update on purpose: the reset effect above may have already
  // queued a fresh seed in this same flush, and the updater sees that queued
  // value rather than this render's stale one, so a valid `defaultCategory`
  // is never wiped on open.
  useEffect(() => {
    setCategory((current) =>
      current && !modeCategories.some((c) => c.value === current) ? '' : current,
    );
  }, [category, modeCategories]);

  // Close on Escape — but not while a trip-review decision is pending; that
  // must be answered before the modal can close.
  useEffect(() => {
    if (!open || pendingReview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pendingReview, onClose]);

  if (!open) return null;

  const handleCategoryChange = (next: string) => {
    setCategory(next);
    // Tithe auto-fill (ported from js/app.js line 1916)
    if (next === 'Tithe' && income > 0) {
      const tithe = income * 0.1;
      setAmount(tithe.toFixed(2));
      setDescription('Monthly Tithe (10%)');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!category || !description || Number.isNaN(parsedAmount) || !date) {
      setError('Please fill in every field.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: insertErr, expense } = await onSubmit({
      category,
      description,
      amount: parsedAmount,
      date,
      recurring,
    });
    setSubmitting(false);
    if (insertErr) {
      setError(insertErr);
      return;
    }
    if (expense && isPendingTripReview(expense)) {
      setPendingReview(expense);
      return;
    }
    onClose();
  };

  const handleChoose = async (value: boolean) => {
    if (!pendingReview) return;
    setClassifying(true);
    // Previously discarded its error: the trip-review prompt closed and the
    // expense stayed unreviewed, so the same prompt returned on next load.
    const { error: reviewError } = await supabase
      .from('expenses')
      .update({ business_expense: value })
      .eq('id', pendingReview.id);
    if (reviewError) {
      // Re-enable the prompt's buttons before bailing — this prompt suppresses
      // Escape while pending, so leaving `classifying` true hard-locked the
      // modal behind two permanently disabled buttons until a reload.
      setClassifying(false);
      reportWriteFailure('save that Business/Personal choice', reviewError.message);
      return;
    }
    setClassifying(false);
    setPendingReview(null);
    onAfterClassify?.();
    onClose();
  };

  if (pendingReview) {
    return (
      <div
        className="modal-overlay"
        {...reviewDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-sort-title"
      >
        <div className="modal">
          <div className="modal-header">
            <h2 id="expense-sort-title">Sort this expense</h2>
          </div>
          <TripExpenseReviewPrompt
            expense={pendingReview}
            currency={currency}
            onChoose={handleChoose}
            submitting={classifying}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-expense-title"
      onClick={(e) => {
        // Close when clicking the backdrop (vanilla behavior)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 id="add-expense-title">Add Expense</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Category</label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              required
            >
              <option value="">Select...</option>
              {modeCategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="e.g. Monthly rent"
            />
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder="0.00"
              min="0"
              step="0.01"
            />
          </div>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Recurring?</label>
            <select
              value={recurring}
              onChange={(e) =>
                setRecurring(e.target.value as 'no' | 'weekly' | 'monthly')
              }
            >
              <option value="no">No - One time</option>
              <option value="monthly">Yes - Monthly</option>
              <option value="weekly">Yes - Weekly</option>
            </select>
          </div>
          {error && (
            <p className="auth-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Expense'}
          </button>
        </form>
      </div>
    </div>
  );
}

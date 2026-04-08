import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getCategoriesForMode } from '@/lib/categories';
import { todayIso } from '@/lib/format';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useMode } from '@/contexts/ModeContext';
import type { NewExpense } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (expense: NewExpense) => Promise<{ error: string | null }>;
  /** Pre-select a category when the modal opens (e.g. "Savings" from the Savings page). */
  defaultCategory?: string;
}

/**
 * Ports the `#expenseModal` + `#expenseForm` markup from dashboard.html
 * lines 346-395 and the submit handler logic from js/app.js
 * `setupExpenseForm()` (line 1909), minus the family approval flow.
 *
 * The Tithe auto-fill behavior is preserved: picking "Tithe" fills the
 * amount with 10% of the stored monthly income and sets a description.
 */
export function ExpenseModal({ open, onClose, onSubmit, defaultCategory }: Props) {
  const { income } = useUserSettings();
  const { mode } = useMode();
  const modeCategories = useMemo(() => getCategoriesForMode(mode), [mode]);

  const [category, setCategory] = useState(defaultCategory ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso);
  const [recurring, setRecurring] = useState<'no' | 'weekly' | 'monthly'>('no');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset form every time the modal opens so it doesn't show stale state
  useEffect(() => {
    if (open) {
      setCategory(defaultCategory ?? '');
      setDescription('');
      setAmount('');
      setDate(todayIso());
      setRecurring('no');
      setError(null);
    }
  }, [open, defaultCategory]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
    const { error: insertErr } = await onSubmit({
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
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        // Close when clicking the backdrop (vanilla behavior)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2>Add Expense</h2>
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

import { useEffect, useState, type FormEvent } from 'react';
import { todayIso } from '@/lib/format';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import type { NewTrip } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (trip: NewTrip) => Promise<{ error: string | null }>;
}

/** Create-a-trip modal — name, start date, end date. Mirrors ExpenseModal's shape. */
export function TripModal({ open, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialog = useDialogA11y(open);

  useEffect(() => {
    if (open) {
      setName('');
      setStartDate(todayIso());
      setEndDate(todayIso());
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) {
      setError('Please fill in every field.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: insertErr } = await onSubmit({
      name: name.trim(),
      start_date: startDate,
      end_date: endDate,
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
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-trip-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 id="new-trip-title">New Trip</h2>
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
            <label>Trip name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Cape Town conference"
            />
          </div>
          <div className="field">
            <label>Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="auth-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Trip'}
          </button>
        </form>
      </div>
    </div>
  );
}

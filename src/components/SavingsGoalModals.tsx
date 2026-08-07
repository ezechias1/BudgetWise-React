import { useEffect, useState, type FormEvent } from 'react';
import type { NewSavingsGoal } from '@/types';

interface NewGoalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewSavingsGoal) => Promise<{ error: string | null }>;
}

/** Port of #goalModal — create a new savings goal. */
export function NewGoalModal({ open, onClose, onSubmit }: NewGoalProps) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [monthly, setMonthly] = useState('');
  const [deadline, setDeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setTarget('');
      setMonthly('');
      setDeadline('');
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
    const parsedTarget = parseFloat(target);
    const parsedMonthly = parseFloat(monthly);
    if (!name || Number.isNaN(parsedTarget) || Number.isNaN(parsedMonthly)) {
      setError('Please fill in every field.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: err } = await onSubmit({
      name,
      target_amount: parsedTarget,
      monthly_contribution: parsedMonthly,
      deadline: deadline || null,
    });
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2>New Savings Goal</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>What are you saving for?</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. New Laptop, Car, Holiday"
            />
          </div>
          <div className="field">
            <label>How much does it cost?</label>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
              placeholder="e.g. 15000"
              min="0"
              step="0.01"
            />
          </div>
          <div className="field">
            <label>How much can you save per month?</label>
            <input
              type="number"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              required
              placeholder="e.g. 2000"
              min="0"
              step="0.01"
            />
          </div>
          <div className="field">
            <label>Target date (optional)</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          {error && (
            <p className="auth-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Goal'}
          </button>
        </form>
      </div>
    </div>
  );
}

interface AddToGoalProps {
  open: boolean;
  onClose: () => void;
  goalName: string;
  onSubmit: (amount: number) => Promise<{ error: string | null }>;
}

/** Port of #addToGoalModal — contribute to an existing goal. */
export function AddToGoalModal({ open, onClose, goalName, onSubmit }: AddToGoalProps) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount('');
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
    const parsed = parseFloat(amount);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setError('Please enter a positive amount.');
      return;
    }
    setSubmitting(true);
    const { error: err } = await onSubmit(parsed);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2>Add Money to Goal</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <p style={{ marginBottom: 16, opacity: 0.6 }}>
            Adding to: <strong>{goalName}</strong>
          </p>
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
              autoFocus
            />
          </div>
          {error && (
            <p className="auth-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { usePendingExpenses } from '@/hooks/usePendingExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useMode } from '@/contexts/ModeContext';
import { getCategoriesForMode } from '@/lib/categories';
import { formatCurrency } from '@/lib/format';
import { SOURCE_LABELS } from '@/lib/expense-source';

interface Props {
  /**
   * The queue is owned by the parent so the tab's count badge and this list
   * share one instance — otherwise confirming a row here would leave the
   * badge showing a stale number, and each instance would re-run the
   * duplicate-matching fetch.
   */
  queue: ReturnType<typeof usePendingExpenses>;
  /** Lets the parent refresh the ledger once something is confirmed into it. */
  onReviewed?: () => void;
}

/**
 * Review queue for imported expenses.
 *
 * Rows arrive from a bank import with an amount, a merchant string and a
 * date, but no category — so they sit here as `review_status = 'pending'`,
 * out of the ledger, until the user files them. `useExpenses` filters
 * pending rows out, which is what stops uncategorised imports from
 * corrupting totals, budget warnings and the pie chart.
 */
export function ExpenseReviewInbox({ queue, onReviewed }: Props) {
  const { pending, loading, confirm, dismiss } = queue;
  const { currency } = useUserSettings();
  const { mode } = useMode();
  const categories = useMemo(() => getCategoriesForMode(mode), [mode]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (fn: () => Promise<{ error: string | null }>, id: string) => {
    setBusyId(id);
    const { error } = await fn();
    setBusyId(null);
    if (error) alert(error);
    else onReviewed?.();
  };

  if (loading) {
    return <p style={{ opacity: 0.6 }}>Loading transactions to review…</p>;
  }

  if (pending.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Nothing to review</p>
        <p style={{ fontSize: '0.85rem' }}>
          Imported transactions will appear here for you to categorise before
          they count towards your budget.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {pending.map((p) => {
        const busy = busyId === p.id;
        return (
          <div
            key={p.id}
            className="chart-card"
            style={{ padding: 14, opacity: busy ? 0.5 : 1 }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'baseline',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {p.description || 'Unknown merchant'}
                </div>
                <div style={{ fontSize: '0.78rem', opacity: 0.6 }}>
                  {p.date} · {SOURCE_LABELS[p.source] ?? p.source}
                </div>
              </div>
              <div style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                {formatCurrency(p.amount, currency)}
              </div>
            </div>

            {p.duplicateOf && (
              <div
                role="status"
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.18)',
                  fontSize: '0.8rem',
                }}
              >
                Looks like the same transaction as{' '}
                <strong>{p.duplicateOf.description}</strong> on{' '}
                {p.duplicateOf.date}, which is already in your budget.
                Dismiss this one to avoid counting it twice.
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 12,
              }}
            >
              {categories.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(() => confirm(p.id, { category: c.value }), p.id)
                  }
                  className="tab-btn"
                  style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                >
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => dismiss(p.id), p.id)}
                className="tab-btn"
                style={{
                  fontSize: '0.78rem',
                  padding: '4px 10px',
                  marginLeft: 'auto',
                  opacity: 0.7,
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

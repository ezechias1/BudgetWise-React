import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useKidLedger, type KidLedgerRow } from '@/hooks/useKidLedger';

interface Kid {
  id: string;
  name: string;
  color: string;
  jar_split: { save: number; spend: number; give: number };
}

interface Props {
  kid: Kid;
  currencySymbol: string;
  onClose: () => void;
  onPaid: () => void;
}

function formatRands(cents: number, sym: string): string {
  return `${sym}${(cents / 100).toFixed(2)}`;
}

export function SettleUpModal({ kid, currencySymbol, onClose, onPaid }: Props) {
  const { rows, owed_cents, loading, refresh } = useKidLedger(kid.id);
  const [method, setMethod] = useState<'cash' | 'eft' | 'other'>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const owedRows = rows.filter((r) => r.status === 'owed');
  const sym = currencySymbol;

  const handlePaid = async () => {
    if (owedRows.length === 0) return;
    setSubmitting(true);
    setError(null);
    const paidAt = new Date().toISOString();
    const note = `Paid via ${method}`;
    const { error: upErr } = await supabase
      .from('kid_ledger')
      .update({
        status: 'paid',
        paid_at: paidAt,
        split: kid.jar_split,
        notes: note,
      })
      .eq('member_id', kid.id)
      .eq('status', 'owed');
    if (upErr) {
      setError(upErr.message);
      setSubmitting(false);
      return;
    }
    onPaid();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settle up with {kid.name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : owedRows.length === 0 ? (
          <p>Nothing owed right now.</p>
        ) : (
          <>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              You owe {formatRands(owed_cents, sym)}
            </p>

            <h4 style={{ marginTop: 20 }}>Breakdown ({owedRows.length} items)</h4>
            <ul style={{ listStyle: 'none', padding: 0, maxHeight: 180, overflowY: 'auto' }}>
              {owedRows.map((r: KidLedgerRow) => (
                <li
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    <strong style={{ textTransform: 'capitalize' }}>{r.source_type}</strong>
                    {r.notes ? ` · ${r.notes}` : ''}
                  </span>
                  <span style={{ flexShrink: 0, marginLeft: 8 }}>{formatRands(r.amount_cents, sym)}</span>
                </li>
              ))}
            </ul>

            <h4 style={{ marginTop: 20 }}>Will split into</h4>
            <p style={{ margin: '6px 0' }}>
              Save {kid.jar_split.save}% · Spend {kid.jar_split.spend}% · Give {kid.jar_split.give}%
            </p>
            <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>
              (kid&apos;s current allocation at time of payment — they set this themselves)
            </p>

            <h4 style={{ marginTop: 20 }}>How did you pay?</h4>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {(['cash', 'eft', 'other'] as const).map((m) => (
                <label key={m} style={{ textTransform: 'capitalize', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                  />{' '}
                  {m === 'eft' ? 'EFT' : m}
                </label>
              ))}
            </div>

            {error && <p style={{ color: '#dc2626', marginTop: 12 }}>{error}</p>}
          </>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={owedRows.length === 0 || submitting}
            onClick={handlePaid}
          >
            {submitting ? 'Settling…' : 'Confirm paid'}
          </button>
        </div>
      </div>
    </div>
  );
}

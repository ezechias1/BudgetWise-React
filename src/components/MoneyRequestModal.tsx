import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Kid {
  id: string;
  name: string;
  user_id: string;
}

interface MoneyRequest {
  id: string;
  member_id: string;
  requested_amount_cents: number;
  reason: string | null;
  created_at: string;
}

interface Props {
  kid: Kid;
  currencySymbol: string;
  onClose: () => void;
  onDecided: () => void;
}

function formatRands(cents: number, sym: string): string {
  return `${sym}${(cents / 100).toFixed(2)}`;
}

/**
 * Single-round decision: approve as requested, approve a different amount,
 * or decline. Mirrors SettleUpModal.tsx's shape. On approval, inserts a
 * kid_ledger row exactly like a chore payout does (status='owed',
 * source_type='adjustment') — no new ledger status needed.
 */
export function MoneyRequestModal({ kid, currencySymbol, onClose, onDecided }: Props) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<MoneyRequest[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useDialogA11y();
  const sym = currencySymbol;

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('kid_money_requests')
      .select('id, member_id, requested_amount_cents, reason, created_at')
      .eq('member_id', kid.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    const rows = (data as MoneyRequest[]) ?? [];
    setRequests(rows);
    setAmounts((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (!(r.id in next)) next[r.id] = (r.requested_amount_cents / 100).toFixed(2);
      }
      return next;
    });
    setLoading(false);
  }, [kid.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (req: MoneyRequest) => {
    if (!user) return;
    const amountRands = parseFloat(amounts[req.id] ?? '');
    if (!Number.isFinite(amountRands) || amountRands <= 0) {
      setError('Enter an amount above 0.');
      return;
    }
    setError(null);
    setBusyId(req.id);
    const approvedCents = Math.round(amountRands * 100);
    const { error: ledgerErr } = await supabase.from('kid_ledger').insert({
      member_id: kid.id,
      user_id: user.id,
      amount_cents: approvedCents,
      source_type: 'adjustment',
      source_id: req.id,
      status: 'owed',
      notes: 'Money request approved',
    });
    if (ledgerErr) {
      setError(ledgerErr.message);
      setBusyId(null);
      return;
    }
    const { error: reqErr } = await supabase
      .from('kid_money_requests')
      .update({ status: 'approved', approved_amount_cents: approvedCents, decided_at: new Date().toISOString() })
      .eq('id', req.id);
    setBusyId(null);
    if (reqErr) {
      setError(reqErr.message);
      return;
    }
    await load();
    onDecided();
  };

  const handleDecline = async (req: MoneyRequest) => {
    setBusyId(req.id);
    const { error: reqErr } = await supabase
      .from('kid_money_requests')
      .update({ status: 'declined', decided_at: new Date().toISOString() })
      .eq('id', req.id);
    setBusyId(null);
    if (reqErr) {
      setError(reqErr.message);
      return;
    }
    await load();
    onDecided();
  };

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="money-requests-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="money-requests-title">Money requests from {kid.name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : requests.length === 0 ? (
          <p>No pending requests.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {requests.map((r) => (
              <li key={r.id} style={{ borderBottom: '1px solid #eee', padding: '12px 0' }}>
                <p style={{ margin: '0 0 8px' }}>
                  Asked for <strong>{formatRands(r.requested_amount_cents, sym)}</strong>
                  {r.reason && <span style={{ opacity: 0.7 }}> — {r.reason}</span>}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amounts[r.id] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    style={{ width: 100, padding: 8, borderRadius: 8, border: '1px solid #d1d5db' }}
                    disabled={busyId === r.id}
                  />
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={busyId === r.id}
                    onClick={() => handleApprove(r)}
                  >
                    {busyId === r.id ? 'Working…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    disabled={busyId === r.id}
                    onClick={() => handleDecline(r)}
                    style={{ background: 'transparent', border: '1px solid currentColor', opacity: 0.6, borderRadius: 6, padding: '6px 12px' }}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <p style={{ color: '#dc2626', marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

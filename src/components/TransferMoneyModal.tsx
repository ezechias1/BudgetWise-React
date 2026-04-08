import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';
import type { Mode } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful transfer so the parent can refresh. */
  onTransferred?: () => void;
}

/**
 * Ports `setupMoveMoneyModal` from js/app.js:2499-2620.
 *
 * Reads the per-mode income columns directly so the modal always reflects
 * the latest balance even if `useUserSettings` hasn't refreshed. After a
 * successful transfer, refreshes settings and calls `onTransferred`.
 */
export function TransferMoneyModal({ open, onClose, onTransferred }: Props) {
  const { user } = useAuth();
  const { mode } = useMode();
  const { currency, refresh } = useUserSettings();

  const [balances, setBalances] = useState<Record<Mode, number>>({
    personal: 0,
    business: 0,
    family: 0,
  });
  const [from, setFrom] = useState<Mode>(mode);
  const [to, setTo] = useState<Mode>(mode === 'personal' ? 'business' : 'personal');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current per-mode income whenever the modal opens
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('income, biz_income, fam_income')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setBalances({
        personal: data?.income ?? 0,
        business: data?.biz_income ?? 0,
        family: data?.fam_income ?? 0,
      });
      setFrom(mode);
      setTo(mode === 'personal' ? 'business' : 'personal');
      setAmount('');
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, mode]);

  if (!open) return null;

  const amt = parseFloat(amount) || 0;
  const fromBalance = balances[from];
  const insufficient = amt > 0 && amt > fromBalance;

  const handleConfirm = async () => {
    if (!user || amt <= 0 || from === to) return;
    if (insufficient) {
      setError(`Not enough funds in ${from} (${formatCurrency(fromBalance, currency)})`);
      return;
    }
    setBusy(true);
    setError(null);

    const next = { ...balances, [from]: balances[from] - amt, [to]: balances[to] + amt };

    const { error: err } = await supabase
      .from('user_settings')
      .update({
        income: next.personal,
        biz_income: next.business,
        fam_income: next.family,
      })
      .eq('user_id', user.id);

    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }

    await refresh();
    onTransferred?.();
    onClose();
  };

  const modeLabel = (m: Mode) => m.charAt(0).toUpperCase() + m.slice(1);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: '#16161e',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 24,
          width: 'min(440px, 90vw)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Transfer Money</h2>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginTop: 0 }}>
          Move money between your account ledgers.
        </p>

        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              From — {formatCurrency(fromBalance, currency)} available
            </div>
            <select
              value={from}
              onChange={(ev) => setFrom(ev.target.value as Mode)}
              style={selectStyle}
            >
              {(['personal', 'business', 'family'] as const).map((m) => (
                <option key={m} value={m}>
                  {modeLabel(m)} ({formatCurrency(balances[m], currency)})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block' }}>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              To
            </div>
            <select
              value={to}
              onChange={(ev) => setTo(ev.target.value as Mode)}
              style={selectStyle}
            >
              {(['personal', 'business', 'family'] as const)
                .filter((m) => m !== from)
                .map((m) => (
                  <option key={m} value={m}>
                    {modeLabel(m)}
                  </option>
                ))}
            </select>
          </label>

          <label style={{ display: 'block' }}>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              Amount
            </div>
            <input
              type="number"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              style={selectStyle}
            />
          </label>

          {amt > 0 && !insufficient && from !== to && (
            <div
              style={{
                padding: 10,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 10,
                fontSize: '0.8rem',
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              {modeLabel(from)} → {formatCurrency(fromBalance - amt, currency)} &nbsp;|&nbsp;
              {' '}{modeLabel(to)} → {formatCurrency(balances[to] + amt, currency)}
            </div>
          )}

          {error && (
            <div style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={busy || amt <= 0 || from === to || insufficient}
              style={{ flex: 1 }}
            >
              {busy ? 'Transferring…' : 'Confirm Transfer'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.6)',
                padding: '10px 16px',
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10,
  color: 'rgba(255,255,255,0.9)',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

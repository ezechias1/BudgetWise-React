import { useState } from 'react';
import { formatCurrency } from '@/lib/format';
import type { LinkedAccount } from '@/hooks/useLinkedAccounts';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Props {
  accounts: LinkedAccount[];
  currency: string;
  incomeAmount: number;
  onRoute: (accountId: string) => void;
  onSkip: () => void;
}

/**
 * Modal shown when income is set or updated.
 * Asks the user which bank account the income should be deposited to,
 * then calls onRoute with the chosen account ID.
 */
export function IncomeRoutingModal({
  accounts,
  currency,
  incomeAmount,
  onRoute,
  onSkip,
}: Props) {
  const [selected, setSelected] = useState<string>(
    accounts.find((a) => a.is_primary)?.id || accounts[0]?.id || '',
  );
  const dialog = useDialogA11y();

  if (accounts.length === 0) return null;

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="income-routing-title"
    >
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 id="income-routing-title" style={{ fontSize: '1rem' }}>Where does this income go?</h2>
          <button className="modal-close" onClick={onSkip}>
            ×
          </button>
        </div>

        <p
          style={{
            fontSize: '0.82rem',
            opacity: 0.6,
            margin: '0 0 16px',
            padding: '0 20px',
          }}
        >
          {formatCurrency(incomeAmount, currency)} received — choose which
          account to deposit it to.
        </p>

        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {accounts.map((acc) => {
            const isSelected = selected === acc.id;
            const isPrimary = acc.is_primary === true;
            return (
              <label
                key={acc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: isSelected
                    ? 'rgba(16,185,129,0.1)'
                    : 'rgba(128,128,128,0.06)',
                  border: isSelected
                    ? '1px solid rgba(16,185,129,0.3)'
                    : '1px solid rgba(128,128,128,0.1)',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="incomeAccount"
                  value={acc.id}
                  checked={isSelected}
                  onChange={() => setSelected(acc.id)}
                  style={{ accentColor: '#10b981', width: 16, height: 16 }}
                />
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: 'rgba(99,102,241,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: '0.65rem',
                    color: '#6366f1',
                    flexShrink: 0,
                  }}
                >
                  {(acc.institution_name || 'B').charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {acc.institution_name || 'Bank'}
                    {acc.mask && (
                      <span style={{ fontSize: '0.68rem', opacity: 0.4 }}>
                        ****{acc.mask}
                      </span>
                    )}
                    {isPrimary && (
                      <span
                        style={{
                          fontSize: '0.58rem',
                          fontWeight: 700,
                          background: 'rgba(16,185,129,0.2)',
                          color: '#10b981',
                          padding: '1px 5px',
                          borderRadius: 4,
                        }}
                      >
                        Main
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.68rem', opacity: 0.4 }}>
                    Balance: {formatCurrency(acc.balance_current ?? 0, currency)}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8 }}>
          <button
            className="btn-primary"
            style={{ flex: 1, padding: 10 }}
            onClick={() => selected && onRoute(selected)}
            disabled={!selected}
          >
            Deposit Here
          </button>
          <button
            className="btn-primary"
            style={{
              flex: 0,
              padding: '10px 16px',
              background: 'rgba(128,128,128,0.1)',
              opacity: 0.6,
            }}
            onClick={onSkip}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

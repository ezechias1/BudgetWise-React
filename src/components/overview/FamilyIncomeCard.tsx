import { useState } from 'react';
import type { FamilyIncomeState } from '@/hooks/useFamilyIncome';
import { formatCurrency } from '@/lib/format';

interface Props {
  family: FamilyIncomeState;
  currency: string;
  /** This user's own fam_income — used before any partner has linked. */
  fallbackIncome: number;
}

/**
 * Family-mode replacement for the plain "Family Income" StatCard.
 *
 * Defaults to the combined household figure and switches to a per-partner
 * breakdown. Matches `.stat-card` markup so it sits in the same grid.
 *
 * Deliberately skips StatCard's count-up animation — that animates a single
 * formatted string, and re-running it on every view toggle reads as a glitch
 * rather than a flourish.
 */
export function FamilyIncomeCard({ family, currency, fallbackIncome }: Props) {
  const [view, setView] = useState<'combined' | 'individual'>('combined');

  const { members, combined, partial, hasPartners, loading } = family;

  // Before anyone has linked, this is just the user's own income — no
  // breakdown to offer, so render the ordinary single-value card.
  const total = hasPartners ? combined : fallbackIncome;
  const showToggle = hasPartners && !loading;
  const showing = showToggle && view === 'individual';

  return (
    <div className="stat-card">
      <div className="stat-icon stat-green">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        </svg>
      </div>
      <div className="stat-info" style={{ minWidth: 0, flex: 1 }}>
        <span
          className="stat-label"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          Family Income
          {showToggle && (
            <button
              type="button"
              onClick={() =>
                setView((v) => (v === 'combined' ? 'individual' : 'combined'))
              }
              aria-label={
                showing
                  ? 'Show combined family income'
                  : 'Show income for each person'
              }
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
                textDecoration: 'underline',
                opacity: 0.75,
              }}
            >
              {showing ? 'Combined' : 'Each person'}
            </button>
          )}
        </span>

        {showing ? (
          <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
            {members.map((m) => (
              <div
                key={m.user_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: '0.95rem',
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.display_name}
                </span>
                <span style={{ opacity: m.visible ? 1 : 0.5 }}>
                  {m.visible ? formatCurrency(m.income, currency) : 'Hidden'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="stat-value">{formatCurrency(total, currency)}</span>
        )}

        {partial && (
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--warning, #f59e0b)',
              marginTop: 2,
            }}
          >
            Partner income unavailable — total is incomplete
          </span>
        )}
      </div>
    </div>
  );
}

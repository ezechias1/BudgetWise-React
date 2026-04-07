import { formatCurrency } from '@/lib/format';

interface Props {
  income: number;
  totalSpent: number;
  balance: number;
  currency: string;
}

/**
 * SVG ring showing how much of the monthly income has been spent.
 * Ports the `#budgetRingCard` block from dashboard.html lines 539-570.
 */
export function BudgetRing({ income, totalSpent, balance, currency }: Props) {
  const pct = income > 0 ? Math.min(100, (totalSpent / income) * 100) : 0;
  const circumference = 2 * Math.PI * 50; // r=50 → ~314.16
  const dashOffset = circumference * (1 - pct / 100);

  return (
    <div className="chart-card full-width" id="budgetRingCard">
      <h3>Budget Usage</h3>
      <div className="budget-ring-wrap">
        <div className="budget-ring">
          <svg viewBox="0 0 120 120" width="120" height="120">
            <circle className="budget-ring-bg" cx="60" cy="60" r="50" />
            <circle
              className="budget-ring-fill"
              cx="60"
              cy="60"
              r="50"
              strokeDasharray={circumference.toFixed(2)}
              strokeDashoffset={dashOffset.toFixed(2)}
            />
          </svg>
          <div className="budget-ring-text">
            <span className="budget-ring-pct">{Math.round(pct)}%</span>
            <span className="budget-ring-label">spent</span>
          </div>
        </div>
        <div className="budget-ring-details">
          <div className="ring-detail">
            <span className="ring-dot" style={{ background: '#10b981' }} />
            <span className="ring-detail-label">Income</span>
            <span className="ring-detail-value">{formatCurrency(income, currency)}</span>
          </div>
          <div className="ring-detail">
            <span className="ring-dot" style={{ background: '#ef4444' }} />
            <span className="ring-detail-label">Spent</span>
            <span className="ring-detail-value">{formatCurrency(totalSpent, currency)}</span>
          </div>
          <div className="ring-detail">
            <span className="ring-dot" style={{ background: '#3b82f6' }} />
            <span className="ring-detail-label">Balance</span>
            <span className="ring-detail-value">{formatCurrency(balance, currency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

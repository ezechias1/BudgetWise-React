import { useMemo } from 'react';
import { useOverviewStats } from '@/hooks/useOverviewStats';
import { useSavingsGoals } from '@/hooks/useSavingsGoals';
import { buildAdvice, buildComfort } from '@/lib/advice';
import { formatCurrency } from '@/lib/format';

/**
 * Ports #page-advice (dashboard.html lines 904-954) + renderAdvice()
 * from js/app.js (line 2877). All computation lives in lib/advice.ts
 * so it's unit-testable and reusable.
 */
export default function AdvicePage() {
  const stats = useOverviewStats();
  const { goals } = useSavingsGoals();

  const cards = useMemo(
    () => buildAdvice(stats.monthExpenses, goals, stats.income, stats.savingsGoal, stats.currency),
    [stats.monthExpenses, goals, stats.income, stats.savingsGoal, stats.currency],
  );

  const comfort = useMemo(
    () => buildComfort(stats.monthExpenses, stats.income, stats.currency),
    [stats.monthExpenses, stats.income, stats.currency],
  );

  return (
    <section className="page active" id="page-advice">
      <div className="page-header">
        <div>
          <h1>Smart Advice</h1>
          <p className="page-subtitle">Personalized tips based on your spending</p>
        </div>
      </div>

      {/* Salary Insight */}
      <div className="chart-card full-width comfort-card">
        <h3>Salary Insight</h3>
        <p className="comfort-subtitle">
          Based on your spending habits, here's what you should be earning
        </p>
        <div className="comfort-grid">
          <div className="comfort-item">
            <span className="comfort-label">Monthly Expenses</span>
            <span className="comfort-value">
              {formatCurrency(comfort.monthlyExpenses, stats.currency)}
            </span>
          </div>
          <div className="comfort-item">
            <span className="comfort-label">+ 20% Emergency Buffer</span>
            <span className="comfort-value">
              {formatCurrency(comfort.buffer, stats.currency)}
            </span>
          </div>
          <div className="comfort-item">
            <span className="comfort-label">+ 15% Savings</span>
            <span className="comfort-value">
              {formatCurrency(comfort.savingsLine, stats.currency)}
            </span>
          </div>
          <div className="comfort-item comfort-total">
            <span className="comfort-label">Comfortable Monthly Income</span>
            <span className="comfort-value">
              {formatCurrency(comfort.comfortMonthly, stats.currency)}
            </span>
          </div>
          <div className="comfort-item comfort-total">
            <span className="comfort-label">Comfortable Yearly Income</span>
            <span className="comfort-value">
              {formatCurrency(comfort.comfortYearly, stats.currency)}
            </span>
          </div>
        </div>
        <p className="comfort-note">{comfort.note}</p>
      </div>

      {/* Advice cards */}
      <div className="advice-grid">
        {cards.map((card, i) => (
          <div key={i} className={`advice-card ${card.type}`}>
            <div className="advice-icon">{card.icon}</div>
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

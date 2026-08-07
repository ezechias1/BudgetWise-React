import { useMemo } from 'react';
import { useOverviewStats } from '@/hooks/useOverviewStats';
import { useSavingsGoals } from '@/hooks/useSavingsGoals';
import { useExpenses } from '@/hooks/useExpenses';
import { buildAdvice, buildAIInsights, buildComfort } from '@/lib/advice';
import { formatCurrency, monthKey } from '@/lib/format';

/**
 * Ports #page-advice (dashboard.html lines 904-954) + renderAdvice()
 * from js/app.js (line 2877). All computation lives in lib/advice.ts
 * so it's unit-testable and reusable.
 */
export default function AdvicePage() {
  const stats = useOverviewStats();
  const { goals } = useSavingsGoals();
  const { expenses } = useExpenses();

  const cards = useMemo(
    () => buildAdvice(stats.monthExpenses, goals, stats.income, stats.savingsGoal, stats.currency),
    [stats.monthExpenses, goals, stats.income, stats.savingsGoal, stats.currency],
  );

  const comfort = useMemo(
    () => buildComfort(stats.monthExpenses, stats.income, stats.currency),
    [stats.monthExpenses, stats.income, stats.currency],
  );

  // AI insights need last month's expenses for the month-over-month card.
  const aiInsights = useMemo(() => {
    const now = new Date();
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = monthKey(prevDate);
    const prevExpenses = expenses.filter((e) => e.date.startsWith(prevKey));
    return buildAIInsights(stats.monthExpenses, prevExpenses, stats.income, stats.currency);
  }, [expenses, stats.monthExpenses, stats.income, stats.currency]);

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

      {/* AI Spending Insights — port of dashboard.html:944-953 */}
      <div className="chart-card full-width ai-insights-card">
        <div
          className="ai-insights-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}
        >
          <h3 style={{ margin: 0 }}>AI Spending Insights</h3>
          <span
            className="ai-badge"
            style={{
              fontSize: '0.7rem',
              padding: '4px 10px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            Smart Analysis
          </span>
        </div>
        <div className="ai-insights-body">
          {aiInsights.length === 0 ? (
            <p className="ai-placeholder">
              Add expenses to unlock AI-powered insights about your spending patterns.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              }}
            >
              {aiInsights.map((insight, i) => {
                const accent =
                  insight.type === 'positive'
                    ? '#10b981'
                    : insight.type === 'negative'
                      ? '#ef4444'
                      : '#818cf8';
                const bg =
                  insight.type === 'positive'
                    ? 'rgba(16,185,129,0.06)'
                    : insight.type === 'negative'
                      ? 'rgba(239,68,68,0.06)'
                      : 'rgba(99,102,241,0.06)';
                const border =
                  insight.type === 'positive'
                    ? 'rgba(16,185,129,0.15)'
                    : insight.type === 'negative'
                      ? 'rgba(239,68,68,0.15)'
                      : 'rgba(99,102,241,0.15)';
                return (
                  <div
                    key={i}
                    className={`ai-insight ai-insight-${insight.type}`}
                    style={{
                      padding: '14px 16px',
                      background: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 12,
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    <span style={{ fontSize: '1.6rem', flexShrink: 0 }}>
                      {insight.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4
                        style={{
                          margin: '0 0 4px',
                          fontSize: '0.9rem',
                          fontWeight: 600,
                          color: accent,
                        }}
                      >
                        {insight.title}
                      </h4>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.82rem',
                          opacity: 0.7,
                          lineHeight: 1.5,
                        }}
                      >
                        {insight.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

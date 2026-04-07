import { useState } from 'react';
import { useExpenses } from '@/hooks/useExpenses';
import { useOverviewStats } from '@/hooks/useOverviewStats';
import { formatCurrency } from '@/lib/format';
import { CATEGORY_COLORS, type Category } from '@/lib/categories';
import { ExpenseModal } from '@/components/ExpenseModal';
import {
  SpendingPieChart,
  IncomeVsExpensesChart,
  SpendingTrendChart,
} from '@/components/overview/OverviewCharts';
import { BudgetRing } from '@/components/overview/BudgetRing';

/** Greeting based on current hour (ported from vanilla welcome banner). */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Ports #page-overview from dashboard.html (lines 397-618) plus the
 * compute/render logic from renderOverview() (js/app.js line 2254).
 *
 * Scope for this round: welcome banner, stat cards, pie + bar charts,
 * budget ring, savings progress bar, 6-month trend line, recent
 * transactions table. Deferred: animate-stat-counters, month-comparison,
 * budget-warnings, move-money, receipt scan, drill-down click handlers.
 */
export default function OverviewPage() {
  const stats = useOverviewStats();
  const { addExpense } = useExpenses();
  const [modalOpen, setModalOpen] = useState(false);

  const monthLabel = new Date().toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      <section className="page active" id="page-overview">
        <div className="welcome-banner">
          <div className="welcome-left">
            <h2>{greeting()}</h2>
            <p>Here's your financial snapshot</p>
          </div>
        </div>

        <div className="page-header">
          <div>
            <h1>Overview</h1>
            <p className="page-subtitle">{monthLabel}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn-add"
              onClick={() => setModalOpen(true)}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14m-7-7h14" />
              </svg>
              Add Expense
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="stats-grid">
          <StatCard
            label="Monthly Income"
            value={formatCurrency(stats.income, stats.currency)}
            iconClass="stat-green"
            icon={
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            }
          />
          <StatCard
            label="Total Spent"
            value={formatCurrency(stats.totalSpent, stats.currency)}
            iconClass="stat-red"
            icon={<path d="M18 15l-6-6-6 6" />}
          />
          <StatCard
            label="Balance"
            value={formatCurrency(stats.balance, stats.currency)}
            iconClass="stat-blue"
            icon={
              <>
                <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" />
                <path d="M9 7h6m-6 4h6m-6 4h4" />
              </>
            }
          />
          <StatCard
            label="Saved This Month"
            value={formatCurrency(stats.saved, stats.currency)}
            iconClass="stat-purple"
            icon={<path d="M22 12h-4l-3 9L9 3l-3 9H2" />}
          />
        </div>

        {/* Charts row */}
        <div className="charts-grid">
          <div className="chart-card">
            <h3>Spending by Category</h3>
            <div className="chart-container">
              <SpendingPieChart categoryTotals={stats.categoryTotals} />
            </div>
          </div>
          <div className="chart-card">
            <h3>Income vs Expenses</h3>
            <div className="chart-container">
              <IncomeVsExpensesChart
                income={stats.income}
                totalSpent={stats.totalSpent}
                savingsGoal={stats.savingsGoal}
                saved={stats.saved}
              />
            </div>
          </div>
        </div>

        {/* Budget ring */}
        <BudgetRing
          income={stats.income}
          totalSpent={stats.totalSpent}
          balance={stats.balance}
          currency={stats.currency}
        />

        {/* Savings progress */}
        <div className="chart-card full-width">
          <h3>Savings Goal Progress</h3>
          <div className="savings-progress-bar">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${stats.savingsPct}%` }}
              />
            </div>
            <div className="progress-labels">
              <span>Saved: {formatCurrency(stats.saved, stats.currency)}</span>
              <span>Goal: {formatCurrency(stats.savingsGoal, stats.currency)}</span>
            </div>
          </div>
        </div>

        {/* Trend */}
        <div className="chart-card full-width">
          <h3>Spending Trends (6 Months)</h3>
          <div className="chart-container chart-wide">
            <SpendingTrendChart trend={stats.trend} />
          </div>
        </div>

        {/* Recent transactions */}
        <div className="chart-card full-width">
          <h3>Recent Expenses</h3>
          <div className="table-wrap">
            {stats.recent.length === 0 ? (
              <div className="empty-state empty-state-action">
                <svg
                  viewBox="0 0 24 24"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ opacity: 0.3 }}
                >
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                </svg>
                <p>No expenses yet</p>
                <button
                  type="button"
                  className="empty-action-btn"
                  onClick={() => setModalOpen(true)}
                >
                  Add Your First Expense
                </button>
              </div>
            ) : (
              <table className="expense-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((e) => {
                    const color = CATEGORY_COLORS[e.category as Category] ?? '#6b7280';
                    return (
                      <tr key={e.id}>
                        <td>{e.date}</td>
                        <td>
                          <span
                            className="category-badge"
                            style={{ background: `${color}20`, color }}
                          >
                            {e.category}
                          </span>
                        </td>
                        <td>{e.description}</td>
                        <td>{formatCurrency(e.amount, stats.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <ExpenseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={addExpense}
      />
    </>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  iconClass: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, iconClass, icon }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconClass}`}>
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {icon}
        </svg>
      </div>
      <div className="stat-info">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useExpenses } from '@/hooks/useExpenses';
import { useOverviewStats } from '@/hooks/useOverviewStats';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useMode } from '@/contexts/ModeContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/format';
import { CATEGORY_COLORS } from '@/lib/categories';
import { ExpenseModal } from '@/components/ExpenseModal';
import { GlobalSearch } from '@/components/GlobalSearch';
import { TransferMoneyModal } from '@/components/TransferMoneyModal';
import { getCategoriesForMode } from '@/lib/categories';
import { todayIso } from '@/lib/format';
import type { Mode } from '@/types';
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

/** First word of the user's name — matches vanilla `updateWelcomeGreeting()`. */
function firstName(fullName: string | undefined, email: string | undefined): string {
  if (fullName && fullName.trim()) return fullName.trim().split(/\s+/)[0];
  if (email) return email.split('@')[0];
  return 'there';
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
  const { addExpense, moveExpense, deleteExpense, refresh } = useExpenses();
  const { mode } = useMode();
  const { user } = useAuth();
  const { companyName, familyName } = useUserSettings();
  const userFirstName = firstName(
    user?.user_metadata?.full_name as string | undefined,
    user?.email,
  );

  // Mode-specific display name for the welcome banner. Business uses
  // company_name, family uses family_name, personal uses the user's first name.
  const displayName =
    mode === 'business'
      ? companyName?.trim() || userFirstName
      : mode === 'family'
        ? familyName?.trim() || userFirstName
        : userFirstName;
  const [modalOpen, setModalOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [comparisonDismissed, setComparisonDismissed] = useState(false);

  // Quick Add bar state — ports the inline `quickAddBar` from dashboard.html:499-507
  const modeCategories = useMemo(() => getCategoriesForMode(mode), [mode]);
  const [quickCategory, setQuickCategory] = useState<string>(
    modeCategories[0]?.value ?? 'Other',
  );
  const [quickAmount, setQuickAmount] = useState('');
  const [quickDesc, setQuickDesc] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);

  // Reset the selected category when mode changes so it doesn't keep a
  // personal-mode value while in business mode.
  useEffect(() => {
    setQuickCategory(modeCategories[0]?.value ?? 'Other');
  }, [mode, modeCategories]);

  const handleQuickAdd = async () => {
    const amt = parseFloat(quickAmount);
    if (!amt || amt <= 0) return;
    setQuickBusy(true);
    await addExpense({
      category: quickCategory,
      amount: amt,
      description: quickDesc.trim() || quickCategory,
      date: todayIso(),
      recurring: 'no',
    });
    setQuickAmount('');
    setQuickDesc('');
    setQuickBusy(false);
  };

  const handleMove = async (id: string, target: Mode) => {
    await moveExpense(id, target);
    setMoveTargetId(null);
    refresh();
  };

  const moveTarget = stats.recent.find((e) => e.id === moveTargetId);

  const monthLabel = new Date().toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      <section className="page active" id="page-overview">
        <div className="welcome-banner">
          <div className="welcome-left">
            <h2>
              {greeting()}, {displayName}!
            </h2>
            <p>
              {mode === 'business'
                ? "Let's review your business performance"
                : mode === 'family'
                  ? "Here's your family budget snapshot"
                  : 'Your budget overview awaits'}
            </p>
          </div>
        </div>
        <GlobalSearch />

        {/* Month Comparison banner — vanilla shows this BEFORE the page header */}
        {stats.monthCompareText && !comparisonDismissed && (
          <div
            className="monthly-summary"
            id="monthlySummary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              marginBottom: 16,
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 12,
              fontSize: '0.88rem',
            }}
          >
            <span className="summary-icon" style={{ fontSize: '1.2rem' }}>📊</span>
            <p style={{ flex: 1, margin: 0, color: 'inherit' }}>
              {stats.monthCompareText}
            </p>
            <button
              type="button"
              className="summary-dismiss"
              onClick={() => setComparisonDismissed(true)}
              aria-label="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                opacity: 0.4,
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        )}

        <div className="page-header">
          <div>
            <h1>Overview</h1>
            <p className="page-subtitle">{monthLabel}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Scan Receipt button — port of #scanReceiptBtn in dashboard.html:432 */}
            <button
              type="button"
              className="btn-export btn-scan"
              onClick={() =>
                alert('Receipt scanner (OCR) — coming soon in this React port.')
              }
              style={{ gap: 6 }}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="7" y1="8" x2="17" y2="8" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="7" y1="16" x2="13" y2="16" />
              </svg>
              <span className="btn-scan-label">Scan</span>
            </button>
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

        {/* Stats grid — labels change per mode to match vanilla */}
        <div className="stats-grid">
          <StatCard
            label={
              mode === 'business'
                ? 'Monthly Revenue'
                : mode === 'family'
                  ? 'Family Income'
                  : 'Monthly Income'
            }
            value={formatCurrency(stats.income, stats.currency)}
            iconClass="stat-green"
            icon={
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            }
          />
          <StatCard
            label={mode === 'business' ? 'Total Expenses' : 'Total Spent'}
            value={formatCurrency(stats.totalSpent, stats.currency)}
            iconClass="stat-red"
            icon={<path d="M18 15l-6-6-6 6" />}
          />
          <StatCard
            label={mode === 'business' ? 'Net Profit' : 'Balance'}
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
            label={
              mode === 'business' ? 'Budget Surplus' : 'Saved This Month'
            }
            value={formatCurrency(stats.saved, stats.currency)}
            iconClass="stat-purple"
            icon={<path d="M22 12h-4l-3 9L9 3l-3 9H2" />}
          />
        </div>

        {/* Transfer Money button — port of dashboard.html:484-487 */}
        <button
          type="button"
          onClick={() => setTransferOpen(true)}
          style={{
            margin: '-4px 0 10px',
            padding: '8px 16px',
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.15)',
            borderRadius: 10,
            color: '#10b981',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: 'auto',
            fontFamily: 'inherit',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M17 1l4 4-4 4" />
            <path d="M3 11V9a4 4 0 014-4h14" />
            <path d="M7 23l-4-4 4-4" />
            <path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          Transfer Money
        </button>

        {/* Quick Add Expense — port of dashboard.html:498-507 */}
        <div className="quick-add-bar" id="quickAddBar">
          <select
            id="quickCategory"
            className="quick-select"
            value={quickCategory}
            onChange={(ev) => setQuickCategory(ev.target.value)}
          >
            {modeCategories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            id="quickAmount"
            placeholder="Amount"
            min="0"
            step="0.01"
            className="quick-input"
            value={quickAmount}
            onChange={(ev) => setQuickAmount(ev.target.value)}
          />
          <input
            type="text"
            id="quickDesc"
            placeholder="Description"
            className="quick-input quick-desc"
            value={quickDesc}
            onChange={(ev) => setQuickDesc(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') handleQuickAdd();
            }}
          />
          <button
            type="button"
            className="quick-add-btn"
            id="quickAddBtn"
            onClick={handleQuickAdd}
            disabled={quickBusy}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 5v14m-7-7h14" />
            </svg>
            Add
          </button>
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

        {/* Savings / Budget progress — label changes in business mode */}
        <div className="chart-card full-width">
          <h3>
            {mode === 'business' ? 'Budget Target Progress' : 'Savings Goal Progress'}
          </h3>
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
            <SpendingTrendChart trend={stats.trend} income={stats.income} />
          </div>
        </div>

        {/* Spending-trend pill — month-over-month total comparison shown
            beneath the chart. Matches vanilla `monthComparison`. */}
        {stats.trend.length >= 2 && (() => {
          const current = stats.trend[stats.trend.length - 1].total;
          const prev = stats.trend[stats.trend.length - 2].total;
          if (prev === 0 && current === 0) return null;
          const prevLabel = stats.trend[stats.trend.length - 2].label;
          if (prev === 0) {
            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  marginBottom: 16,
                  background: 'rgba(99,102,241,0.06)',
                  border: '1px solid rgba(99,102,241,0.12)',
                  borderRadius: 10,
                  fontSize: '0.85rem',
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>📈</span>
                <span>New activity this month vs {prevLabel}.</span>
              </div>
            );
          }
          const diffPct = Math.round(((current - prev) / prev) * 100);
          const down = diffPct < 0;
          const same = Math.abs(diffPct) < 1;
          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                marginBottom: 16,
                background: same
                  ? 'rgba(255,255,255,0.04)'
                  : down
                    ? 'rgba(16,185,129,0.06)'
                    : 'rgba(239,68,68,0.06)',
                border: same
                  ? '1px solid rgba(255,255,255,0.08)'
                  : down
                    ? '1px solid rgba(16,185,129,0.15)'
                    : '1px solid rgba(239,68,68,0.15)',
                borderRadius: 10,
                fontSize: '0.85rem',
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>
                {same ? '➖' : down ? '📉' : '📈'}
              </span>
              <span>
                {same
                  ? `Same spending as ${prevLabel}.`
                  : down
                    ? `Spending is down ${Math.abs(diffPct)}% vs ${prevLabel}.`
                    : `Spending is up ${diffPct}% vs ${prevLabel}.`}
              </span>
            </div>
          );
        })()}

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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((e) => {
                    const color = CATEGORY_COLORS[e.category] ?? '#6b7280';
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
                        <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn-move-expense"
                            onClick={() => setMoveTargetId(e.id)}
                            title="Move to another account"
                            style={{
                              background: 'rgba(59,130,246,0.1)',
                              border: '1px solid rgba(59,130,246,0.2)',
                              color: '#60a5fa',
                              cursor: 'pointer',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: '0.7rem',
                              fontFamily: 'inherit',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="12"
                              height="12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M18 8l4 4-4 4" />
                              <path d="M2 12h20" />
                            </svg>
                            Move
                          </button>
                          <button
                            type="button"
                            className="btn-delete"
                            onClick={async () => {
                              if (!confirm('Delete this expense?')) return;
                              await deleteExpense(e.id);
                              refresh();
                            }}
                            aria-label={`Delete ${e.description}`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        </td>
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

      <TransferMoneyModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onTransferred={refresh}
      />

      {moveTarget && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setMoveTargetId(null)}
        >
          <div
            className="modal-box"
            onClick={(ev) => ev.stopPropagation()}
            style={{
              background: '#16161e',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              padding: 24,
              minWidth: 320,
              maxWidth: 400,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Move Expense</h3>
            <div
              style={{
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 600 }}>{moveTarget.category}</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                {moveTarget.description} — {formatCurrency(moveTarget.amount, stats.currency)}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', marginTop: 4 }}>
                {moveTarget.date}
              </div>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>Move to:</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['personal', 'business', 'family'] as const)
                .filter((m) => m !== mode)
                .map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="btn-add"
                    onClick={() => handleMove(moveTarget.id, m)}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
            </div>
            <button
              type="button"
              onClick={() => setMoveTargetId(null)}
              style={{
                marginTop: 16,
                width: '100%',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.6)',
                padding: '8px',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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

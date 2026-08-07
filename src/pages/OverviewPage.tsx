import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { scanReceipt, type ParsedReceipt } from '@/lib/receipt-scan';
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
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { CrossModeDepositBanner } from '@/components/CrossModeDepositBanner';
import { OnboardingTour } from '@/components/OnboardingTour';
import { OverviewSkeleton } from '@/components/Skeleton';

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
  const navigate = useNavigate();
  const stats = useOverviewStats();
  const { addExpense, moveExpense, deleteExpense, refresh } = useExpenses();
  const { mode } = useMode();
  const { user } = useAuth();
  const { companyName, familyName, currency: userCurrency } = useUserSettings();
  const {
    accounts: linkedAccounts,
    totalBalance: bankTotalBalance,
    crossModeAccounts,
  } = useLinkedAccounts();
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

  // Receipt scanner state — ported from vanilla `setupReceiptScanning()`
  // (js/app.js:3503). The hidden <input type="file"> is triggered by the
  // Scan button click; Tesseract.js is lazy-loaded inside scanReceipt().
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanDefaults, setScanDefaults] = useState<ParsedReceipt | undefined>(
    undefined,
  );

  const handleScanClick = () => {
    receiptInputRef.current?.click();
  };

  const handleReceiptFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    // Always clear the input so picking the same file twice still fires onChange.
    ev.target.value = '';
    if (!file) return;

    setScanning(true);
    try {
      // AUDIT Imp #15 / #25: 60s timeout so a hung Tesseract load on a slow
      // connection doesn't leave the scanning overlay forever.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR timed out after 60s')), 60_000),
      );
      const parsed = await Promise.race([scanReceipt(file), timeout]);
      setScanDefaults(parsed);
      setModalOpen(true);
      if (!parsed.amount && !parsed.description) {
        // Non-blocking notice — modal still opens so the user can type manually.
        console.warn('Receipt OCR found no fields, opening blank modal.');
      }
    } catch (err) {
      console.error('Receipt scan failed:', err);
      const msg = err instanceof Error ? err.message : 'OCR library failed to load';
      alert(`Could not scan the receipt (${msg}). Opening manual entry instead.`);
      setScanDefaults(undefined);
      setModalOpen(true);
    } finally {
      setScanning(false);
    }
  };

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
      {stats.loading && <OverviewSkeleton />}
      <section className="page active" id="page-overview" style={stats.loading ? { display: 'none' } : undefined}>
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

        {/* Cross-mode account warning banner */}
        <CrossModeDepositBanner
          crossModeAccounts={crossModeAccounts}
          currentMode={mode}
        />

        <div className="page-header">
          <div>
            <h1>Overview</h1>
            <p className="page-subtitle">{monthLabel}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Scan Receipt button — port of #scanReceiptBtn in dashboard.html:432.
                Triggers a hidden file input; on select we run OCR via
                src/lib/receipt-scan.ts and open ExpenseModal pre-filled. */}
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleReceiptFile}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
            <button
              type="button"
              className="btn-export btn-scan"
              onClick={handleScanClick}
              disabled={scanning}
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

        {/* Accounts Wallet — shows all linked bank accounts with balances */}
        {linkedAccounts.length > 0 && (
          <div
            className="chart-card full-width"
            style={{ marginBottom: 12, padding: '14px 16px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700 }}>
                My Accounts
              </h3>
              <span
                style={{
                  fontSize: '0.75rem',
                  opacity: 0.5,
                }}
              >
                Total: {formatCurrency(bankTotalBalance, userCurrency)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {linkedAccounts.map((acc) => {
                const isPrimary = acc.is_primary === true;
                return (
                  <div
                    key={acc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      background: isPrimary
                        ? 'rgba(16,185,129,0.08)'
                        : 'rgba(128,128,128,0.06)',
                      border: isPrimary
                        ? '1px solid rgba(16,185,129,0.2)'
                        : '1px solid transparent',
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'rgba(99,102,241,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.7rem',
                        color: '#6366f1',
                        flexShrink: 0,
                      }}
                    >
                      {(acc.institution_name || 'B').charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '0.82rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {acc.institution_name || 'Bank'}
                        {acc.mask && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              opacity: 0.4,
                            }}
                          >
                            ****{acc.mask}
                          </span>
                        )}
                        {isPrimary && (
                          <span
                            style={{
                              fontSize: '0.6rem',
                              fontWeight: 700,
                              background: 'rgba(16,185,129,0.2)',
                              color: '#10b981',
                              padding: '1px 6px',
                              borderRadius: 4,
                            }}
                          >
                            Main
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          opacity: 0.45,
                        }}
                      >
                        {acc.account_subtype || acc.account_type || 'Account'}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', flexShrink: 0 }}>
                      {formatCurrency(acc.balance_current ?? 0, userCurrency)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
              // AUDIT Imp #14: rapid Enter presses bypassed the quickBusy
              // guard on the button. Gate by the same state here.
              if (ev.key === 'Enter' && !quickBusy) handleQuickAdd();
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
              <SpendingPieChart
                categoryTotals={stats.categoryTotals}
                onCategoryClick={(cat) => navigate(`/dashboard/expenses?category=${encodeURIComponent(cat)}`)}
              />
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
              className={`month-comparison ${same ? 'same' : down ? 'down' : 'up'}`}
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

      <OnboardingTour />

      <ExpenseModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          // Clear OCR-seeded values after close so the next manual "Add
          // Expense" click opens an empty form.
          setScanDefaults(undefined);
        }}
        onSubmit={addExpense}
        defaultValues={scanDefaults}
      />

      {/* OCR scanning overlay — shown while Tesseract.js loads + recognizes. */}
      {scanning && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            color: '#fff',
            fontFamily: 'inherit',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              border: '4px solid rgba(128,128,128,0.2)',
              borderTopColor: '#10b981',
              borderRadius: '50%',
              animation: 'receipt-scan-spin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: '1rem', fontWeight: 600 }}>
            Scanning receipt…
          </div>
          <div
            style={{
              fontSize: '0.8rem',
              opacity: 0.6,
              maxWidth: 260,
              textAlign: 'center',
            }}
          >
            Running OCR on your image. This may take a few seconds the first
            time while the library loads.
          </div>
          <style>{`@keyframes receipt-scan-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

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
            className="modal"
            onClick={(ev) => ev.stopPropagation()}
            style={{ maxWidth: 400 }}
          >
            <h2 style={{ marginTop: 0 }}>Move Expense</h2>
            <div className="drill-day" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600 }}>{moveTarget.category}</div>
              <div className="drill-item" style={{ fontSize: '0.85rem' }}>
                {moveTarget.description} — {formatCurrency(moveTarget.amount, stats.currency)}
              </div>
              <div className="drill-item" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                {moveTarget.date}
              </div>
            </div>
            <p className="modal-desc" style={{ marginBottom: 12 }}>Move to:</p>
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
              className="btn-secondary"
              onClick={() => setMoveTargetId(null)}
              style={{ marginTop: 16, width: '100%' }}
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
  // Animate the number counting up from 0
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    // Extract the numeric part (e.g. "R5,000.00" → 5000)
    const numStr = value.replace(/[^0-9.\-]/g, '');
    const target = parseFloat(numStr) || 0;
    const prefix = value.match(/^[^0-9\-]*/)?.[0] || '';
    const hasDecimals = value.includes('.');

    if (target === 0 || prevValue.current === value) {
      setDisplay(value);
      prevValue.current = value;
      return;
    }
    prevValue.current = value;

    const duration = 600; // ms
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      const formatted = hasDecimals
        ? current.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : current.toLocaleString(undefined, { maximumFractionDigits: 0 });
      setDisplay(prefix + formatted);
      if (progress < 1) requestAnimationFrame(tick);
      else setDisplay(value); // snap to exact formatted value
    };
    requestAnimationFrame(tick);
  }, [value]);

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
        <span className="stat-value">{display}</span>
      </div>
    </div>
  );
}

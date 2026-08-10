import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { ExpenseModal } from '@/components/ExpenseModal';
import { TripsTab } from '@/components/TripsTab';
import { UndoToast } from '@/components/UndoToast';
import { useExpenses } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useMode } from '@/contexts/ModeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { CATEGORY_COLORS, getCategoriesForMode } from '@/lib/categories';
import { formatCurrency, getCurrencySymbol, monthKey } from '@/lib/format';
import { exportExpensesToCSV, exportExpensesToPDF } from '@/lib/exports';
import type { Expense, Mode } from '@/types';

interface CustomCategoryRow {
  id: string;
  user_id: string;
  account_mode: Mode;
  name: string;
  color: string | null;
  icon: string | null;
}

type BudgetLimits = Record<string, number>;

// Namespaced per-user-per-mode localStorage key — only used as a fallback
// when the user_settings.budget_limits column doesn't exist yet.
function limitsLsKey(userId: string, mode: Mode) {
  return `bw_budget_limits_${userId}_${mode}`;
}

/**
 * Ports the #page-expenses section from dashboard.html (lines 621-695)
 * and its logic from js/app.js `renderAllExpenses()` (line 2360) +
 * `attachDeleteHandlers()` (line 2388).
 *
 * Round 2 scope: list, month filter, category filter, search, add, delete.
 * Deferred: CSV/PDF export, budget limits, recurring automations, move-to-account.
 */

/**
 * Rolling 6-month window going backwards from the current month. Matches
 * vanilla js/app.js:698-705 exactly — data-independent, so garbage dates
 * in the `expenses` rows can't pollute the dropdown.
 */
function buildMonthOptions(): Array<{ key: string; label: string }> {
  const now = new Date();
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: monthKey(d),
      label: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

export default function ExpensesPage() {
  const {
    expenses,
    loading,
    error,
    addExpense,
    deleteExpense,
    moveExpense,
    updateExpense,
    refresh,
  } = useExpenses();
  const { currency, income } = useUserSettings();
  const { mode } = useMode();
  const { user } = useAuth();

  const modeCategories = useMemo(() => getCategoriesForMode(mode), [mode]);
  // Trips is Personal/Family only — bounce back to the Expenses list if the
  // user switches to Business mode while it's open.
  const [activeTab, setActiveTab] = useState<'expenses' | 'trips'>('expenses');
  useEffect(() => {
    if (mode === 'business' && activeTab === 'trips') setActiveTab('expenses');
  }, [mode, activeTab]);
  const [month, setMonth] = useState<string>(() => monthKey());
  const [category, setCategory] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('category') || '';
  });
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // Budget limits state — loaded lazily when modal opens, also used by the
  // warning banner above the table. Falls back to localStorage if the
  // user_settings.budget_limits JSONB column doesn't exist yet.
  const [budgetLimits, setBudgetLimits] = useState<BudgetLimits>({});
  const [limitsFallback, setLimitsFallback] = useState(false);

  const currencySymbol = getCurrencySymbol(currency);

  // Load saved budget limits from Supabase (or localStorage fallback). We do
  // this on mount + whenever the user/mode changes so the warning banner can
  // render without first opening the Limits modal.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('user_settings')
        .select('budget_limits')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (err || !data) {
        // Column likely missing — fall back to localStorage
        setLimitsFallback(true);
        try {
          const raw = localStorage.getItem(limitsLsKey(user.id, mode));
          setBudgetLimits(raw ? (JSON.parse(raw) as BudgetLimits) : {});
        } catch {
          setBudgetLimits({});
        }
        return;
      }
      const row = data as { budget_limits: BudgetLimits | null };
      setBudgetLimits(row.budget_limits ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [user, mode]);

  const saveBudgetLimits = useCallback(
    async (next: BudgetLimits): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      if (!limitsFallback) {
        const { error: err } = await supabase
          .from('user_settings')
          .update({ budget_limits: next })
          .eq('user_id', user.id);
        if (!err) {
          setBudgetLimits(next);
          return { error: null };
        }
        // Column missing — switch to fallback mode
        setLimitsFallback(true);
      }
      try {
        localStorage.setItem(limitsLsKey(user.id, mode), JSON.stringify(next));
        setBudgetLimits(next);
        return { error: null };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    [user, mode, limitsFallback],
  );

  const handleExportCSV = () => exportExpensesToCSV(filtered);
  const handleExportPDF = () =>
    exportExpensesToPDF({ expenses: filtered, income, currencySymbol });

  const handleMove = async (id: string, target: Mode) => {
    await moveExpense(id, target);
    setMoveTargetId(null);
    refresh();
  };

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  // Apply month / category / search filters — ports logic from renderAllExpenses
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (!e.date.startsWith(month)) return false;
      if (category && e.category !== category) return false;
      if (
        needle &&
        e.description.toLowerCase().indexOf(needle) === -1 &&
        e.category.toLowerCase().indexOf(needle) === -1
      )
        return false;
      return true;
    });
  }, [expenses, month, category, search]);

  const [undoData, setUndoData] = useState<{ id: string; expense: Record<string, unknown> } | null>(null);

  const handleDelete = async (id: string) => {
    // Store the expense data before deleting so we can restore on undo
    const exp = expenses.find((e) => e.id === id);
    if (!exp) return;
    const { error: delErr } = await deleteExpense(id);
    if (delErr) { alert(`Delete failed: ${delErr}`); return; }
    setUndoData({
      id,
      expense: {
        category: exp.category,
        description: exp.description,
        amount: exp.amount,
        date: exp.date,
        recurring: exp.recurring || 'no',
      },
    });
  };

  const handleUndo = async () => {
    if (!undoData) return;
    await addExpense(undoData.expense as unknown as Parameters<typeof addExpense>[0]);
    setUndoData(null);
  };

  // Totals per category for the currently selected month — used by the
  // over-limit warning banner above the table.
  const currentMonthSpendByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) {
      if (!e.date.startsWith(month)) continue;
      map[e.category] = (map[e.category] ?? 0) + Number(e.amount);
    }
    return map;
  }, [expenses, month]);

  const overLimitCategories = useMemo(() => {
    const out: Array<{ category: string; spent: number; limit: number }> = [];
    for (const [cat, lim] of Object.entries(budgetLimits)) {
      if (!lim || lim <= 0) continue;
      const spent = currentMonthSpendByCategory[cat] ?? 0;
      if (spent > lim) out.push({ category: cat, spent, limit: lim });
    }
    return out;
  }, [budgetLimits, currentMonthSpendByCategory]);

  // Recurring expense detection — if the same description+category appears
  // in 3+ different months, suggest marking it as recurring.
  const [dismissedRecurring, setDismissedRecurring] = useState<Set<string>>(new Set());
  const recurringSuggestions = useMemo(() => {
    // Group expenses by description+category key
    const map = new Map<string, Set<string>>();
    for (const e of expenses) {
      if (e.recurring !== 'no') continue; // already marked
      const key = `${e.description.toLowerCase().trim()}|${e.category}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(e.date.slice(0, 7)); // month key YYYY-MM
    }
    const suggestions: Array<{ description: string; category: string; months: number }> = [];
    map.forEach((months, key) => {
      if (months.size >= 3 && !dismissedRecurring.has(key)) {
        const [desc, cat] = key.split('|');
        suggestions.push({ description: desc, category: cat, months: months.size });
      }
    });
    return suggestions;
  }, [expenses, dismissedRecurring]);

  const markAsRecurring = async (description: string, category: string) => {
    // Find the most recent matching expense and update it
    const match = expenses.find(
      (e) =>
        e.description.toLowerCase().trim() === description &&
        e.category === category &&
        e.recurring === 'no',
    );
    if (match) {
      await updateExpense(match.id, { recurring: 'monthly' });
    }
    setDismissedRecurring((prev) => new Set(prev).add(`${description}|${category}`));
  };

  const dismissRecurring = (description: string, category: string) => {
    setDismissedRecurring((prev) => new Set(prev).add(`${description}|${category}`));
  };

  const editTarget = editTargetId
    ? expenses.find((e) => e.id === editTargetId) ?? null
    : null;

  return (
    <>
      <section className="page active" id="page-expenses">
        <div className="page-header">
          <div>
            <h1>Expenses</h1>
            <p className="page-subtitle">All your transactions</p>
          </div>
          {activeTab === 'expenses' && (
            <div className="header-actions">
              <select
                className="month-filter"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {monthOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-export"
                onClick={() => setLimitsOpen(true)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 20V10m-6 10V4m12 16v-4" />
                </svg>
                Limits
              </button>
              <button
                type="button"
                className="btn-export"
                onClick={() => setCategoriesOpen(true)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                </svg>
                Categories
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
                Add
              </button>
            </div>
          )}
        </div>

        {mode !== 'business' && (
          <div className="expense-subtabs">
            <button
              type="button"
              className={`tab-btn${activeTab === 'expenses' ? ' active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              Expenses
            </button>
            <button
              type="button"
              className={`tab-btn${activeTab === 'trips' ? ' active' : ''}`}
              onClick={() => setActiveTab('trips')}
            >
              Trips
            </button>
          </div>
        )}

        {activeTab === 'trips' && mode !== 'business' ? (
          <TripsTab />
        ) : (
        <div className="chart-card full-width">
          <div className="expense-toolbar">
            <div className="search-box">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search expenses..."
              />
            </div>
            <select
              className="category-filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {modeCategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn-export" onClick={handleExportCSV}>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3" />
              </svg>
              Export CSV
            </button>
            <button type="button" className="btn-export" onClick={handleExportPDF}>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Export PDF
            </button>
          </div>

          {overLimitCategories.length > 0 && (
            <div
              style={{
                margin: '12px 16px 0',
                padding: '12px 14px',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10,
                color: '#ef4444',
                fontSize: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                Over budget this month
              </div>
              {overLimitCategories.map((o) => (
                <div key={o.category}>
                  <strong>{o.category}</strong>: {formatCurrency(o.spent, currency)} spent of{' '}
                  {formatCurrency(o.limit, currency)} limit
                </div>
              ))}
            </div>
          )}

          {/* Recurring expense detection banners */}
          {recurringSuggestions.map((s) => (
            <div className="recurring-suggestion" key={`${s.description}|${s.category}`}>
              <span className="recurring-suggestion-icon">🔄</span>
              <div className="recurring-suggestion-text">
                <strong>{s.description}</strong> ({s.category}) has appeared in{' '}
                <strong>{s.months} months</strong>. Mark it as recurring?
              </div>
              <div className="recurring-suggestion-actions">
                <button
                  className="btn-primary"
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                  onClick={() => markAsRecurring(s.description, s.category)}
                >
                  Yes, monthly
                </button>
                <button
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    background: 'rgba(128,128,128,0.1)',
                    opacity: 0.6,
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                  onClick={() => dismissRecurring(s.description, s.category)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}

          <div className="table-wrap">
            {error && (
              <p className="auth-error" style={{ padding: 16 }}>
                {error}
              </p>
            )}
            {loading ? (
              <p style={{ padding: 24, opacity: 0.4 }}>Loading…</p>
            ) : filtered.length === 0 ? (
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
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3" />
                </svg>
                <p>No expenses for this period</p>
                <button
                  type="button"
                  className="empty-action-btn"
                  onClick={() => setModalOpen(true)}
                >
                  Add Expense
                </button>
              </div>
            ) : (
              <table className="expense-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Recurring</th>
                    <th>Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const color = CATEGORY_COLORS[e.category] ?? '#6b7280';
                    return (
                      <tr
                        key={e.id}
                        className="swipe-row"
                        onTouchStart={(ev) => {
                          const tr = ev.currentTarget;
                          tr.dataset.startX = String(ev.touches[0].clientX);
                        }}
                        onTouchMove={(ev) => {
                          const tr = ev.currentTarget;
                          const sx = parseFloat(tr.dataset.startX || '0');
                          const diff = Math.max(-80, Math.min(80, ev.touches[0].clientX - sx));
                          tr.style.transform = `translateX(${diff}px)`;
                          tr.style.transition = 'none';
                        }}
                        onTouchEnd={(ev) => {
                          const tr = ev.currentTarget;
                          const diff = (parseFloat(tr.style.transform.replace(/[^-\d.]/g, '')) || 0);
                          tr.style.transition = 'transform 0.3s ease';
                          tr.style.transform = 'translateX(0)';
                          if (diff < -50) handleDelete(e.id);
                          else if (diff > 50) setEditTargetId(e.id);
                        }}
                      >
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
                        <td>{e.recurring === 'no' ? '-' : e.recurring}</td>
                        <td>{formatCurrency(e.amount, currency)}</td>
                        <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => setEditTargetId(e.id)}
                            title="Edit expense"
                            aria-label={`Edit ${e.description}`}
                            style={{
                              background: 'rgba(139,92,246,0.1)',
                              border: '1px solid rgba(139,92,246,0.2)',
                              color: '#c4b5fd',
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
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            Edit
                          </button>
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
                            onClick={() => handleDelete(e.id)}
                            aria-label={`Delete ${e.description}`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
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
        )}
      </section>

      <ExpenseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={addExpense}
      />

      {editTarget && (
        <EditExpenseModal
          key={editTarget.id}
          expense={editTarget}
          modeCategories={modeCategories}
          onClose={() => setEditTargetId(null)}
          onSave={async (patch) => {
            const res = await updateExpense(editTarget.id, patch);
            if (!res.error) setEditTargetId(null);
            return res;
          }}
        />
      )}

      {limitsOpen && (
        <BudgetLimitsModal
          modeCategories={modeCategories}
          currency={currency}
          currencySymbol={currencySymbol}
          initial={budgetLimits}
          onClose={() => setLimitsOpen(false)}
          onSave={async (next) => {
            const res = await saveBudgetLimits(next);
            if (!res.error) setLimitsOpen(false);
            return res;
          }}
        />
      )}

      {categoriesOpen && user && (
        <ManageCategoriesModal
          userId={user.id}
          mode={mode}
          modeCategories={modeCategories}
          onClose={() => setCategoriesOpen(false)}
        />
      )}

      {moveTargetId && (() => {
        const target = expenses.find((x) => x.id === moveTargetId);
        if (!target) return null;
        return (
          <div
            onClick={() => setMoveTargetId(null)}
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
                background: 'var(--card-bg, #16161e)',
                border: '1px solid rgba(128,128,128,0.15)',
                borderRadius: 16,
                padding: 24,
                minWidth: 320,
                maxWidth: 400,
              }}
            >
              <h3 style={{ marginTop: 0 }}>Move Expense</h3>
              <div
                style={{
                  background: 'rgba(128,128,128,0.06)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontWeight: 600 }}>{target.category}</div>
                <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>
                  {target.description} — {formatCurrency(target.amount, currency)}
                </div>
                <div style={{ opacity: 0.35, fontSize: '0.75rem', marginTop: 4 }}>
                  {target.date}
                </div>
              </div>
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>Move to:</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['personal', 'business', 'family'] as const)
                  .filter((m) => m !== mode)
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="btn-add"
                      onClick={() => handleMove(target.id, m)}
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
                  border: '1px solid rgba(128,128,128,0.3)',
                  opacity: 0.9,
                  padding: '8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {undoData && (
        <UndoToast
          message="Expense deleted"
          onUndo={handleUndo}
          onDismiss={() => setUndoData(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline modal components — kept in this file per project constraints.
// ---------------------------------------------------------------------------

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle: CSSProperties = {
  background: 'var(--card-bg, #16161e)',
  border: '1px solid rgba(128,128,128,0.15)',
  borderRadius: 16,
  padding: 24,
  minWidth: 320,
  maxWidth: 520,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
};

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  opacity: 0.6,
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const fieldInput: CSSProperties = {
  width: '100%',
  background: 'rgba(128,128,128,0.06)',
  border: '1px solid rgba(128,128,128,0.15)',
  color: 'inherit',
  borderRadius: 8,
  padding: '10px 12px',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

interface EditExpenseModalProps {
  expense: Expense;
  modeCategories: ReturnType<typeof getCategoriesForMode>;
  onClose: () => void;
  onSave: (patch: {
    category: string;
    description: string;
    amount: number;
    date: string;
    recurring: 'no' | 'weekly' | 'monthly';
  }) => Promise<{ error: string | null }>;
}

function EditExpenseModal({
  expense,
  modeCategories,
  onClose,
  onSave,
}: EditExpenseModalProps) {
  const [category, setCategory] = useState(expense.category);
  const [description, setDescription] = useState(expense.description);
  const [amount, setAmount] = useState(String(expense.amount));
  const [date, setDate] = useState(expense.date);
  const [recurring, setRecurring] = useState<'no' | 'weekly' | 'monthly'>(
    expense.recurring,
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!category || !description || Number.isNaN(parsedAmount) || !date) {
      setErr('Please fill in every field.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    const res = await onSave({
      category,
      description,
      amount: parsedAmount,
      date,
      recurring,
    });
    setSubmitting(false);
    if (res.error) setErr(res.error);
  };

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panelStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0 }}>Edit Expense</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              opacity: 0.6,
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={fieldLabel}>Category</label>
            <select
              value={category}
              onChange={(ev) => setCategory(ev.target.value)}
              style={fieldInput}
              required
            >
              <option value="">Select...</option>
              {modeCategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Description</label>
            <input
              type="text"
              value={description}
              onChange={(ev) => setDescription(ev.target.value)}
              style={fieldInput}
              required
            />
          </div>
          <div>
            <label style={fieldLabel}>Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              style={fieldInput}
              min="0"
              step="0.01"
              required
            />
          </div>
          <div>
            <label style={fieldLabel}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(ev) => setDate(ev.target.value)}
              style={fieldInput}
              required
            />
          </div>
          <div>
            <label style={fieldLabel}>Recurring</label>
            <select
              value={recurring}
              onChange={(ev) =>
                setRecurring(ev.target.value as 'no' | 'weekly' | 'monthly')
              }
              style={fieldInput}
            >
              <option value="no">No - One time</option>
              <option value="monthly">Yes - Monthly</option>
              <option value="weekly">Yes - Weekly</option>
            </select>
          </div>
          {err && (
            <p className="auth-error" style={{ margin: 0 }}>
              {err}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
            style={{ marginTop: 8 }}
          >
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

interface BudgetLimitsModalProps {
  modeCategories: ReturnType<typeof getCategoriesForMode>;
  currency: string;
  currencySymbol: string;
  initial: BudgetLimits;
  onClose: () => void;
  onSave: (next: BudgetLimits) => Promise<{ error: string | null }>;
}

function BudgetLimitsModal({
  modeCategories,
  currency,
  currencySymbol,
  initial,
  onClose,
  onSave,
}: BudgetLimitsModalProps) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of modeCategories) {
      const v = initial[c.value];
      out[c.value] = v ? String(v) : '';
    }
    return out;
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = useMemo(
    () =>
      Object.values(draft).reduce((sum, v) => {
        const n = parseFloat(v);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0),
    [draft],
  );

  const handleSave = async () => {
    setSubmitting(true);
    setErr(null);
    const next: BudgetLimits = {};
    for (const [cat, v] of Object.entries(draft)) {
      const n = parseFloat(v);
      if (Number.isFinite(n) && n > 0) next[cat] = n;
    }
    const res = await onSave(next);
    setSubmitting(false);
    if (res.error) setErr(res.error);
  };

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panelStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>Budget Limits</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              opacity: 0.6,
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ opacity: 0.55, fontSize: '0.8rem', marginTop: 0 }}>
          Set a monthly cap per category. Leave blank for no limit.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {modeCategories.map((c) => (
            <div
              key={c.value}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'rgba(128,128,128,0.06)',
                border: '1px solid rgba(128,128,128,0.1)',
                padding: '8px 12px',
                borderRadius: 8,
              }}
            >
              <div style={{ flex: 1, fontSize: '0.85rem' }}>{c.label}</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: 140,
                }}
              >
                <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>
                  {currencySymbol}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={draft[c.value] ?? ''}
                  onChange={(ev) =>
                    setDraft((d) => ({ ...d, [c.value]: ev.target.value }))
                  }
                  style={{ ...fieldInput, padding: '6px 8px', fontSize: '0.85rem' }}
                />
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: 10,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.9rem',
          }}
        >
          <span style={{ opacity: 0.7 }}>Total limits</span>
          <strong style={{ color: 'var(--accent)' }}>{formatCurrency(total, currency)}</strong>
        </div>
        {err && (
          <p className="auth-error" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid rgba(128,128,128,0.3)',
              opacity: 0.9,
              padding: '10px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={submitting}
            style={{ flex: 1 }}
          >
            {submitting ? 'Saving…' : 'Save Limits'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ManageCategoriesModalProps {
  userId: string;
  mode: Mode;
  modeCategories: ReturnType<typeof getCategoriesForMode>;
  onClose: () => void;
}

function ManageCategoriesModal({
  userId,
  mode,
  modeCategories,
  onClose,
}: ManageCategoriesModalProps) {
  const [rows, setRows] = useState<CustomCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from('custom_categories')
      .select('id, user_id, account_mode, name, color, icon')
      .eq('user_id', userId)
      .eq('account_mode', mode);
    if (qErr) setErr(qErr.message);
    else setRows((data as CustomCategoryRow[] | null) ?? []);
    setLoading(false);
  }, [userId, mode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setErr(null);
    const { error: insErr } = await supabase.from('custom_categories').insert({
      user_id: userId,
      account_mode: mode,
      name: name.trim(),
      color,
    });
    setAdding(false);
    if (insErr) {
      setErr(insErr.message);
      return;
    }
    setName('');
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this custom category?')) return;
    const snapshot = rows;
    setRows((list) => list.filter((r) => r.id !== id));
    const { error: delErr } = await supabase
      .from('custom_categories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (delErr) {
      setRows(snapshot);
      setErr(delErr.message);
    }
  };

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panelStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0 }}>Manage Categories</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              opacity: 0.6,
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 18 }}>
          <h4
            style={{
              margin: '0 0 8px',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              opacity: 0.5,
            }}
          >
            Built-in
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {modeCategories.map((c) => {
              const badgeColor = CATEGORY_COLORS[c.value] ?? '#6b7280';
              return (
                <span
                  key={c.value}
                  style={{
                    background: `${badgeColor}20`,
                    color: badgeColor,
                    border: `1px solid ${badgeColor}40`,
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: '0.75rem',
                  }}
                >
                  {c.label}
                </span>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <h4
            style={{
              margin: '0 0 8px',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              opacity: 0.5,
            }}
          >
            Custom
          </h4>
          {loading ? (
            <p style={{ opacity: 0.4, fontSize: '0.85rem' }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ opacity: 0.4, fontSize: '0.85rem' }}>
              No custom categories yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'rgba(128,128,128,0.06)',
                    border: '1px solid rgba(128,128,128,0.1)',
                    padding: '8px 12px',
                    borderRadius: 8,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: r.color ?? '#6b7280',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>{r.name}</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    aria-label={`Delete ${r.name}`}
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      color: '#fca5a5',
                      borderRadius: 6,
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleAdd}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            paddingTop: 12,
            borderTop: '1px solid rgba(128,128,128,0.1)',
          }}
        >
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder="e.g. Gym"
              style={fieldInput}
            />
          </div>
          <div>
            <label style={fieldLabel}>Color</label>
            <input
              type="color"
              value={color}
              onChange={(ev) => setColor(ev.target.value)}
              style={{
                width: 48,
                height: 40,
                background: 'transparent',
                border: '1px solid rgba(128,128,128,0.15)',
                borderRadius: 8,
                padding: 2,
                cursor: 'pointer',
              }}
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={adding || !name.trim()}
            style={{ height: 40 }}
          >
            {adding ? '…' : 'Add'}
          </button>
        </form>
        {err && (
          <p className="auth-error" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

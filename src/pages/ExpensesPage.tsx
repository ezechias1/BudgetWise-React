import { useMemo, useState } from 'react';
import { ExpenseModal } from '@/components/ExpenseModal';
import { useExpenses } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useMode } from '@/contexts/ModeContext';
import { CATEGORY_COLORS, getCategoriesForMode } from '@/lib/categories';
import { formatCurrency, getCurrencySymbol, monthKey } from '@/lib/format';
import { exportExpensesToCSV, exportExpensesToPDF } from '@/lib/exports';
import type { Mode } from '@/types';

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
  const { expenses, loading, error, addExpense, deleteExpense, moveExpense, refresh } = useExpenses();
  const { currency, income } = useUserSettings();
  const { mode } = useMode();

  const modeCategories = useMemo(() => getCategoriesForMode(mode), [mode]);
  const [month, setMonth] = useState<string>(() => monthKey());
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

  const currencySymbol = getCurrencySymbol(currency);

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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this expense?')) return;
    const { error: delErr } = await deleteExpense(id);
    if (delErr) alert(`Delete failed: ${delErr}`);
  };

  return (
    <>
      <section className="page active" id="page-expenses">
        <div className="page-header">
          <div>
            <h1>Expenses</h1>
            <p className="page-subtitle">All your transactions</p>
          </div>
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
              onClick={() => alert('Budget Limits — coming soon in this React port.')}
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
              onClick={() => alert('Manage Categories — coming soon in this React port.')}
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
        </div>

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

          <div className="table-wrap">
            {error && (
              <p className="auth-error" style={{ padding: 16 }}>
                {error}
              </p>
            )}
            {loading ? (
              <p style={{ padding: 24, color: 'rgba(255,255,255,0.4)' }}>Loading…</p>
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
                        <td>{e.recurring === 'no' ? '-' : e.recurring}</td>
                        <td>{formatCurrency(e.amount, currency)}</td>
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
      </section>

      <ExpenseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={addExpense}
      />

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
                <div style={{ fontWeight: 600 }}>{target.category}</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                  {target.description} — {formatCurrency(target.amount, currency)}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', marginTop: 4 }}>
                  {target.date}
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
        );
      })()}
    </>
  );
}

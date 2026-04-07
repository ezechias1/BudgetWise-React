import { useMemo, useState } from 'react';
import { ExpenseModal } from '@/components/ExpenseModal';
import { useExpenses } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { CATEGORIES, CATEGORY_COLORS, type Category } from '@/lib/categories';
import { formatCurrency, monthKey } from '@/lib/format';

/**
 * Ports the #page-expenses section from dashboard.html (lines 621-695)
 * and its logic from js/app.js `renderAllExpenses()` (line 2360) +
 * `attachDeleteHandlers()` (line 2388).
 *
 * Round 2 scope: list, month filter, category filter, search, add, delete.
 * Deferred: CSV/PDF export, budget limits, recurring automations, move-to-account.
 */

/** Build a list of month keys from earliest expense date to current month. */
function buildMonthOptions(dates: string[]): Array<{ key: string; label: string }> {
  const now = new Date();
  const current = monthKey(now);
  const set = new Set<string>([current]);
  for (const d of dates) set.add(d.slice(0, 7));

  const sorted = Array.from(set).sort((a, b) => b.localeCompare(a));
  return sorted.map((key) => {
    const [y, m] = key.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    return { key, label };
  });
}

export default function ExpensesPage() {
  const { expenses, loading, error, addExpense, deleteExpense } = useExpenses();
  const { currency } = useUserSettings();

  const [month, setMonth] = useState<string>(() => monthKey());
  const [category, setCategory] = useState<'' | Category>('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const monthOptions = useMemo(
    () => buildMonthOptions(expenses.map((e) => e.date)),
    [expenses],
  );

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
              onChange={(e) => setCategory(e.target.value as Category | '')}
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
                        <td>{e.recurring === 'no' ? '-' : e.recurring}</td>
                        <td>{formatCurrency(e.amount, currency)}</td>
                        <td>
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
    </>
  );
}

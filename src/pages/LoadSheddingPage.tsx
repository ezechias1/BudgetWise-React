import { useMemo, useState, type FormEvent } from 'react';
import { useExpenses } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency, getCurrencySymbol, monthKey, todayIso } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { isPendingTripReview } from '@/lib/trip-review';
import { TripExpenseReviewPrompt } from '@/components/TripExpenseReviewPrompt';
import type { Expense } from '@/types';

const LS_SUB_CATEGORIES = [
  'Generator Fuel',
  'UPS / Inverter',
  'Solar',
  'Candles & Gas',
  'Spoiled Food',
  'Data (Hotspot)',
  'Eating Out',
  'Equipment Damage',
  'Other LS',
] as const;

const LS_SUB_LABELS: Record<(typeof LS_SUB_CATEGORIES)[number], string> = {
  'Generator Fuel': 'Generator Fuel (Petrol/Diesel)',
  'UPS / Inverter': 'UPS / Inverter / Battery',
  Solar: 'Solar Equipment',
  'Candles & Gas': 'Candles, Gas & Paraffin',
  'Spoiled Food': 'Spoiled Food',
  'Data (Hotspot)': 'Mobile Data (WiFi down)',
  'Eating Out': "Eating Out (can't cook)",
  'Equipment Damage': 'Equipment Damage',
  'Other LS': 'Other',
};

/**
 * Ports #page-loadshedding from dashboard.html (lines 957-1000) + the
 * renderLoadSheddingPage() logic from js/app.js (line 8758).
 *
 * Load shedding "expenses" are regular rows in the `expenses` table with
 * category === 'Load Shedding'. The sub-category is stored as a prefix in
 * the description, split by " — " (see app.js lines 8761, 8788).
 *
 * The vanilla Add Cost modal had a custom sub-category dropdown; this port
 * reuses ExpenseModal with a defaultCategory of "Load Shedding" so behavior
 * stays consistent with the rest of the app. TODO(ezechias): If we want the
 * exact sub-category dropdown back, build a dedicated LoadSheddingModal.
 */
export default function LoadSheddingPage() {
  const { expenses, addExpense } = useExpenses();
  const { currency } = useUserSettings();
  const [addOpen, setAddOpen] = useState(false);
  const [subCat, setSubCat] = useState<string>(LS_SUB_CATEGORIES[0]);
  const [lsAmount, setLsAmount] = useState('');
  const [lsDescription, setLsDescription] = useState('');
  const [lsDate, setLsDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set when a just-added cost lands inside a trip's date range and still
  // needs a Business/Personal decision — mirrors ExpenseModal's popup.
  const [pendingReview, setPendingReview] = useState<Expense | null>(null);
  const [classifying, setClassifying] = useState(false);

  const openAdd = () => {
    setSubCat(LS_SUB_CATEGORIES[0]);
    setLsAmount('');
    setLsDescription('');
    setLsDate(todayIso());
    setFormError(null);
    setAddOpen(true);
  };

  const handleAddCost = async (ev: FormEvent) => {
    ev.preventDefault();
    const parsed = parseFloat(lsAmount);
    if (!subCat || Number.isNaN(parsed) || !lsDate) {
      setFormError('Please fill in every required field.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    // Vanilla format: "<subCat> — <note>" or just "<subCat>" (app.js line 8788)
    const descriptionForRow = lsDescription
      ? `${subCat} — ${lsDescription}`
      : subCat;
    const { error, expense } = await addExpense({
      category: 'Load Shedding',
      description: descriptionForRow,
      amount: parsed,
      date: lsDate,
      recurring: 'no',
    });
    setSubmitting(false);
    if (error) {
      setFormError(error);
      return;
    }
    setAddOpen(false);
    if (expense && isPendingTripReview(expense)) {
      setPendingReview(expense);
    }
  };

  const handleChooseReview = async (value: boolean) => {
    if (!pendingReview) return;
    setClassifying(true);
    await supabase
      .from('expenses')
      .update({ business_expense: value })
      .eq('id', pendingReview.id);
    setClassifying(false);
    setPendingReview(null);
  };

  const sym = getCurrencySymbol(currency);

  const {
    monthTotal,
    allTotal,
    avg,
    breakdown,
    recent,
  } = useMemo(() => {
    const lsExpenses = expenses.filter((e) => e.category === 'Load Shedding');

    const thisMonthKey = monthKey();
    const thisMonth = lsExpenses.filter((e) => e.date.startsWith(thisMonthKey));
    const monthTotal = thisMonth.reduce((s, e) => s + e.amount, 0);
    const allTotal = lsExpenses.reduce((s, e) => s + e.amount, 0);

    // Average per month (distinct months only)
    const months: Record<string, number> = {};
    for (const e of lsExpenses) {
      const key = e.date.substring(0, 7);
      months[key] = (months[key] || 0) + e.amount;
    }
    const monthKeys = Object.keys(months);
    const avg = monthKeys.length > 0 ? allTotal / monthKeys.length : 0;

    // Breakdown by sub-category (stored as description prefix)
    const bd: Record<string, number> = {};
    for (const e of lsExpenses) {
      const subCat = e.description ? e.description.split(' — ')[0] : 'Other';
      bd[subCat] = (bd[subCat] || 0) + e.amount;
    }
    const breakdown = Object.keys(bd)
      .sort((a, b) => bd[b] - bd[a])
      .map((cat) => ({
        cat,
        amount: bd[cat],
        pct: allTotal > 0 ? Math.round((bd[cat] / allTotal) * 100) : 0,
      }));

    // Recent entries (top 10 by date desc)
    const recent = [...lsExpenses]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    return { monthTotal, allTotal, avg, breakdown, recent };
  }, [expenses]);

  const fmtNum = (n: number) =>
    sym +
    Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <>
      <section className="page active" id="page-loadshedding">
        <div className="page-header">
          <div>
            <h1>Load Shedding Tracker</h1>
            <p className="page-subtitle">Track the real cost of power outages</p>
          </div>
          <button
            type="button"
            className="btn-primary btn-sm"
            id="addLSExpenseBtn"
            onClick={openAdd}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14m-7-7h14" />
            </svg>
            Add Cost
          </button>
        </div>

        {/* Load Shedding Summary Cards */}
        <div className="stats-grid" id="lsSummaryGrid">
          {/* .stat-card is display:flex — its children must live inside a
              .stat-info column, or label/value/sub lay out side-by-side and
              squeeze .stat-value (nowrap + ellipsis) down to just "R...". */}
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">This Month</div>
              <div className="stat-value" id="lsMonthTotal">{fmtNum(monthTotal)}</div>
              <div className="stat-sub">load shedding costs</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Total All Time</div>
              <div className="stat-value" id="lsAllTimeTotal">{fmtNum(allTotal)}</div>
              <div className="stat-sub">since tracking</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Avg Per Month</div>
              <div className="stat-value" id="lsAvgMonth">{fmtNum(avg)}</div>
              <div className="stat-sub">average cost</div>
            </div>
          </div>
        </div>

        {/* Load Shedding By Category */}
        <div className="chart-card full-width">
          <h3>Cost Breakdown</h3>
          <div id="lsBreakdown" className="expense-list">
            {breakdown.map((b) => (
              <div className="expense-row" key={b.cat}>
                <div className="expense-info">
                  <strong>{b.cat}</strong>
                  <span className="expense-date">{b.pct}% of total</span>
                </div>
                <div className="expense-amount">{fmtNum(b.amount)}</div>
              </div>
            ))}
          </div>
          {breakdown.length === 0 && (
            <p id="lsEmpty" className="empty-msg">
              No load shedding costs recorded yet. Tap "Add Cost" to start tracking.
            </p>
          )}
        </div>

        {/* Recent Load Shedding Expenses */}
        <div className="chart-card full-width">
          <h3>Recent Entries</h3>
          <div id="lsRecentList" className="expense-list">
            {recent.length === 0 ? (
              <p className="empty-msg">No entries yet</p>
            ) : (
              recent.map((e) => (
                <div className="expense-row" key={e.id}>
                  <div className="expense-info">
                    <strong>{e.description || 'Load Shedding'}</strong>
                    <span className="expense-date">{e.date}</span>
                  </div>
                  <div className="expense-amount">
                    -{formatCurrency(e.amount, currency)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {addOpen && (
        <div
          className="modal-overlay"
          id="lsModal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2>Add Load Shedding Cost</h2>
              <button
                type="button"
                className="modal-close"
                id="closeLSModal"
                onClick={() => setAddOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form id="lsForm" onSubmit={handleAddCost}>
              <div className="field">
                <label>Category</label>
                <select
                  id="lsCategory"
                  className="input"
                  required
                  value={subCat}
                  onChange={(e) => setSubCat(e.target.value)}
                >
                  {LS_SUB_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {LS_SUB_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  id="lsAmount"
                  className="input"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  value={lsAmount}
                  onChange={(e) => setLsAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Description (optional)</label>
                <input
                  type="text"
                  id="lsDescription"
                  className="input"
                  placeholder="e.g. 20L petrol for generator"
                  value={lsDescription}
                  onChange={(e) => setLsDescription(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  id="lsDate"
                  className="input"
                  required
                  value={lsDate}
                  onChange={(e) => setLsDate(e.target.value)}
                />
              </div>
              {formError && (
                <p className="auth-error" style={{ marginBottom: 12 }}>
                  {formError}
                </p>
              )}
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add Cost'}
              </button>
            </form>
          </div>
        </div>
      )}

      {pendingReview && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Sort this expense</h2>
            </div>
            <TripExpenseReviewPrompt
              expense={pendingReview}
              currency={currency}
              onChoose={handleChooseReview}
              submitting={classifying}
            />
          </div>
        </div>
      )}
    </>
  );
}

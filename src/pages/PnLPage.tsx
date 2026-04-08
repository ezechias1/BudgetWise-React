import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useExpenses } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency, monthKey } from '@/lib/format';
import { CATEGORY_COLORS } from '@/lib/categories';
import { chartColors, chartTooltip } from '@/lib/chartTheme';
import '@/lib/chartRegistry';

interface InvoiceLite {
  id: string;
  amount: number;
  status: string;
  invoice_date: string;
}

export default function PnLPage() {
  const { user } = useAuth();
  const { expenses } = useExpenses();
  const { currency, income } = useUserSettings();

  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [filterVal, setFilterVal] = useState<string>(monthKey());

  const loadInvoices = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('invoices')
      .select('id, amount, status, invoice_date')
      .eq('user_id', user.id)
      .eq('account_mode', 'business');
    setInvoices((data ?? []) as InvoiceLite[]);
  }, [user]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const fmt = (n: number) => formatCurrency(n, currency);

  const months = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
      });
    }
    return out;
  }, []);

  const data = useMemo(() => {
    const mKey = filterVal;
    const revenue = income || 0;
    const invRevenue = invoices
      .filter((inv) => inv.status === 'paid' && inv.invoice_date && inv.invoice_date.startsWith(mKey))
      .reduce((s, inv) => s + inv.amount, 0);
    const monthExpenses = expenses.filter((e) => e.date && e.date.startsWith(mKey));
    const totalExp = monthExpenses.reduce((s, e) => s + e.amount, 0);
    const totalRevenue = revenue + invRevenue;
    const profit = totalRevenue - totalExp;
    const margin = totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(1) : '0.0';

    const catTotals: Record<string, number> = {};
    monthExpenses.forEach((e) => {
      catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
    });
    const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    // 6-month trend
    const trendLabels: string[] = [];
    const trendRevenue: number[] = [];
    const trendExpenses: number[] = [];
    const trendProfit: number[] = [];
    const now2 = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trendLabels.push(d.toLocaleString('default', { month: 'short' }));
      const mExp = expenses
        .filter((e) => e.date && e.date.startsWith(key))
        .reduce((s, e) => s + e.amount, 0);
      const mInvRev = invoices
        .filter((inv) => inv.status === 'paid' && inv.invoice_date && inv.invoice_date.startsWith(key))
        .reduce((s, inv) => s + inv.amount, 0);
      const mRev = revenue + mInvRev;
      trendRevenue.push(mRev);
      trendExpenses.push(mExp);
      trendProfit.push(mRev - mExp);
    }

    return {
      totalRevenue,
      totalExp,
      profit,
      margin,
      sortedCats,
      catTotals,
      trendLabels,
      trendRevenue,
      trendExpenses,
      trendProfit,
    };
  }, [expenses, invoices, income, filterVal]);

  const cc = chartColors();

  const barData = {
    labels: ['Revenue', 'Expenses', 'Profit'],
    datasets: [
      {
        data: [data.totalRevenue, data.totalExp, Math.max(0, data.profit)],
        backgroundColor: ['rgba(16,185,129,0.7)', 'rgba(239,68,68,0.7)', 'rgba(59,130,246,0.7)'],
        borderRadius: 8,
      },
    ],
  };

  const pieLabels = Object.keys(data.catTotals);
  const pieValues = Object.values(data.catTotals);
  const pieColors = pieLabels.map(
    (l) => (CATEGORY_COLORS as Record<string, string>)[l] || '#6b7280',
  );
  const pieData = {
    labels: pieLabels,
    datasets: [{ data: pieValues, backgroundColor: pieColors, borderWidth: 0 }],
  };

  const trendData = {
    labels: data.trendLabels,
    datasets: [
      {
        label: 'Revenue',
        data: data.trendRevenue,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Expenses',
        data: data.trendExpenses,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Profit',
        data: data.trendProfit,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  return (
    <section className="page active" id="page-pnl">
      <div className="page-header">
        <div>
          <h1>Profit &amp; Loss</h1>
          <p className="page-subtitle">Revenue vs expenses breakdown</p>
        </div>
        <select
          className="month-filter"
          id="pnlMonthFilter"
          value={filterVal}
          onChange={(e) => setFilterVal(e.target.value)}
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon stat-green">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Revenue</span>
            <span className="stat-value" id="pnlRevenue">
              {fmt(data.totalRevenue)}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-red">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Expenses</span>
            <span className="stat-value" id="pnlExpenses">
              {fmt(data.totalExp)}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-blue">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Net Profit</span>
            <span
              className="stat-value"
              id="pnlProfit"
              style={{ color: data.profit >= 0 ? '#10b981' : '#ef4444' }}
            >
              {fmt(data.profit)}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-purple">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l2 2" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Profit Margin</span>
            <span className="stat-value" id="pnlMargin">
              {data.margin}%
            </span>
          </div>
        </div>
      </div>
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Revenue vs Expenses</h3>
          <div className="chart-container">
            <Bar
              data={barData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: chartTooltip() },
                scales: {
                  y: { ticks: { color: cc.tick }, grid: { color: cc.grid } },
                  x: { ticks: { color: cc.tick }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
        <div className="chart-card">
          <h3>Expense Breakdown</h3>
          <div className="chart-container">
            <Doughnut
              data={pieData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: {
                      color: cc.legendText,
                      padding: 12,
                      usePointStyle: true,
                      pointStyle: 'circle',
                    },
                  },
                  tooltip: chartTooltip(),
                },
              }}
            />
          </div>
        </div>
      </div>
      <div className="chart-card full-width">
        <h3>Profit Trend (6 Months)</h3>
        <div className="chart-container chart-wide">
          <Line
            data={trendData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  labels: { color: cc.legendText, usePointStyle: true, pointStyle: 'circle' },
                },
                tooltip: chartTooltip(),
              },
              scales: {
                y: { ticks: { color: cc.tick }, grid: { color: cc.grid } },
                x: { ticks: { color: cc.tick }, grid: { display: false } },
              },
            }}
          />
        </div>
      </div>
      <div className="chart-card full-width">
        <h3>Expense Details</h3>
        <div className="pnl-breakdown" id="pnlBreakdown">
          {data.sortedCats.map(([cat, val]) => {
            const pct = data.totalExp > 0 ? ((val / data.totalExp) * 100).toFixed(1) : '0';
            const color = (CATEGORY_COLORS as Record<string, string>)[cat] || '#6b7280';
            return (
              <div key={cat} className="pnl-row">
                <div className="pnl-row-left">
                  <div className="pnl-dot" style={{ background: color }}></div>
                  <span>{cat}</span>
                </div>
                <div className="pnl-row-right">
                  <div className="pnl-bar-track">
                    <div className="pnl-bar-fill" style={{ width: `${pct}%`, background: color }}></div>
                  </div>
                  <span className="pnl-amount">{fmt(val)}</span>
                  <span className="pnl-pct">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

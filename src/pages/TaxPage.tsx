import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useExpenses } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';
import { CATEGORY_COLORS } from '@/lib/categories';

interface InvoiceLite {
  id: string;
  amount: number;
  status: string;
  invoice_date: string;
}

const TAX_RATE = 0.25;

export default function TaxPage() {
  const { user } = useAuth();
  const { expenses } = useExpenses();
  const { currency, income } = useUserSettings();

  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);

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

  const calc = useMemo(() => {
    const invRevenue = invoices
      .filter((inv) => inv.status === 'paid')
      .reduce((s, inv) => s + inv.amount, 0);
    const annualRevenue = (income || 0) * 12 + invRevenue;
    const annualExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const taxableIncome = Math.max(0, annualRevenue - annualExpenses);
    const estimatedTax = taxableIncome * TAX_RATE;

    const year = new Date().getFullYear();
    const quarters = [
      { label: 'Q1 (Jan-Mar)', months: ['01', '02', '03'] },
      { label: 'Q2 (Apr-Jun)', months: ['04', '05', '06'] },
      { label: 'Q3 (Jul-Sep)', months: ['07', '08', '09'] },
      { label: 'Q4 (Oct-Dec)', months: ['10', '11', '12'] },
    ];
    const qRows = quarters.map((q) => {
      let qRev = (income || 0) * 3;
      let qInvRev = 0;
      let qExp = 0;
      q.months.forEach((m) => {
        const key = `${year}-${m}`;
        qInvRev += invoices
          .filter(
            (inv) =>
              inv.status === 'paid' && inv.invoice_date && inv.invoice_date.startsWith(key),
          )
          .reduce((s, inv) => s + inv.amount, 0);
        qExp += expenses
          .filter((e) => e.date && e.date.startsWith(key))
          .reduce((s, e) => s + e.amount, 0);
      });
      qRev += qInvRev;
      const qTaxable = Math.max(0, qRev - qExp);
      const qTax = qTaxable * TAX_RATE;
      return { label: q.label, qRev, qExp, qTaxable, qTax };
    });

    const catTotals: Record<string, number> = {};
    expenses.forEach((e) => {
      catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
    });
    const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    return { annualRevenue, annualExpenses, taxableIncome, estimatedTax, qRows, sortedCats };
  }, [expenses, invoices, income]);

  return (
    <section className="page active" id="page-tax">
      <div className="page-header">
        <div>
          <h1>Tax Summary</h1>
          <p className="page-subtitle">Estimated tax obligations</p>
        </div>
      </div>
      <div className="chart-card full-width" style={{ borderLeft: '3px solid #f59e0b' }}>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', lineHeight: 1.6 }}>
          These are estimates only. Consult a tax professional for accurate filing. Tax rates
          shown are approximate and may vary based on your jurisdiction.
        </p>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon stat-green">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Annual Revenue</span>
            <span className="stat-value" id="taxRevenue">
              {fmt(calc.annualRevenue)}
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
            <span className="stat-label">Annual Expenses</span>
            <span className="stat-value" id="taxExpenses">
              {fmt(calc.annualExpenses)}
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
            <span className="stat-label">Taxable Income</span>
            <span className="stat-value" id="taxableIncome">
              {fmt(calc.taxableIncome)}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-purple">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <path d="M8 7v4m8-4v4M6 15h4m4 0h4" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Estimated Tax</span>
            <span className="stat-value" id="taxEstimate">
              {fmt(calc.estimatedTax)}
            </span>
          </div>
        </div>
      </div>
      <div className="chart-card full-width">
        <h3>Quarterly Breakdown</h3>
        <div className="table-wrap">
          <table className="expense-table" id="taxTable">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Revenue</th>
                <th>Expenses</th>
                <th>Taxable</th>
                <th>Est. Tax</th>
              </tr>
            </thead>
            <tbody id="taxBody">
              {calc.qRows.map((q) => (
                <tr key={q.label}>
                  <td>{q.label}</td>
                  <td>{fmt(q.qRev)}</td>
                  <td>{fmt(q.qExp)}</td>
                  <td>{fmt(q.qTaxable)}</td>
                  <td>{fmt(q.qTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="chart-card full-width">
        <h3>Deductible Expenses</h3>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', marginBottom: 16 }}>
          Business expenses that can reduce your taxable income.
        </p>
        <div className="pnl-breakdown" id="taxDeductibles">
          {calc.sortedCats.map(([cat, val]) => {
            const pct =
              calc.annualExpenses > 0 ? ((val / calc.annualExpenses) * 100).toFixed(1) : '0';
            const color = (CATEGORY_COLORS as Record<string, string>)[cat] || '#6b7280';
            return (
              <div key={cat} className="pnl-row">
                <div className="pnl-row-left">
                  <div className="pnl-dot" style={{ background: color }}></div>
                  <span>{cat}</span>
                </div>
                <div className="pnl-row-right">
                  <div className="pnl-bar-track">
                    <div
                      className="pnl-bar-fill"
                      style={{ width: `${pct}%`, background: color }}
                    ></div>
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

// Ports js/app.js `exportToCSV` (line 3351) and `exportToPDF` (line 3366).
// PDF export builds a print-ready HTML document and opens it via a Blob URL
// (rather than document.write) so the print dialog is invoked automatically.

import type { Expense } from '@/types';

function csvSafe(value: string | number): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function exportExpensesToCSV(expenses: Expense[]): void {
  if (expenses.length === 0) {
    alert('No expenses to export.');
    return;
  }
  let csv = 'Date,Category,Description,Amount,Recurring\n';
  for (const e of expenses) {
    csv +=
      csvSafe(e.date) +
      ',' +
      csvSafe(e.category) +
      ',' +
      csvSafe(e.description) +
      ',' +
      e.amount +
      ',' +
      csvSafe(e.recurring ?? '') +
      '\n';
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budgetwise-expenses-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface PDFContext {
  expenses: Expense[];
  income: number;
  currencySymbol: string;
}

export function exportExpensesToPDF({ expenses, income, currencySymbol }: PDFContext): void {
  if (expenses.length === 0) {
    alert('No expenses to export.');
    return;
  }
  const sym = currencySymbol;
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const catTotals: Record<string, number> = {};
  for (const e of expenses) {
    catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount;
  }
  const dates = expenses.map((e) => e.date).sort();
  const dateRange = `${dates[0]} to ${dates[dates.length - 1]}`;

  const catRows = Object.keys(catTotals)
    .sort((a, b) => catTotals[b] - catTotals[a])
    .map((cat) => {
      const pct = ((catTotals[cat] / totalSpent) * 100).toFixed(1);
      return `<tr><td>${escapeHtml(cat)}</td><td style="text-align:right;">${sym}${catTotals[cat].toFixed(2)}</td><td style="text-align:right;">${pct}%</td></tr>`;
    })
    .join('');

  const expRows = [...expenses]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(
      (e) =>
        `<tr><td>${e.date}</td><td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.description)}</td><td style="text-align:right;">${sym}${Number(e.amount).toFixed(2)}</td></tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html><html><head><title>BudgetWise Expense Report</title><style>
body{font-family:Inter,Arial,sans-serif;color:#111;margin:40px;line-height:1.5;}
h1{font-size:22px;margin-bottom:4px;}
h2{font-size:16px;margin-top:28px;margin-bottom:8px;border-bottom:2px solid #10b981;padding-bottom:4px;}
.subtitle{color:#666;font-size:13px;margin-bottom:20px;}
.summary{display:flex;gap:30px;margin-bottom:20px;}
.summary-item{background:#f0fdf4;padding:12px 18px;border-radius:8px;}
.summary-item .label{font-size:11px;color:#666;text-transform:uppercase;}
.summary-item .value{font-size:20px;font-weight:700;color:#111;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-weight:600;}
td{padding:7px 10px;border-bottom:1px solid #e2e8f0;}
tr:nth-child(even){background:#fafafa;}
@media print{body{margin:20px;}}
</style><script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});</script></head><body>
<h1>BudgetWise Expense Report</h1>
<p class="subtitle">Period: ${dateRange} &bull; Generated: ${new Date().toLocaleDateString()}</p>
<div class="summary">
<div class="summary-item"><div class="label">Total Spent</div><div class="value">${sym}${totalSpent.toFixed(2)}</div></div>
<div class="summary-item"><div class="label">Transactions</div><div class="value">${expenses.length}</div></div>
<div class="summary-item"><div class="label">Income</div><div class="value">${sym}${Number(income).toFixed(2)}</div></div>
</div>
<h2>Category Breakdown</h2>
<table><thead><tr><th>Category</th><th style="text-align:right;">Amount</th><th style="text-align:right;">%</th></tr></thead><tbody>${catRows}</tbody></table>
<h2>All Expenses</h2>
<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${expRows}</tbody></table>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    alert('Please allow popups to export PDF');
    URL.revokeObjectURL(url);
    return;
  }
  // Revoke after a delay so the window has time to load
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

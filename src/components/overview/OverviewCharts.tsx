import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { CATEGORY_COLORS, type Category } from '@/lib/categories';
import { chartColors, chartTooltip, isLight } from '@/lib/chartTheme';
import { useTheme } from '@/contexts/ThemeContext';
import { useMode } from '@/contexts/ModeContext';
import '@/lib/chartRegistry';

interface PieProps {
  categoryTotals: Record<string, number>;
}

/** Spending-by-category doughnut — matches the pieChart config in app.js line 2300. */
export function SpendingPieChart({ categoryTotals }: PieProps) {
  // Subscribe to theme/mode so the chart re-renders on toggle
  useTheme();
  const labels = Object.keys(categoryTotals);
  const data = Object.values(categoryTotals);

  if (labels.length === 0) {
    return (
      <div className="chart-empty">
        <svg
          viewBox="0 0 24 24"
          width="32"
          height="32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a10 10 0 0110 10" />
        </svg>
        <p>No expenses this month</p>
      </div>
    );
  }

  const cc = chartColors();
  const light = isLight();

  return (
    <Doughnut
      data={{
        labels,
        datasets: [
          {
            data,
            backgroundColor: labels.map(
              (l) => CATEGORY_COLORS[l as Category] ?? '#6b7280',
            ),
            borderWidth: light ? 2 : 0,
            borderColor: light ? '#fff' : 'transparent',
            hoverOffset: 8,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: cc.legendText,
              font: { size: 11, family: 'Inter', weight: light ? 500 : 400 },
              padding: 14,
              usePointStyle: true,
            },
          },
          tooltip: chartTooltip(),
        },
      }}
    />
  );
}

interface BarProps {
  income: number;
  totalSpent: number;
  savingsGoal: number;
  saved: number;
}

/** Income-vs-Expenses bar — matches barChart config in app.js line 2317. */
export function IncomeVsExpensesChart({ income, totalSpent, savingsGoal, saved }: BarProps) {
  useTheme();
  const { mode } = useMode();
  const cc = chartColors();
  const light = isLight();

  const labels =
    mode === 'business'
      ? ['Revenue', 'Expenses', 'Budget Target', 'Surplus']
      : ['Income', 'Expenses', 'Savings Goal', 'Actual Saved'];

  return (
    <Bar
      data={{
        labels,
        datasets: [
          {
            data: [income, totalSpent, savingsGoal, saved],
            backgroundColor: light
              ? ['rgba(16,185,129,0.8)', 'rgba(239,68,68,0.8)', 'rgba(139,92,246,0.8)', 'rgba(6,182,212,0.8)']
              : ['#10b981', '#ef4444', '#8b5cf6', '#06b6d4'],
            borderWidth: 0,
            borderRadius: 8,
            barThickness: 40,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: chartTooltip(),
        },
        scales: {
          y: { grid: { color: cc.grid }, ticks: { color: cc.tick } },
          x: {
            grid: { display: false },
            ticks: { color: cc.text, font: { size: 11, weight: light ? 500 : 400 } },
          },
        },
      }}
    />
  );
}

interface TrendProps {
  trend: Array<{ key: string; label: string; total: number }>;
}

/** 6-month spending trend line. */
export function SpendingTrendChart({ trend }: TrendProps) {
  useTheme();
  const cc = chartColors();

  return (
    <Line
      data={{
        labels: trend.map((t) => t.label),
        datasets: [
          {
            data: trend.map((t) => t.total),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#10b981',
            borderWidth: 2,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: chartTooltip(),
        },
        scales: {
          y: { grid: { color: cc.grid }, ticks: { color: cc.tick } },
          x: { grid: { display: false }, ticks: { color: cc.text } },
        },
      }}
    />
  );
}

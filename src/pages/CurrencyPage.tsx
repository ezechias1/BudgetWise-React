import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { CURRENCIES } from '@/lib/currencies';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useTheme } from '@/contexts/ThemeContext';
import { chartColors, chartTooltip, isLight } from '@/lib/chartTheme';
import '@/lib/chartRegistry';

const COMPARE_COLORS_DARK = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#6366f1',
  '#14b8a6',
  '#e879f9',
];
const COMPARE_COLORS_LIGHT = COMPARE_COLORS_DARK.map((c) => `${c}bf`);

/** Ports #page-currency (dashboard.html lines 864-902) + loadCurrencyPage logic. */
export default function CurrencyPage() {
  const { currency: userCurrency } = useUserSettings();
  useTheme(); // re-render on theme change

  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState(userCurrency);
  const [to, setTo] = useState(userCurrency === 'USD' ? 'EUR' : 'USD');
  const [seeded, setSeeded] = useState(false);

  // Seed `from` once user currency loads (only if the user hasn't already
  // picked something else manually).
  useEffect(() => {
    if (seeded) return;
    setFrom(userCurrency);
    setTo(userCurrency === 'USD' ? 'EUR' : 'USD');
    setSeeded(true);
  }, [userCurrency, seeded]);

  const { rates, loading, error } = useExchangeRates(from);

  const parsedAmount = parseFloat(amount) || 0;
  const rate = rates[to] ?? (from === to ? 1 : 0);
  const converted = parsedAmount * rate;

  const cc = chartColors();
  const light = isLight();

  // "1 USD = X in other currencies"
  const compareCurrencies = useMemo(
    () =>
      ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'INR', 'BRL', 'JPY', 'AUD', 'CNY'].filter(
        (c) => c !== from,
      ),
    [from],
  );

  const chartData = useMemo(
    () => ({
      labels: compareCurrencies,
      datasets: [
        {
          label: `1 ${from} =`,
          data: compareCurrencies.map((c) => rates[c] ?? 0),
          backgroundColor: light ? COMPARE_COLORS_LIGHT : COMPARE_COLORS_DARK,
          borderWidth: 0,
          borderRadius: 6,
          barThickness: 36,
        },
      ],
    }),
    [compareCurrencies, rates, from, light],
  );

  return (
    <section className="page active" id="page-currency">
      <div className="page-header">
        <div>
          <h1>Currency Converter</h1>
          <p className="page-subtitle">Compare exchange rates in real time</p>
        </div>
      </div>

      <div className="chart-card full-width">
        <div className="converter-grid">
          <div className="converter-side">
            <label>Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
          <div className="converter-side">
            <label>From</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          <div className="converter-arrow">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14m-7-7l7 7-7 7" />
            </svg>
          </div>
          <div className="converter-side">
            <label>To</label>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          <div className="converter-side">
            <label>Result</label>
            <div className="convert-result">
              {loading
                ? 'Loading…'
                : error
                  ? 'Rates unavailable'
                  : `${converted.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })} ${to}`}
            </div>
          </div>
        </div>
        {!loading && !error && parsedAmount > 0 && (
          <p className="rate-info">
            1 {from} = {rate.toFixed(4)} {to} (updated live)
          </p>
        )}
      </div>

      <div className="chart-card full-width">
        <h3>Your Currency vs Others</h3>
        <p className="chart-subtitle">
          How much 1 {from} is worth in other currencies
        </p>
        <div className="chart-container chart-wide">
          <Bar
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: 'y',
              plugins: {
                legend: { display: false },
                tooltip: chartTooltip(),
              },
              scales: {
                x: { grid: { color: cc.grid }, ticks: { color: cc.tick } },
                y: {
                  grid: { display: false },
                  ticks: { color: cc.textStrong, font: { weight: 600, size: 12 } },
                },
              },
            }}
          />
        </div>
      </div>
    </section>
  );
}

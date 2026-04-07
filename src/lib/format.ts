// Currency + date helpers ported from js/app.js so formatting stays
// identical between the vanilla app and the React port.

const CURRENCY_SYMBOLS: Record<string, string> = {
  ZAR: 'R',
  USD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  KES: 'KSh',
  GHS: 'GH₵',
  INR: '₹',
  BRL: 'R$',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CNY: '¥',
  BWP: 'P',
  MZN: 'MT',
};

/** Matches `fmt()` in js/app.js line 2191. */
export function formatCurrency(amount: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return (
    sym +
    Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** ISO date for an `<input type="date">` default value. */
export function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

/** Month key used by the vanilla app for filtering, e.g. "2026-04". */
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

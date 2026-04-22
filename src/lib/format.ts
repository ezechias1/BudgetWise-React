// Currency + date helpers ported from js/app.js so formatting stays
// identical between the vanilla app and the React port.

import { CURRENCY_INFO } from './currencies';

/** Matches `getCurrencySymbol()` in js/app.js. */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_INFO[currency]?.symbol ?? `${currency} `;
}

/** Matches `fmt()` in js/app.js line 2191. */
export function formatCurrency(amount: number, currency: string): string {
  return (
    getCurrencySymbol(currency) +
    Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** ISO date for an `<input type="date">` default value.
 *  AUDIT Imp #12: compute from local year/month/day. `toISOString()` uses
 *  UTC, which rolls over to "tomorrow" after 22:00 SA time and silently
 *  mis-dates any expense added late in the evening.
 */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Month key used by the vanilla app for filtering, e.g. "2026-04". */
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

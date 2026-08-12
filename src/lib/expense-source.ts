import type { ExpenseSource } from '@/types';

/**
 * Human labels for how an expense got into the app.
 *
 * Users won't trust auto-created rows unless they can see where each came
 * from — and it's the first thing you need yourself when a parser or import
 * goes wrong.
 */
export const SOURCE_LABELS: Record<ExpenseSource, string> = {
  manual: 'Added by you',
  csv: 'Statement import',
  mono: 'Bank sync',
  alert: 'Bank alert',
  stokvel: 'Stokvel contribution',
};

/** Short form for the per-row badge in the expenses table. */
export const SOURCE_BADGES: Record<ExpenseSource, string> = {
  manual: 'Manual',
  csv: 'CSV',
  mono: 'Bank',
  alert: 'Alert',
  stokvel: 'Stokvel',
};

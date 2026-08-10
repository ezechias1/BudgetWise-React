import type { Expense } from '@/types';

/**
 * Single source of truth for "this expense needs a Business/Personal
 * decision" — used by the post-save popup, the app-open review gate, and
 * (conceptually) the exclusion filter in useExpenses.ts, so every consumer
 * agrees on the exact same condition.
 */
export function isPendingTripReview(
  e: Pick<Expense, 'trip_id' | 'business_expense'>,
): boolean {
  return e.trip_id !== null && e.business_expense === null;
}

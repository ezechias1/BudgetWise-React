import { useMemo } from 'react';
import { useExpenses } from './useExpenses';
import { useUserSettings } from './useUserSettings';
import { monthKey } from '@/lib/format';
import type { Expense } from '@/types';

interface OverviewStats {
  loading: boolean;
  income: number;
  totalSpent: number;
  balance: number;
  saved: number;
  savingsGoal: number;
  savingsPct: number;
  currency: string;
  monthExpenses: Expense[];
  categoryTotals: Record<string, number>;
  /** Deduped + sliced to 8 for the Recent Expenses table. */
  recent: Expense[];
  /** Keys are "YYYY-MM" strings, values are totals (last 6 months). */
  trend: Array<{ key: string; label: string; total: number }>;
}

/** Dedupe consecutive identical entries — ports dedupeRecent() from app.js. */
function dedupeRecent(list: Expense[]): Expense[] {
  const seen = new Set<string>();
  const out: Expense[] = [];
  for (const e of list) {
    const key = `${e.category}|${e.description}|${e.amount}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

/**
 * Derives every number the Overview page needs from the raw expense list.
 * Keeps the page component pure rendering and keeps computations in one
 * place so savings/balance/spent can be reused by other pages.
 */
export function useOverviewStats(): OverviewStats {
  const { expenses, loading: expensesLoading } = useExpenses();
  const { currency, income, savingsGoal, loading: settingsLoading } = useUserSettings();

  return useMemo(() => {
    const currentKey = monthKey();
    const monthExpenses = expenses.filter((e) => e.date.startsWith(currentKey));
    const totalSpent = monthExpenses.reduce((s, e) => s + e.amount, 0);
    const saved = monthExpenses
      .filter((e) => e.category === 'Savings')
      .reduce((s, e) => s + e.amount, 0);
    const balance = income - totalSpent;
    const savingsPct = savingsGoal > 0 ? Math.min(100, (saved / savingsGoal) * 100) : 0;

    const categoryTotals: Record<string, number> = {};
    for (const e of monthExpenses) {
      categoryTotals[e.category] = (categoryTotals[e.category] ?? 0) + e.amount;
    }

    const recent = dedupeRecent(monthExpenses).slice(0, 8);

    // Last 6 months trend
    const trend: Array<{ key: string; label: string; total: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      const label = d.toLocaleString(undefined, { month: 'short' });
      const total = expenses
        .filter((e) => e.date.startsWith(key))
        .reduce((s, e) => s + e.amount, 0);
      trend.push({ key, label, total });
    }

    return {
      loading: expensesLoading || settingsLoading,
      income,
      totalSpent,
      balance,
      saved,
      savingsGoal,
      savingsPct,
      currency,
      monthExpenses,
      categoryTotals,
      recent,
      trend,
    };
  }, [expenses, income, savingsGoal, currency, expensesLoading, settingsLoading]);
}

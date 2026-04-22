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
  /**
   * Last 6 months — each entry has total spent that month and saved
   * (income − spent, floored at 0). Income is constant across months
   * (the current setting), matching vanilla js/app.js:3658.
   */
  trend: Array<{ key: string; label: string; total: number; saved: number }>;
  /**
   * Month-over-month comparison text — null when previous or current
   * month has zero data. Mirrors vanilla js/app.js:4048-4056.
   */
  monthCompareText: string | null;
}

/**
 * Recent expenses — no dedup by category|description|amount (AUDIT Imp #26:
 * two genuine same-day same-shop purchases would collapse to one, making
 * users think the second didn't save). Each row is already unique by id;
 * we just keep insertion order.
 */
function dedupeRecent(list: Expense[]): Expense[] {
  return list;
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

    // Last 6 months trend — Spent + Saved per month, Income is constant.
    const trend: Array<{ key: string; label: string; total: number; saved: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      const label = d.toLocaleString(undefined, { month: 'short' });
      const monthTotal = expenses
        .filter((e) => e.date.startsWith(key))
        .reduce((s, e) => s + e.amount, 0);
      trend.push({
        key,
        label,
        total: monthTotal,
        saved: Math.max(0, income - monthTotal),
      });
    }

    // Month-over-month comparison text. Skips when either month is empty
    // to avoid divide-by-zero, matching vanilla line 4025.
    let monthCompareText: string | null = null;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = monthKey(prevDate);
    const prevExpenses = expenses.filter((e) => e.date.startsWith(prevKey));
    const prevTotal = prevExpenses.reduce((s, e) => s + e.amount, 0);
    if (prevTotal > 0 && totalSpent > 0) {
      const diff = Math.round(((totalSpent - prevTotal) / prevTotal) * 100);
      monthCompareText =
        diff < 0
          ? `You spent ${Math.abs(diff)}% less this month vs last month.`
          : `You spent ${diff}% more this month vs last month.`;

      // Biggest category change >15% — matches vanilla 4036-4056
      const prevCats: Record<string, number> = {};
      for (const e of prevExpenses) {
        prevCats[e.category] = (prevCats[e.category] ?? 0) + e.amount;
      }
      let biggestChange: string | null = null;
      let biggestPct = 0;
      for (const cat of Object.keys(categoryTotals)) {
        if (prevCats[cat]) {
          const catDiff = ((categoryTotals[cat] - prevCats[cat]) / prevCats[cat]) * 100;
          if (Math.abs(catDiff) > Math.abs(biggestPct)) {
            biggestPct = catDiff;
            biggestChange = cat;
          }
        }
      }
      if (biggestChange && Math.abs(biggestPct) > 15) {
        monthCompareText += ` ${biggestChange} is ${biggestPct > 0 ? 'up' : 'down'} ${Math.abs(Math.round(biggestPct))}%.`;
      }
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
      monthCompareText,
    };
  }, [expenses, income, savingsGoal, currency, expensesLoading, settingsLoading]);
}

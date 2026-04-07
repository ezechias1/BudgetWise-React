import { formatCurrency } from './format';
import type { Expense, SavingsGoal } from '@/types';

export interface AdviceCard {
  type: 'info' | 'success' | 'warning' | 'danger';
  icon: string;
  title: string;
  text: string;
}

/** Category buckets for the 50/30/20 rule. */
const NEEDS_CATS = ['Housing', 'Food', 'Transport', 'Utilities', 'Health'];
const WANTS_CATS = ['Entertainment', 'Shopping', 'Subscriptions', 'Personal'];

/**
 * Ports `renderAdvice()` from js/app.js (line 2877). Given the current
 * state, returns the full list of advice cards the Advice page should show.
 * Pure function — no DOM, no mutation, deterministic.
 */
export function buildAdvice(
  monthExpenses: Expense[],
  goals: SavingsGoal[],
  income: number,
  savingsGoal: number,
  currency: string,
): AdviceCard[] {
  const totalSpent = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const remaining = income - totalSpent;
  const spendPct = income > 0 ? (totalSpent / income) * 100 : 0;

  const catTotals: Record<string, number> = {};
  for (const e of monthExpenses) {
    catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount;
  }

  const advice: AdviceCard[] = [];

  // 1. Spending-pct summary
  if (income === 0) {
    advice.push({
      type: 'info',
      icon: '💵',
      title: 'Set Your Income',
      text: 'Add your monthly income in Account to get personalized spending advice.',
    });
  } else if (spendPct > 90) {
    advice.push({
      type: 'danger',
      icon: '⚠️',
      title: 'Overspending Alert',
      text: `You've spent ${Math.round(spendPct)}% of your income this month. Look for expenses you can cut immediately.`,
    });
  } else if (spendPct > 70) {
    advice.push({
      type: 'warning',
      icon: '💡',
      title: 'Watch Your Spending',
      text: `You've used ${Math.round(spendPct)}% of your income. Be mindful of non-essential purchases.`,
    });
  } else {
    advice.push({
      type: 'success',
      icon: '✅',
      title: 'Great Spending Habits',
      text: `You've only used ${Math.round(spendPct)}% of your income. You're on track!`,
    });
  }

  // 2. Savings-goal status
  const saved = Math.max(0, remaining);
  if (savingsGoal > 0 && saved >= savingsGoal) {
    advice.push({
      type: 'success',
      icon: '🎉',
      title: 'Savings Goal Reached!',
      text: `You've saved ${formatCurrency(saved, currency)}, exceeding your goal of ${formatCurrency(savingsGoal, currency)}.`,
    });
  } else if (savingsGoal > 0) {
    advice.push({
      type: 'info',
      icon: '🎯',
      title: 'Savings Progress',
      text: `You need ${formatCurrency(savingsGoal - saved, currency)} more to hit your monthly goal.`,
    });
  }

  // 3. Category ratios
  if (income > 0) {
    const foodPct = ((catTotals['Food'] ?? 0) / income) * 100;
    if (foodPct > 25) {
      advice.push({
        type: 'warning',
        icon: '🍔',
        title: 'Food Spending High',
        text: `Food is ${Math.round(foodPct)}% of income. Try meal prepping or buying in bulk.`,
      });
    }
    const entPct = ((catTotals['Entertainment'] ?? 0) / income) * 100;
    if (entPct > 15) {
      advice.push({
        type: 'warning',
        icon: '🎬',
        title: 'Entertainment Costs',
        text: `${Math.round(entPct)}% on entertainment. Look for free alternatives.`,
      });
    }
    const housePct = ((catTotals['Housing'] ?? 0) / income) * 100;
    if (housePct > 35) {
      advice.push({
        type: 'danger',
        icon: '🏠',
        title: 'Housing Too High',
        text: `Housing is ${Math.round(housePct)}% of income. Experts recommend under 30%.`,
      });
    }
  }
  if (catTotals['Subscriptions']) {
    advice.push({
      type: 'info',
      icon: '📱',
      title: 'Review Subscriptions',
      text: `${formatCurrency(catTotals['Subscriptions'], currency)} in subscriptions. Are you using all of them?`,
    });
  }

  // 4. Per-goal advice
  for (const goal of goals) {
    if (goal.saved_amount >= goal.target_amount) {
      advice.push({
        type: 'success',
        icon: '🎉',
        title: `${goal.name} - Complete!`,
        text: `You've saved enough for ${goal.name}. Congratulations!`,
      });
    } else if (goal.monthly_contribution > 0) {
      const monthsLeft = Math.ceil(
        (goal.target_amount - goal.saved_amount) / goal.monthly_contribution,
      );
      advice.push({
        type: 'info',
        icon: '💰',
        title: `Saving for ${goal.name}`,
        text: `${formatCurrency(goal.target_amount - goal.saved_amount, currency)} to go. At ${formatCurrency(goal.monthly_contribution, currency)}/month, about ${monthsLeft} month${monthsLeft === 1 ? '' : 's'} left.`,
      });
    }
  }

  // 5. 50/30/20 rule
  if (income > 0) {
    const needs = NEEDS_CATS.reduce((s, c) => s + (catTotals[c] ?? 0), 0);
    const wants = WANTS_CATS.reduce((s, c) => s + (catTotals[c] ?? 0), 0);
    const nPct = (needs / income) * 100;
    const wPct = (wants / income) * 100;
    const onTrack = nPct <= 50 && wPct <= 30;
    advice.push({
      type: 'info',
      icon: '📊',
      title: '50/30/20 Rule',
      text: `Needs: ${Math.round(nPct)}% (50%) | Wants: ${Math.round(wPct)}% (30%) | Savings: ${Math.round(100 - nPct - wPct)}% (20%). ${onTrack ? "You're on track!" : 'Adjust spending to hit these targets.'}`,
    });
  }

  if (monthExpenses.length === 0) {
    advice.push({
      type: 'info',
      icon: '📝',
      title: 'Start Tracking',
      text: 'No expenses logged this month. Add some to get personalized advice.',
    });
  }

  return advice;
}

/** Ports the "Comfortable Living" calculation from app.js (line 2934). */
export interface ComfortStats {
  monthlyExpenses: number;
  buffer: number;
  savingsLine: number;
  comfortMonthly: number;
  comfortYearly: number;
  note: string;
}

export function buildComfort(
  monthExpenses: Expense[],
  income: number,
  currency: string,
): ComfortStats {
  const monthlyExpenses = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const buffer = monthlyExpenses * 0.2;
  const savingsLine = monthlyExpenses * 0.15;
  const comfortMonthly = monthlyExpenses + buffer + savingsLine;
  const comfortYearly = comfortMonthly * 12;

  let note: string;
  if (monthlyExpenses === 0) {
    note = 'Add some expenses to see your comfortable living calculation.';
  } else if (income >= comfortMonthly) {
    note = `Your current income of ${formatCurrency(income, currency)} covers comfortable living. You're in great shape!`;
  } else {
    note = `You need ${formatCurrency(comfortMonthly - income, currency)} more per month to live comfortably based on your spending.`;
  }

  return { monthlyExpenses, buffer, savingsLine, comfortMonthly, comfortYearly, note };
}

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

// =============================================
// AI Spending Insights
// =============================================

export interface AIInsight {
  type: 'positive' | 'negative' | 'neutral';
  icon: string;
  title: string;
  text: string;
}

/**
 * Ports `renderAIInsights()` from js/app.js:4293 — derives 4-6 contextual
 * insights from this month's expenses + last month's totals + income.
 * Pure function: deterministic, easy to test, no DOM mutation.
 */
export function buildAIInsights(
  monthExpenses: Expense[],
  prevMonthExpenses: Expense[],
  income: number,
  currency: string,
): AIInsight[] {
  const insights: AIInsight[] = [];
  if (monthExpenses.length === 0) return insights;

  const totalSpent = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const catTotals: Record<string, number> = {};
  for (const e of monthExpenses) {
    catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount;
  }

  // 1. Top spending category
  const sortedCats = Object.keys(catTotals).sort(
    (a, b) => catTotals[b] - catTotals[a],
  );
  const topCat = sortedCats[0];
  const topPct = totalSpent > 0 ? Math.round((catTotals[topCat] / totalSpent) * 100) : 0;
  insights.push({
    type: topPct > 40 ? 'negative' : 'neutral',
    icon: '📊',
    title: `Top Category: ${topCat}`,
    text:
      `${topCat} takes up ${topPct}% of your spending (${formatCurrency(catTotals[topCat], currency)}). ` +
      (topPct > 40
        ? 'This is quite concentrated — consider diversifying or reducing.'
        : 'This looks like a reasonable proportion.'),
  });

  // 2. Spending velocity / projection
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyAvg = totalSpent / dayOfMonth;
  const projectedTotal = dailyAvg * daysInMonth;
  if (income > 0) {
    const projPct = Math.round((projectedTotal / income) * 100);
    insights.push({
      type: projPct > 100 ? 'negative' : projPct > 80 ? 'neutral' : 'positive',
      icon: '🚀',
      title: 'Spending Projection',
      text:
        `At your current rate of ${formatCurrency(dailyAvg, currency)}/day, you're on track to spend ${formatCurrency(projectedTotal, currency)} this month (${projPct}% of income). ` +
        (projPct > 100
          ? "You'll overshoot your budget — slow down spending now."
          : projPct > 80
            ? 'Getting close to your limit — be mindful.'
            : "Looking good, you're well within budget."),
    });
  }

  // 3. Weekend vs weekday
  let weekdaySpend = 0;
  let weekendSpend = 0;
  let weekdayCount = 0;
  let weekendCount = 0;
  for (const e of monthExpenses) {
    const day = new Date(e.date).getDay();
    if (day === 0 || day === 6) {
      weekendSpend += e.amount;
      weekendCount++;
    } else {
      weekdaySpend += e.amount;
      weekdayCount++;
    }
  }
  if (weekendCount > 0 && weekdayCount > 0) {
    const wkdayAvg = weekdaySpend / weekdayCount;
    const wkendAvg = weekendSpend / weekendCount;
    if (wkendAvg > wkdayAvg * 1.5) {
      insights.push({
        type: 'negative',
        icon: '📅',
        title: 'Weekend Spending Spike',
        text: `You spend ${formatCurrency(wkendAvg, currency)} per transaction on weekends vs ${formatCurrency(wkdayAvg, currency)} on weekdays. Weekend impulse spending might be hurting your budget.`,
      });
    } else {
      insights.push({
        type: 'positive',
        icon: '📅',
        title: 'Consistent Spending Pattern',
        text: "Your weekday and weekend spending are balanced — that's a sign of disciplined habits.",
      });
    }
  }

  // 4. Month-over-month
  if (prevMonthExpenses.length > 0) {
    const lastTotal = prevMonthExpenses.reduce((s, e) => s + e.amount, 0);
    const changePct = lastTotal > 0 ? Math.round(((totalSpent - lastTotal) / lastTotal) * 100) : 0;
    insights.push({
      type: changePct > 20 ? 'negative' : changePct < -10 ? 'positive' : 'neutral',
      icon: changePct > 0 ? '📈' : '📉',
      title: 'Month-over-Month',
      text:
        changePct > 0
          ? `Spending is up ${changePct}% vs last month (${formatCurrency(lastTotal, currency)} → ${formatCurrency(totalSpent, currency)}). Check which categories grew.`
          : changePct < 0
            ? `Spending is down ${Math.abs(changePct)}% vs last month. Great cost-cutting!`
            : 'Spending is roughly the same as last month.',
    });
  }

  // 5. Frequency
  const catCounts: Record<string, number> = {};
  for (const e of monthExpenses) {
    catCounts[e.category] = (catCounts[e.category] ?? 0) + 1;
  }
  const freqCat = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a])[0];
  if (freqCat && catCounts[freqCat] > 5) {
    insights.push({
      type: 'neutral',
      icon: '🔁',
      title: `Frequent: ${freqCat}`,
      text: `You've made ${catCounts[freqCat]} ${freqCat} transactions this month. Small purchases add up — they total ${formatCurrency(catTotals[freqCat], currency)}.`,
    });
  }

  // 6. Savings potential
  if (income > 0 && totalSpent < income) {
    const canSave = income - totalSpent;
    const savePct = Math.round((canSave / income) * 100);
    insights.push({
      type: 'positive',
      icon: '💰',
      title: 'Savings Potential',
      text:
        `You have ${formatCurrency(canSave, currency)} (${savePct}%) left this month. ` +
        (savePct > 30
          ? 'Excellent — consider moving some to savings goals.'
          : 'Keep watching your spending to maintain this buffer.'),
    });
  }

  return insights;
}

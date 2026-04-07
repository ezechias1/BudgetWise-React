// Category catalog — lifted verbatim from js/app.js lines 193-213 so
// the React port uses the exact same colors, icons, and ordering as the
// vanilla app.

export const CATEGORIES = [
  'Housing',
  'Food',
  'Transport',
  'Utilities',
  'Entertainment',
  'Shopping',
  'Health',
  'Education',
  'Subscriptions',
  'Personal',
  'Savings',
  'Tithe',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Longer labels used in the Add Expense dropdown (from dashboard.html). */
export const CATEGORY_LABELS: Record<Category, string> = {
  Housing: 'Housing / Rent',
  Food: 'Food & Groceries',
  Transport: 'Transport',
  Utilities: 'Utilities (Electric, Water, WiFi)',
  Entertainment: 'Entertainment',
  Shopping: 'Shopping',
  Health: 'Health & Medical',
  Education: 'Education',
  Subscriptions: 'Subscriptions',
  Personal: 'Personal Care',
  Savings: 'Savings / Investment',
  Tithe: 'Tithe (10%)',
  Other: 'Other',
};

export const CATEGORY_COLORS: Record<Category, string> = {
  Housing: '#10b981',
  Food: '#f59e0b',
  Transport: '#3b82f6',
  Utilities: '#8b5cf6',
  Entertainment: '#ec4899',
  Shopping: '#f97316',
  Health: '#06b6d4',
  Education: '#6366f1',
  Subscriptions: '#14b8a6',
  Personal: '#e879f9',
  Savings: '#22d3ee',
  Tithe: '#a78bfa',
  Other: '#6b7280',
};

export const CATEGORY_ICONS: Record<Category, string> = {
  Housing: '🏠',
  Food: '🍕',
  Transport: '🚗',
  Utilities: '⚡',
  Entertainment: '🎬',
  Shopping: '🛍️',
  Health: '🏥',
  Education: '📚',
  Subscriptions: '📺',
  Personal: '💅',
  Savings: '💰',
  Tithe: '🙏',
  Other: '📦',
};

export type Recurring = 'no' | 'weekly' | 'monthly';

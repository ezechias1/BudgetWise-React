// Category catalog — ported from js/app.js lines 193-213 and 5498-5572 so
// the React port uses the exact same categories per mode as the vanilla app.

import type { Mode } from '@/types';

export interface CategoryOption {
  value: string;
  label: string;
}

// Personal mode — js/app.js line 5518
export const PERSONAL_CATEGORIES: CategoryOption[] = [
  { value: 'Housing', label: 'Housing / Rent' },
  { value: 'Food', label: 'Food & Groceries' },
  { value: 'Transport', label: 'Transport' },
  { value: 'Utilities', label: 'Utilities (Electric, Water, WiFi)' },
  { value: 'Entertainment', label: 'Entertainment' },
  { value: 'Shopping', label: 'Shopping' },
  { value: 'Health', label: 'Health & Medical' },
  { value: 'Education', label: 'Education' },
  { value: 'Subscriptions', label: 'Subscriptions' },
  { value: 'Personal', label: 'Personal Care' },
  { value: 'Savings', label: 'Savings / Investment' },
  { value: 'Tithe', label: 'Tithe (10%)' },
  { value: 'Other', label: 'Other' },
];

// Business mode — js/app.js line 5498
export const BUSINESS_CATEGORIES: CategoryOption[] = [
  { value: 'COGS', label: 'Cost of Goods Sold' },
  { value: 'Payroll', label: 'Payroll & Wages' },
  { value: 'Rent & Lease', label: 'Rent & Lease' },
  { value: 'Marketing', label: 'Marketing & Advertising' },
  { value: 'Software & SaaS', label: 'Software & SaaS' },
  { value: 'Professional Fees', label: 'Legal / Accounting Fees' },
  { value: 'Office Expenses', label: 'Office Expenses' },
  { value: 'Travel & Mileage', label: 'Travel & Mileage' },
  { value: 'Client Meals', label: 'Client Meals & Entertainment' },
  { value: 'Equipment', label: 'Equipment & Assets' },
  { value: 'Insurance', label: 'Business Insurance' },
  { value: 'Taxes & Licenses', label: 'Taxes & Licenses' },
  { value: 'Contractors', label: 'Contractors & Freelancers' },
  { value: 'Shipping & Logistics', label: 'Shipping & Logistics' },
  { value: 'Bank & Processing Fees', label: 'Bank & Processing Fees' },
  { value: 'Tithe', label: 'Tithe (10%)' },
  { value: 'Miscellaneous', label: 'Miscellaneous' },
];

// Family mode — js/app.js line 5534
export const FAMILY_CATEGORIES: CategoryOption[] = [
  { value: 'Groceries', label: 'Groceries' },
  { value: 'Household Bills', label: 'Household Bills' },
  { value: 'School Fees', label: 'School Fees' },
  { value: 'Medical', label: 'Medical & Health' },
  { value: 'Clothing', label: 'Clothing' },
  { value: 'Entertainment', label: 'Family Entertainment' },
  { value: 'Outings', label: 'Outings & Activities' },
  { value: 'Transport', label: 'Transport' },
  { value: 'Pocket Money', label: 'Pocket Money' },
  { value: 'Gifts', label: 'Gifts' },
  { value: 'Pets', label: 'Pets' },
  { value: 'Family Savings', label: 'Family Savings' },
  { value: 'Other', label: 'Other' },
];

// SA-specific extras — inserted before "Other" for Personal/Family in South Africa
// js/app.js line 5551
export const SA_EXTRA_CATEGORIES: CategoryOption[] = [
  { value: 'Airtime', label: 'Airtime & Data' },
  { value: 'Taxi', label: 'Taxi / Minibus' },
  { value: 'Load Shedding', label: 'Load Shedding' },
  { value: 'Stokvel', label: 'Stokvel Contribution' },
  { value: 'School Fees', label: 'School Fees' },
];

/**
 * Returns the right category list for the given mode, with SA-specific
 * extras merged in for Personal/Family. Matches `swapExpenseCategories`
 * from js/app.js:5559.
 */
export function getCategoriesForMode(
  mode: Mode,
  isSA: boolean = true,
): CategoryOption[] {
  let base: CategoryOption[];
  if (mode === 'business') return BUSINESS_CATEGORIES;
  if (mode === 'family') base = FAMILY_CATEGORIES;
  else base = PERSONAL_CATEGORIES;

  if (!isSA) return base;

  // Merge SA extras before "Other", dedupe by value
  const existingValues = new Set(base.map((c) => c.value));
  const extras = SA_EXTRA_CATEGORIES.filter((c) => !existingValues.has(c.value));
  const otherIdx = base.findIndex((c) => c.value === 'Other');
  if (otherIdx === -1) return [...base, ...extras];
  return [...base.slice(0, otherIdx), ...extras, ...base.slice(otherIdx)];
}

// Back-compat exports used by the older code paths. These are the personal
// category value strings only — the rest of the code uses `getCategoriesForMode`.
export const CATEGORIES = PERSONAL_CATEGORIES.map((c) => c.value);
export type Category = string;

/** Back-compat label map (personal mode only). Prefer getCategoriesForMode. */
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAL_CATEGORIES.map((c) => [c.value, c.label]),
);

export const CATEGORY_COLORS: Record<string, string> = {
  // Personal
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
  // Business
  COGS: '#ef4444',
  Payroll: '#10b981',
  'Rent & Lease': '#3b82f6',
  Marketing: '#8b5cf6',
  'Software & SaaS': '#06b6d4',
  'Professional Fees': '#f59e0b',
  'Office Expenses': '#6366f1',
  'Travel & Mileage': '#f97316',
  'Client Meals': '#ec4899',
  Equipment: '#14b8a6',
  Insurance: '#a78bfa',
  'Taxes & Licenses': '#eab308',
  Contractors: '#22d3ee',
  'Shipping & Logistics': '#84cc16',
  'Bank & Processing Fees': '#e879f9',
  Miscellaneous: '#6b7280',
  // Family
  Groceries: '#f59e0b',
  'Household Bills': '#8b5cf6',
  'School Fees': '#6366f1',
  Medical: '#06b6d4',
  Clothing: '#ec4899',
  Outings: '#f97316',
  'Pocket Money': '#22d3ee',
  Gifts: '#a78bfa',
  Pets: '#84cc16',
  'Family Savings': '#10b981',
  // SA extras
  Airtime: '#06b6d4',
  Taxi: '#f59e0b',
  'Load Shedding': '#eab308',
  Stokvel: '#22d3ee',
};

export const CATEGORY_ICONS: Record<string, string> = {
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

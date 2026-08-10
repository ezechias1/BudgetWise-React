// Shared types for the BudgetWise React app.
// These mirror the shapes used by the vanilla app so queries are compatible.

export type Mode = 'personal' | 'business' | 'family';
export type Theme = 'dark' | 'light';

export interface UserSettings {
  user_id: string;
  currency: string;
  monthly_income: number;
  monthly_savings_goal: number;
  account_type: Mode;
  is_pro: boolean;
  subscription_end: string | null;
  has_paid: boolean;
  country: string | null;
  full_name: string | null;
  company_name: string | null;
  family_name: string | null;
  automations: Record<string, unknown> | null;
  created_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  category: string;
  description: string;
  date: string; // ISO date (YYYY-MM-DD)
  recurring: 'no' | 'weekly' | 'monthly';
  account_mode: Mode;
  group_id: string | null;
  trip_id: string | null;
  /** null = needs review; only meaningful for expenses tagged to a trip. */
  business_expense: boolean | null;
  created_at: string;
}

/** Trips are scoped to Personal and Family modes only — no Business trips. */
export type TripMode = 'personal' | 'family';

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  start_date: string; // ISO date (YYYY-MM-DD)
  end_date: string; // ISO date (YYYY-MM-DD)
  account_mode: TripMode;
  group_id: string | null;
  created_at: string;
}

export interface NewTrip {
  name: string;
  start_date: string;
  end_date: string;
}

export interface NewExpense {
  amount: number;
  category: string;
  description: string;
  date: string;
  recurring: 'no' | 'weekly' | 'monthly';
}

export interface SavingsGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  monthly_contribution: number;
  deadline: string | null;
  account_mode: Mode;
  created_at: string;
}

export interface NewSavingsGoal {
  name: string;
  target_amount: number;
  monthly_contribution: number;
  deadline: string | null;
}

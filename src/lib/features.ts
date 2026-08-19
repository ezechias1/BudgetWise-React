import type { Mode } from '@/types';

/**
 * Product-level feature switches.
 *
 * These are deliberately plain constants rather than env vars or database
 * flags: a feature is either shipped or it isn't, and flipping one should be
 * a code change that goes through review and a deploy.
 *
 * `BANK_CONNECT_ENABLED` in BankPage.tsx is the same idea, scoped to one page.
 */

/**
 * Business mode is being rebuilt, so it's closed to users for now.
 *
 * While this is false the workspace is unreachable — the picker card, the
 * sidebar dropdown entry and the signup account type are all shown but
 * disabled with a "Coming Soon" badge, ModeContext refuses to enter the mode
 * even if an old session left `bw-mode=business` in localStorage, and the
 * business-only routes redirect back to the dashboard.
 *
 * Nothing is deleted. Set this to true and every business surface returns
 * exactly as it was, including its BudgetSmart answers.
 */
export const BUSINESS_MODE_ENABLED: boolean = false;

/** Workspaces a user can actually open, in the order they're offered. */
export const AVAILABLE_MODES: Mode[] = BUSINESS_MODE_ENABLED
  ? ['personal', 'business', 'family']
  : ['personal', 'family'];

export function isModeAvailable(mode: Mode): boolean {
  return AVAILABLE_MODES.includes(mode);
}

/**
 * Shown wherever a disabled Business control needs a word of explanation.
 * One string so the picker, the sidebar and signup can't drift apart.
 */
export const BUSINESS_SOON_NOTE =
  'Business accounts are being rebuilt and aren’t open yet. ' +
  'Personal and Family both work fully in the meantime.';

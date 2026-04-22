/**
 * Access control constants and helpers — mirrors js/app.js:15, 32, 519.
 *
 * ENABLE_PRO_SYSTEM === false: the Pro system is currently disabled across
 * the whole app, so every user is effectively Pro. This matches the current
 * state of the live vanilla site.
 *
 * ADMIN_EMAILS: exact match list. Any user outside this list must not see
 * the Admin nav item or any admin-only surface.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';

export const ENABLE_PRO_SYSTEM = false;

export const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(user: User | null | undefined): boolean {
  if (!user?.email) return false;
  return ADMIN_EMAILS.includes(user.email.toLowerCase());
}

/**
 * True when the user should see the full product with no upgrade prompts.
 *
 * Resolution order:
 *   1. Admins (founders) are ALWAYS Pro — no matter what is_pro says.
 *   2. When the Pro system is disabled globally, everyone is Pro.
 *   3. Otherwise, defer to the `is_pro` flag from user_settings.
 *
 * Both arguments are optional so existing call sites that only know the
 * settings flag still work; pass the user as well to get the founder bypass.
 */
export function isProUser(
  isProFromSettings: boolean,
  user?: User | null,
): boolean {
  if (user && isAdmin(user)) return true;
  if (!ENABLE_PRO_SYSTEM) return true;
  return isProFromSettings;
}

/**
 * A "kid user" is an authenticated Supabase user whose auth_user_id matches
 * a family_members row. The helper is async because we have to ask the DB —
 * you can't tell from the JWT alone (we could put it in user_metadata but
 * metadata is user-editable and shouldn't be trusted for routing).
 *
 * Prefer the useKidProfile hook in components; this raw helper is for places
 * the hook can't reach (e.g. one-off scripts).
 */
export interface KidMemberRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  age: number | null;
  date_of_birth: string | null;
  allowance: number;
  earned: number;
  spent: number;
  jar_split: { save: number; spend: number; give: number };
  role: string;
}

export async function fetchKidMemberForUser(
  client: SupabaseClient,
  userId: string,
): Promise<KidMemberRow | null> {
  const { data, error } = await client
    .from('family_members')
    .select('id, user_id, name, color, age, date_of_birth, allowance, earned, spent, jar_split, role')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as KidMemberRow) ?? null;
}

/**
 * Junior freemium tier limits, per the design spec.
 * When ENABLE_PRO_SYSTEM=false these don't kick in since everyone is Pro.
 */
export const JUNIOR_FREE_LIMITS = {
  maxKids: 1,
  maxChoresPerKid: 3,
  maxCompletedMissions: 5,
} as const;

export interface JuniorGateReason {
  kind: 'kids' | 'chores' | 'missions';
  limit: number;
  current: number;
}

/** Returns null if the action is allowed, or a reason object if blocked. */
export function checkJuniorGate(
  isPro: boolean,
  kind: 'kids' | 'chores' | 'missions',
  current: number,
): JuniorGateReason | null {
  if (isPro) return null;
  const limit =
    kind === 'kids' ? JUNIOR_FREE_LIMITS.maxKids :
    kind === 'chores' ? JUNIOR_FREE_LIMITS.maxChoresPerKid :
    JUNIOR_FREE_LIMITS.maxCompletedMissions;
  return current >= limit ? { kind, limit, current } : null;
}

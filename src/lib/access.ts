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

import type { User } from '@supabase/supabase-js';

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

import { supabase } from '@/lib/supabase';

/**
 * Must match derivePassword in supabase/functions/create-kid-user/index.ts.
 * Any divergence here and the PIN login will silently fail.
 */
export function derivePassword(pin: string, memberId: string): string {
  const suffix = memberId.replace(/-/g, '').slice(0, 8);
  return `kid_${pin}_${suffix}`;
}

export function kidEmailForMember(memberId: string): string {
  return `kid-${memberId}@budgetwise.app`;
}

export type KidSignInStatus = 'ok' | 'wrong_pin' | 'rate_limited' | 'error';

export async function signInAsKid(
  memberId: string,
  pin: string,
): Promise<{ status: KidSignInStatus; error: string | null }> {
  const email = kidEmailForMember(memberId);
  const password = derivePassword(pin, memberId);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return { status: 'ok', error: null };
  // AUDIT Imp #4 / #5: distinguish wrong-PIN from rate-limit (HTTP 429)
  // so the kid UI can explain why repeated correct entries now fail.
  if (error.status === 429) return { status: 'rate_limited', error: error.message };
  return { status: 'wrong_pin', error: error.message };
}

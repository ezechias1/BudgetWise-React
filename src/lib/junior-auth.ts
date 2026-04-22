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

export async function signInAsKid(memberId: string, pin: string) {
  const email = kidEmailForMember(memberId);
  const password = derivePassword(pin, memberId);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

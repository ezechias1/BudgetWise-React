import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';

interface UserSettingsRow {
  user_id: string;
  currency: string | null;
  avatar_url: string | null;
  is_pro: boolean | null;
  company_name: string | null;
  family_name: string | null;
  // Personal
  income: number | null;
  savings_goal: number | null;
  // Business
  biz_income: number | null;
  biz_savings_goal: number | null;
  // Family
  fam_income: number | null;
  fam_savings_goal: number | null;
}

interface UpdateInput {
  currency?: string;
  income?: number;
  savings_goal?: number;
}

/**
 * Reads (and mutates) the current user's settings row.
 *
 * The vanilla app stores income + savings_goal as three separate column pairs
 * on `user_settings` — one per mode (personal/business/family). This hook
 * reads all three pairs and returns the one that matches the current mode,
 * so switching modes shows the correct income + savings target.
 *
 * Mirrors the vanilla mapping in js/app.js:607-614, 1701-1708, and the
 * transfer-money logic at 2553-2602.
 */
export function useUserSettings() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [row, setRow] = useState<UserSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('user_settings')
      .select(
        'user_id, currency, avatar_url, is_pro, company_name, family_name, income, savings_goal, biz_income, biz_savings_goal, fam_income, fam_savings_goal',
      )
      .eq('user_id', user.id)
      .maybeSingle();
    setRow((data as UserSettingsRow | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Pick the right pair of columns for the current mode.
  const income =
    mode === 'business'
      ? row?.biz_income ?? 0
      : mode === 'family'
        ? row?.fam_income ?? 0
        : row?.income ?? 0;

  const savingsGoal =
    mode === 'business'
      ? row?.biz_savings_goal ?? 0
      : mode === 'family'
        ? row?.fam_savings_goal ?? 0
        : row?.savings_goal ?? 0;

  const updateSettings = useCallback(
    async (input: UpdateInput): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };

      // Map logical keys to the mode-specific physical columns.
      const patch: Record<string, unknown> = { user_id: user.id };
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.income !== undefined) {
        if (mode === 'business') patch.biz_income = input.income;
        else if (mode === 'family') patch.fam_income = input.income;
        else patch.income = input.income;
      }
      if (input.savings_goal !== undefined) {
        if (mode === 'business') patch.biz_savings_goal = input.savings_goal;
        else if (mode === 'family') patch.fam_savings_goal = input.savings_goal;
        else patch.savings_goal = input.savings_goal;
      }

      const { error } = await supabase.from('user_settings').upsert(patch);
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [user, mode, load],
  );

  return {
    loading,
    currency: row?.currency ?? 'ZAR',
    avatarUrl: row?.avatar_url ?? null,
    isProFromSettings: row?.is_pro ?? false,
    companyName: row?.company_name ?? null,
    familyName: row?.family_name ?? null,
    income,
    savingsGoal,
    updateSettings,
    refresh: load,
  };
}

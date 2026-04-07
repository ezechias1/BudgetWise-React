import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface UserSettingsRow {
  user_id: string;
  currency: string | null;
  income: number | null;
  savings_goal: number | null;
}

interface UpdateInput {
  currency?: string;
  income?: number;
  savings_goal?: number;
}

/**
 * Reads (and mutates) the current user's settings row. Returns sensible
 * fallbacks (currency = 'ZAR', income = 0) so callers can render before
 * the row loads without null-guarding every field.
 *
 * Mode-specific columns (biz_income, fam_income, etc.) that the vanilla
 * app uses are intentionally flattened here — the React port treats the
 * personal columns as canonical for now.
 */
export function useUserSettings() {
  const { user } = useAuth();
  const [row, setRow] = useState<UserSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('user_settings')
      .select('user_id, currency, income, savings_goal')
      .eq('user_id', user.id)
      .maybeSingle();
    setRow((data as UserSettingsRow | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSettings = useCallback(
    async (input: UpdateInput): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      // Upsert so first-time users still get a row created.
      const { error } = await supabase.from('user_settings').upsert({
        user_id: user.id,
        ...input,
      });
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [user, load],
  );

  return {
    loading,
    currency: row?.currency ?? 'ZAR',
    income: row?.income ?? 0,
    savingsGoal: row?.savings_goal ?? 0,
    updateSettings,
    refresh: load,
  };
}

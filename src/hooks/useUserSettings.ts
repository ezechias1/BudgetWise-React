import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface UserSettingsRow {
  user_id: string;
  currency: string | null;
  income: number | null;
  savings_goal: number | null;
}

/**
 * Reads the current user's settings row. Returns sensible fallbacks
 * (currency = 'ZAR', income = 0) so callers can render before the row
 * loads without null-guarding every field.
 */
export function useUserSettings() {
  const { user } = useAuth();
  const [row, setRow] = useState<UserSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('user_settings')
        .select('user_id, currency, income, savings_goal')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled) {
        setRow((data as UserSettingsRow | null) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return {
    loading,
    currency: row?.currency ?? 'ZAR',
    income: row?.income ?? 0,
    savingsGoal: row?.savings_goal ?? 0,
  };
}

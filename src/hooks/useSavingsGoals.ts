import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import type { NewSavingsGoal, SavingsGoal } from '@/types';

/**
 * CRUD hook for the `savings_goals` Supabase table. Mirrors the query
 * shape in js/app.js `loadSavingsGoals()` (line 2041): scoped by
 * user_id + account_mode, ordered by created_at desc.
 */
export function useSavingsGoals() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    // Personal mode also picks up legacy rows where account_mode IS NULL.
    let query = supabase
      .from('savings_goals')
      .select('*')
      .eq('user_id', user.id);
    query =
      mode === 'personal'
        ? query.or('account_mode.is.null,account_mode.eq.personal')
        : query.eq('account_mode', mode);
    const { data, error: err } = await query.order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setGoals((data ?? []) as SavingsGoal[]);
    setLoading(false);
  }, [user, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const addGoal = useCallback(
    async (input: NewSavingsGoal): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const { error: err } = await supabase.from('savings_goals').insert({
        ...input,
        user_id: user.id,
        saved_amount: 0,
        account_mode: mode,
      });
      if (err) return { error: err.message };
      await load();
      return { error: null };
    },
    [user, mode, load],
  );

  const fundGoal = useCallback(
    async (goalId: string, amount: number): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const goal = goals.find((g) => g.id === goalId);
      if (!goal) return { error: 'Goal not found' };
      const newSaved = goal.saved_amount + amount;
      const { error: err } = await supabase
        .from('savings_goals')
        .update({ saved_amount: newSaved })
        .eq('id', goalId)
        .eq('user_id', user.id);
      if (err) return { error: err.message };
      await load();
      return { error: null };
    },
    [user, goals, load],
  );

  const deleteGoal = useCallback(
    async (goalId: string): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      // Optimistic
      const snapshot = goals;
      setGoals((g) => g.filter((x) => x.id !== goalId));
      const { error: err } = await supabase
        .from('savings_goals')
        .delete()
        .eq('id', goalId)
        .eq('user_id', user.id);
      if (err) {
        setGoals(snapshot);
        return { error: err.message };
      }
      return { error: null };
    },
    [user, goals],
  );

  return { goals, loading, error, refresh: load, addGoal, fundGoal, deleteGoal };
}

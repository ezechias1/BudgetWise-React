import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import type { Expense, Mode, NewExpense } from '@/types';

/**
 * Reads and mutates the `expenses` Supabase table.
 *
 * Mirrors the query shape in js/app.js `loadExpenses()` (line 2154):
 * always scopes by `user_id` + `account_mode`, ordered by date desc.
 *
 * Exposes a minimal CRUD API:
 *   - `expenses`       — current list
 *   - `loading` / `error`
 *   - `refresh()`      — refetch
 *   - `addExpense(e)`  — insert, refresh
 *   - `deleteExpense(id)` — optimistic delete, rollback on failure
 */
export function useExpenses() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    // Personal mode also picks up legacy rows where account_mode IS NULL
    // (vanilla app wrote those before the mode column existed).
    let query = supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id);
    query =
      mode === 'personal'
        ? query.or('account_mode.is.null,account_mode.eq.personal')
        : query.eq('account_mode', mode);
    const { data, error: err } = await query.order('date', { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setExpenses((data ?? []) as Expense[]);
    }
    setLoading(false);
  }, [user, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const addExpense = useCallback(
    async (input: NewExpense): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const { error: err } = await supabase.from('expenses').insert({
        ...input,
        user_id: user.id,
        account_mode: mode,
      });
      if (err) return { error: err.message };
      await load();
      return { error: null };
    },
    [user, mode, load],
  );

  const deleteExpense = useCallback(
    async (id: string): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      // Optimistic removal
      const snapshot = expenses;
      setExpenses((list) => list.filter((e) => e.id !== id));
      const { error: err } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (err) {
        setExpenses(snapshot); // rollback
        return { error: err.message };
      }
      return { error: null };
    },
    [user, expenses],
  );

  // Ports js/app.js `attachMoveHandlers` (line 2438) — flips an expense's
  // account_mode so it disappears from the current ledger and shows in another.
  const moveExpense = useCallback(
    async (id: string, targetMode: Mode): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const snapshot = expenses;
      setExpenses((list) => list.filter((e) => e.id !== id)); // optimistic
      const { error: err } = await supabase
        .from('expenses')
        .update({ account_mode: targetMode })
        .eq('id', id)
        .eq('user_id', user.id);
      if (err) {
        setExpenses(snapshot);
        return { error: err.message };
      }
      return { error: null };
    },
    [user, expenses],
  );

  return {
    expenses,
    loading,
    error,
    refresh: load,
    addExpense,
    deleteExpense,
    moveExpense,
  };
}

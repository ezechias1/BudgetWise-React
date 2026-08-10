import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Expense } from '@/types';

/**
 * Every expense across every trip that still needs a Business/Personal
 * decision — backs the app-open review gate (TripReviewGateModal).
 *
 * Deliberately independent of useExpenses()'s filtered state: it must also
 * catch items created by a future card-sync job, another device/session, or
 * anything else that writes to `expenses` outside this tab — not just
 * inserts made through this session's own addExpense calls.
 */
export function usePendingTripReviews() {
  const { user } = useAuth();

  const [pendingExpenses, setPendingExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setPendingExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id)
      .not('trip_id', 'is', null)
      .is('business_expense', null)
      .order('date', { ascending: true });
    setPendingExpenses((data ?? []) as Expense[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const classify = useCallback(
    async (expenseId: string, value: boolean): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      setPendingExpenses((list) => list.filter((e) => e.id !== expenseId));
      const { error } = await supabase
        .from('expenses')
        .update({ business_expense: value })
        .eq('id', expenseId)
        .eq('user_id', user.id);
      if (error) {
        await load();
        return { error: error.message };
      }
      return { error: null };
    },
    [user, load],
  );

  return { pendingExpenses, loading, refresh: load, classify };
}

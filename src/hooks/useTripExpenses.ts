import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Expense } from '@/types';

/**
 * Expense list scoped to a single trip, plus the business/personal split
 * and "needs review" count the Trips detail view is built around.
 * `business_expense === null` means the expense hasn't been sorted yet.
 */
export function useTripExpenses(tripId: string | null) {
  const { user } = useAuth();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !tripId) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id)
      .eq('trip_id', tripId)
      .order('date', { ascending: false });
    if (err) setError(err.message);
    else setExpenses((data ?? []) as Expense[]);
    setLoading(false);
  }, [user, tripId]);

  useEffect(() => {
    if (!user || !tripId) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: err } = await supabase
        .from('expenses')
        .select('*')
        .eq('user_id', user.id)
        .eq('trip_id', tripId)
        .order('date', { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setExpenses((data ?? []) as Expense[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tripId]);

  // Sets/clears the business-vs-personal flag on one expense.
  // Passing null puts it back into "needs review".
  const setBusinessFlag = useCallback(
    async (expenseId: string, value: boolean | null): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const snapshot = expenses;
      setExpenses((list) =>
        list.map((e) => (e.id === expenseId ? { ...e, business_expense: value } : e)),
      );
      const { error: err } = await supabase
        .from('expenses')
        .update({ business_expense: value })
        .eq('id', expenseId)
        .eq('user_id', user.id);
      if (err) {
        setExpenses(snapshot);
        return { error: err.message };
      }
      return { error: null };
    },
    [user, expenses],
  );

  const totals = useMemo(() => {
    let business = 0;
    let personal = 0;
    let reviewCount = 0;
    for (const e of expenses) {
      if (e.business_expense === true) business += Number(e.amount);
      else if (e.business_expense === false) personal += Number(e.amount);
      else reviewCount += 1;
    }
    return { business, personal, reviewCount, total: business + personal };
  }, [expenses]);

  return { expenses, loading, error, refresh: load, setBusinessFlag, ...totals };
}

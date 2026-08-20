import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useFamilyGroupId } from '@/hooks/useFamilyMembers';
import type { Expense, Mode, NewExpense } from '@/types';

export type ExpensePatch = Partial<NewExpense>;

/**
 * Family mode reads the whole household's ledger (see `load` below) but the
 * expenses write policies are own-row only, so a delete/update/move aimed at
 * a partner's row matches nothing and Postgrest still answers 200 with
 * error:null. That used to read as success: the row disappeared optimistically
 * and the Expenses page offered an Undo whose addExpense inserted a REAL
 * duplicate of money nobody had deleted. Every write below now asks for the
 * affected ids back and treats zero rows as this failure.
 *
 * The wording is deliberately neutral about WHY nothing matched. Zero rows is
 * not only a partner's row: it is also the ordinary "the row is already gone"
 * case — deleted on another device, or acted on from a stale render — which a
 * solo Personal user with no family at all can hit. Blaming a family member
 * there is simply a different false statement, so this covers both without
 * asserting either.
 */
const NO_MATCHING_ROW =
  'No matching expense was found — it may have been removed already, or it belongs to someone else in your household and only they can change it.';

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
  const familyGroupId = useFamilyGroupId();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    // Personal mode also picks up legacy rows where account_mode IS NULL
    // (vanilla app wrote those before the mode column existed).
    let query = supabase.from('expenses').select('*');
    // Family mode is the shared household ledger: drop the owner filter and
    // let RLS decide, so an approved partner's Family expenses come through
    // too. Safe because the group policy is Family-mode-only and the
    // account_mode filter below scopes the query regardless. Every other
    // mode stays strictly owner-scoped.
    if (mode !== 'family') query = query.eq('user_id', user.id);
    query =
      mode === 'personal'
        ? query.or('account_mode.is.null,account_mode.eq.personal')
        : query.eq('account_mode', mode);
    // A trip expense that's still unreviewed or confirmed Business isn't
    // this user's own money — never let it into the general ledger. Chaining
    // a second .or() ANDs it with the mode filter above (repeated top-level
    // Postgrest params AND together; confirmed against postgrest-js source).
    query = query.or('trip_id.is.null,business_expense.eq.false');
    // Imported rows land 'pending' and must not reach totals, budget
    // warnings or the pie chart until confirmed; 'dismissed' rows never do.
    // Enforced here rather than in RLS on purpose — RLS answers "may this
    // user see this row at all", and a policy hiding pending rows would
    // break the review queue, which has to query for them deliberately.
    query = query.eq('review_status', 'confirmed');
    const { data, error: err } = await query.order('date', { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setExpenses((data ?? []) as Expense[]);
    }
    setLoading(false);
  }, [user, mode]);

  // Cancelled-flag pattern — rapid mode switches can land results in the
  // wrong order and overwrite the correct mode's data. Latest mount wins.
  // (AUDIT Imp #10.) `load` is kept for manual refresh() callers where
  // cancellation doesn't matter.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      let query = supabase.from('expenses').select('*');
      if (mode !== 'family') query = query.eq('user_id', user.id); // see load()
      query =
        mode === 'personal'
          ? query.or('account_mode.is.null,account_mode.eq.personal')
          : query.eq('account_mode', mode);
      query = query.or('trip_id.is.null,business_expense.eq.false');
      query = query.eq('review_status', 'confirmed'); // see load() above
      const { data, error: err } = await query.order('date', { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setExpenses((data ?? []) as Expense[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, mode]);

  const addExpense = useCallback(
    async (input: NewExpense): Promise<{ error: string | null; expense?: Expense }> => {
      if (!user) return { error: 'Not signed in' };
      // select().single() (rather than a bare insert) so callers can inspect
      // the inserted row's trip_id/business_expense and, if it landed inside
      // a trip's date range, immediately prompt "Business or Personal?"
      // without a second round trip.
      // Stamp group_id on Family-mode rows so partners can see them. The
      // write guard rejects a group_id the user isn't an approved member
      // of, so this can only ever be their own group.
      const { data, error: err } = await supabase
        .from('expenses')
        .insert({
          ...input,
          user_id: user.id,
          account_mode: mode,
          ...(mode === 'family' && familyGroupId
            ? { group_id: familyGroupId }
            : {}),
        })
        .select()
        .single();
      if (err) return { error: err.message };
      await load();
      return { error: null, expense: data as Expense };
    },
    // familyGroupId resolves asynchronously after mount — without it here the
    // callback would close over the initial null and silently save Family
    // expenses with no group_id, invisible to the rest of the household.
    [user, mode, load, familyGroupId],
  );

  const deleteExpense = useCallback(
    async (id: string): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      // Optimistic removal
      const snapshot = expenses;
      setExpenses((list) => list.filter((e) => e.id !== id));
      const { data, error: err } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id'); // see NO_MATCHING_ROW
      if (err) {
        setExpenses(snapshot); // rollback
        return { error: err.message };
      }
      if (!data || data.length === 0) {
        setExpenses(snapshot); // nothing was deleted — put the row back
        return { error: NO_MATCHING_ROW };
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
      const { data, error: err } = await supabase
        .from('expenses')
        .update({ account_mode: targetMode })
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id'); // see NO_MATCHING_ROW
      if (err) {
        setExpenses(snapshot);
        return { error: err.message };
      }
      if (!data || data.length === 0) {
        setExpenses(snapshot); // nothing moved — put the row back
        return { error: NO_MATCHING_ROW };
      }
      return { error: null };
    },
    [user, expenses],
  );

  // Patch-update an existing expense row. Used by the inline edit modal on
   // the Expenses page. Only touches user-owned rows.
  const updateExpense = useCallback(
    async (id: string, patch: ExpensePatch): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const { data, error: err } = await supabase
        .from('expenses')
        .update(patch)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id'); // see NO_MATCHING_ROW
      if (err) return { error: err.message };
      // A zero-row update read as success, so the edit modal closed and the
      // refetch quietly put the old values straight back.
      if (!data || data.length === 0) return { error: NO_MATCHING_ROW };
      await load();
      return { error: null };
    },
    [user, load],
  );

  return {
    expenses,
    loading,
    error,
    refresh: load,
    addExpense,
    deleteExpense,
    moveExpense,
    updateExpense,
  };
}

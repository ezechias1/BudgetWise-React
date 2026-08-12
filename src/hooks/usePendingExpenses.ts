import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import type { Expense } from '@/types';

export interface PendingExpense extends Expense {
  /**
   * An already-confirmed expense that looks like the same real-world
   * transaction as this pending one. Set when the row was probably created
   * by another part of the app before the bank import saw it — a stokvel
   * contribution being the case that exists today.
   */
  duplicateOf?: Expense;
}

/** Same-day, same-amount rows are treated as the same transaction. */
const AMOUNT_TOLERANCE = 0.01;
const DAY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Finds an existing confirmed expense that plausibly IS this pending one.
 *
 * Deliberately not exact-matching on external_id — that catches re-syncs of
 * the same import (the unique index already handles those). This catches the
 * different problem: a transaction the app wrote itself AND the bank also
 * reported. A stokvel contribution is written to `expenses` by StokvelPage
 * and then arrives again as a bank debit; without this the household sees
 * the same R500 twice.
 *
 * Matches on amount within a cent and date within two days, since banks post
 * a day or two after the transaction happens.
 */
export function findDuplicate(
  pending: Expense,
  confirmed: Expense[],
): Expense | undefined {
  const pendingTime = new Date(pending.date).getTime();
  return confirmed.find((c) => {
    if (Math.abs(c.amount - pending.amount) > AMOUNT_TOLERANCE) return false;
    const diff = Math.abs(new Date(c.date).getTime() - pendingTime);
    if (diff > DAY_WINDOW_MS) return false;
    // Only app-generated rows are candidates. Two hand-entered coffees on the
    // same day for the same amount are genuinely two coffees.
    return c.source === 'stokvel';
  });
}

/**
 * Expenses awaiting review — imported rows that haven't been confirmed into
 * the ledger yet. `useExpenses` deliberately filters these out, so this is
 * the only place they surface.
 */
export function usePendingExpenses() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [pending, setPending] = useState<PendingExpense[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id)
      .eq('review_status', 'pending');
    query =
      mode === 'personal'
        ? query.or('account_mode.is.null,account_mode.eq.personal')
        : query.eq('account_mode', mode);

    const { data } = await query.order('date', { ascending: false });
    const rows = (data ?? []) as Expense[];

    if (rows.length === 0) {
      setPending([]);
      setLoading(false);
      return;
    }

    // Only fetch the confirmed rows that could possibly match — bounded by
    // the oldest pending date rather than pulling the whole ledger.
    const oldest = rows.reduce(
      (min, r) => (r.date < min ? r.date : min),
      rows[0].date,
    );
    const { data: confirmed } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id)
      .eq('review_status', 'confirmed')
      .gte('date', new Date(new Date(oldest).getTime() - DAY_WINDOW_MS)
        .toISOString()
        .slice(0, 10));

    const confirmedRows = (confirmed ?? []) as Expense[];
    setPending(
      rows.map((r) => ({ ...r, duplicateOf: findDuplicate(r, confirmedRows) })),
    );
    setLoading(false);
  }, [user, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = useCallback(
    async (id: string, patch?: { category?: string; description?: string }) => {
      if (!user) return { error: 'Not signed in' };
      const { error } = await supabase
        .from('expenses')
        .update({ ...patch, review_status: 'confirmed' })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) return { error: error.message };
      setPending((list) => list.filter((p) => p.id !== id));
      return { error: null };
    },
    [user],
  );

  /**
   * Dismiss rather than delete. A dismissed row keeps its external_id, so
   * the unique index stops the next sync re-importing what the user already
   * rejected — deleting it would let it come straight back.
   */
  const dismiss = useCallback(
    async (id: string) => {
      if (!user) return { error: 'Not signed in' };
      const { error } = await supabase
        .from('expenses')
        .update({ review_status: 'dismissed' })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) return { error: error.message };
      setPending((list) => list.filter((p) => p.id !== id));
      return { error: null };
    },
    [user],
  );

  return { pending, loading, refresh: load, confirm, dismiss };
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface KidLedgerRow {
  id: string;
  member_id: string;
  user_id: string;
  amount_cents: number;
  source_type: 'chore' | 'lesson' | 'allowance' | 'adjustment';
  source_id: string | null;
  status: 'owed' | 'paid' | 'void';
  split: { save: number; spend: number; give: number } | null;
  notes: string | null;
  earned_at: string;
  paid_at: string | null;
}

interface SingleKidState {
  owed_cents: number;
  paid_cents: number;
  rows: KidLedgerRow[];
  loading: boolean;
  error: string | null;
}

/**
 * One member's IOU ledger. Works for both roles:
 *   - Child calling on their own member_id: RLS policy "child reads own ledger".
 *   - Parent calling on any of their kids: RLS policy "parent manages own ledger".
 * If the caller is neither, the query returns [] (no RLS error).
 */
export function useKidLedger(memberId: string | null) {
  const [state, setState] = useState<SingleKidState>({
    owed_cents: 0,
    paid_cents: 0,
    rows: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!memberId) {
      setState({ owed_cents: 0, paid_cents: 0, rows: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const { data, error } = await supabase
      .from('kid_ledger')
      .select('*')
      .eq('member_id', memberId)
      .order('earned_at', { ascending: false });
    if (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }));
      return;
    }
    const rows = (data as KidLedgerRow[]) ?? [];
    const owed = rows.filter((r) => r.status === 'owed').reduce((sum, r) => sum + r.amount_cents, 0);
    const paid = rows.filter((r) => r.status === 'paid').reduce((sum, r) => sum + r.amount_cents, 0);
    setState({ owed_cents: owed, paid_cents: paid, rows, loading: false, error: null });
  }, [memberId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

export interface AllKidsLedgerEntry {
  owed_cents: number;
  paid_cents: number;
}

interface AllKidsState {
  perKid: Record<string, AllKidsLedgerEntry>;
  loading: boolean;
  error: string | null;
}

/**
 * Aggregates ledger totals across every kid_ledger row the parent can see
 * (RLS already scopes to user_id = auth.uid()). Returns a map keyed by
 * member_id so JuniorDashboardPage can read each kid's total in O(1).
 */
export function useAllKidsLedger() {
  const [state, setState] = useState<AllKidsState>({
    perKid: {},
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const { data, error } = await supabase
      .from('kid_ledger')
      .select('member_id, amount_cents, status');
    if (error) {
      setState({ perKid: {}, loading: false, error: error.message });
      return;
    }
    const perKid: Record<string, AllKidsLedgerEntry> = {};
    for (const row of (data ?? []) as { member_id: string; amount_cents: number; status: string }[]) {
      const entry = perKid[row.member_id] ?? { owed_cents: 0, paid_cents: 0 };
      if (row.status === 'owed') entry.owed_cents += row.amount_cents;
      if (row.status === 'paid') entry.paid_cents += row.amount_cents;
      perKid[row.member_id] = entry;
    }
    setState({ perKid, loading: false, error: null });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

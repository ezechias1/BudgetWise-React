import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';

export interface FamilyIncomeMember {
  user_id: string;
  display_name: string;
  income: number;
  is_self: boolean;
  /**
   * False when this member's `user_settings` row came back empty — almost
   * always RLS hiding another user's row rather than a missing record.
   * Their income is excluded from `combined` rather than counted as zero.
   */
  visible: boolean;
}

export interface FamilyIncomeState {
  members: FamilyIncomeMember[];
  /** Sum of `fam_income` across members we can actually read. */
  combined: number;
  /**
   * True when at least one approved member's income is hidden, so `combined`
   * is an undercount. Callers must not present it as the household total.
   */
  partial: boolean;
  /** True once more than one approved member exists — i.e. worth a breakdown. */
  hasPartners: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const EMPTY: Omit<FamilyIncomeState, 'refresh'> = {
  members: [],
  combined: 0,
  partial: false,
  hasPartners: false,
  loading: false,
};

/**
 * Household income for Family mode, broken down per linked member.
 *
 * Supersedes the inline sum in SpendingTrackerPage (which only ran for the
 * group *owner*, and did `select('fam_income')` without `user_id` — so the
 * per-person split was thrown away and a joined spouse never saw a combined
 * figure at all).
 *
 * Income is not a table: `user_settings` carries three scalar columns
 * (`income` / `biz_income` / `fam_income`), one per mode. Family mode reads
 * `fam_income`, so each partner's own row is their contribution to the
 * household total.
 *
 * Per the product decision, incomes are ALWAYS separate — a couple sharing
 * one joint income splits it between their two accounts. There is no
 * joint-income mode, so nothing here tries to detect one.
 *
 * Reads go through the `get_family_income` RPC, NOT a direct select on
 * `user_settings`. Verified against production: that table's only SELECT
 * policy is `user_id = auth.uid()`, so a direct query returns just the
 * caller's own row — which is why the combined total never worked before.
 *
 * An RLS policy would have been the wrong fix: Postgres RLS is row-level,
 * so opening `user_settings` to a partner would also expose `is_pro`,
 * `has_paid`, `paypal_subscription_id` and the rest of the row. The RPC
 * (see migrations/20260812000000_family_income_rpc.sql) returns only
 * user_id + display_name + fam_income.
 *
 * Until that migration is applied the RPC won't exist, so a missing
 * function degrades to self-only with `partial` true — an honest
 * "incomplete" state rather than a wrong household total.
 */
export function useFamilyIncome(): FamilyIncomeState {
  const { user } = useAuth();
  const { mode } = useMode();

  const [state, setState] = useState<Omit<FamilyIncomeState, 'refresh'>>(EMPTY);

  const load = useCallback(async () => {
    if (!user || mode !== 'family') {
      setState(EMPTY);
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    // Find the group this user belongs to — owned or joined, both live in
    // family_links (the owner is auto-linked with role 'owner' on create).
    const { data: myLinks } = await supabase
      .from('family_links')
      .select('group_id')
      .eq('user_id', user.id)
      .eq('approved', true)
      .limit(1);

    const groupId = myLinks?.[0]?.group_id as string | undefined;

    // No group yet — a one-person "family". Fall back to just this user so
    // the card still renders a real number instead of blanking out.
    if (!groupId) {
      const { data: own } = await supabase
        .from('user_settings')
        .select('fam_income')
        .eq('user_id', user.id)
        .maybeSingle();
      const income = Number(own?.fam_income ?? 0);
      setState({
        members: [
          { user_id: user.id, display_name: 'You', income, is_self: true, visible: true },
        ],
        combined: income,
        partial: false,
        hasPartners: false,
        loading: false,
      });
      return;
    }

    // One call returns every approved member's name + income. Doing this
    // as an RPC also avoids needing to read other members' family_links
    // rows from the client, which their own RLS may well block.
    const { data: rpcRows, error: rpcError } = await supabase.rpc(
      'get_family_income',
      { p_group_id: groupId },
    );

    if (rpcError || !rpcRows) {
      // Migration not applied yet (or the call was rejected). Fall back to
      // this user alone and mark the total partial — never present a
      // one-person figure as the household total.
      const { data: own } = await supabase
        .from('user_settings')
        .select('fam_income')
        .eq('user_id', user.id)
        .maybeSingle();
      const income = Number(own?.fam_income ?? 0);
      setState({
        members: [
          { user_id: user.id, display_name: 'You', income, is_self: true, visible: true },
        ],
        combined: income,
        partial: true,
        hasPartners: false,
        loading: false,
      });
      return;
    }

    const members: FamilyIncomeMember[] = (
      rpcRows as {
        user_id: string;
        display_name: string | null;
        fam_income: number | null;
      }[]
    ).map((r) => {
      const isSelf = r.user_id === user.id;
      return {
        user_id: r.user_id,
        display_name: isSelf ? 'You' : r.display_name || 'Partner',
        income: Number(r.fam_income ?? 0),
        is_self: isSelf,
        visible: true,
      };
    });

    if (members.length === 0) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    // Self first, then the rest as returned — keeps the list stable.
    members.sort((a, b) => Number(b.is_self) - Number(a.is_self));

    setState({
      members,
      combined: members.reduce((sum, m) => sum + (m.visible ? m.income : 0), 0),
      partial: members.some((m) => !m.visible),
      hasPartners: members.length > 1,
      loading: false,
    });
  }, [user, mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { ...state, refresh: load };
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';

export interface LinkedAccount {
  id: string;
  user_id: string;
  plaid_access_token?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  account_type?: string | null;
  account_subtype?: string | null;
  institution_name?: string | null;
  mask?: string | null;
  balance_current?: number | null;
  balance_available?: number | null;
  currency_code?: string | null;
  last_synced?: string | null;
  account_mode?: string | null;
  is_primary?: boolean | null;
  created_at?: string | null;
  /** True for a company-issued card — its transactions always need a
   *  Business/Personal review decision, even inside a trip window. */
  is_business_card?: boolean | null;
  provider?: 'manual' | 'stitch' | null;
}

/** Shared account with same bank across multiple modes. */
export interface CrossModeAccount {
  institution_name: string;
  mask: string;
  modes: string[];
}

/**
 * Shared hook for linked bank accounts. Used by BankPage and OverviewPage.
 *
 * Fetches accounts for the current mode, exposes setPrimary, and detects
 * cross-mode accounts (same institution+mask in multiple modes).
 */
export function useLinkedAccounts() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [allAccounts, setAllAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // Narrowed fallback (AUDIT Imp #15): only fall back to all-modes fetch
    // if the error indicates a missing column (Postgres code 42703). Any
    // other error (RLS denial, transient 500) should NOT merge all modes.
    const { data, error } = await supabase
      .from('linked_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('account_mode', mode)
      .order('created_at', { ascending: false });
    if (error) {
      if ((error as { code?: string }).code === '42703') {
        const { data: fallback } = await supabase
          .from('linked_accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        setAccounts((fallback ?? []) as LinkedAccount[]);
      } else {
        setAccounts([]);
      }
    } else {
      setAccounts((data ?? []) as LinkedAccount[]);
    }

    // Fetch ALL accounts across modes for cross-mode detection
    const { data: all } = await supabase
      .from('linked_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setAllAccounts((all ?? []) as LinkedAccount[]);

    setLoading(false);
  }, [user, mode]);

  // Cancelled-flag effect (AUDIT Imp #10).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('linked_accounts')
        .select('*')
        .eq('user_id', user.id)
        .eq('account_mode', mode)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        if ((error as { code?: string }).code === '42703') {
          const { data: fallback } = await supabase
            .from('linked_accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          if (cancelled) return;
          setAccounts((fallback ?? []) as LinkedAccount[]);
        } else {
          setAccounts([]);
        }
      } else {
        setAccounts((data ?? []) as LinkedAccount[]);
      }
      const { data: all } = await supabase
        .from('linked_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setAllAccounts((all ?? []) as LinkedAccount[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, mode]);

  const primaryAccount = accounts.find((a) => a.is_primary) || null;

  const setPrimary = useCallback(
    async (accountId: string) => {
      if (!user) return;
      // Clear primary on all accounts in this mode
      const modeIds = accounts.map((a) => a.id);
      if (modeIds.length > 0) {
        await supabase
          .from('linked_accounts')
          .update({ is_primary: false })
          .in('id', modeIds)
          .eq('user_id', user.id);
      }
      // Set the new primary
      await supabase
        .from('linked_accounts')
        .update({ is_primary: true })
        .eq('id', accountId)
        .eq('user_id', user.id);
      await load();
    },
    [user, accounts, load],
  );

  const updateBalance = useCallback(
    async (accountId: string, newBalance: number) => {
      if (!user) return;
      await supabase
        .from('linked_accounts')
        .update({
          balance_current: newBalance,
          balance_available: newBalance,
          last_synced: new Date().toISOString(),
        })
        .eq('id', accountId)
        .eq('user_id', user.id);
      await load();
    },
    [user, load],
  );

  // Marks/unmarks an account as the company-issued card — transactions
  // synced from it always route through the Business/Personal review flow.
  const toggleBusinessCard = useCallback(
    async (accountId: string, value: boolean): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const { error } = await supabase
        .from('linked_accounts')
        .update({ is_business_card: value })
        .eq('id', accountId)
        .eq('user_id', user.id);
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [user, load],
  );

  // Detect cross-mode accounts: same institution_name + mask in multiple modes
  const crossModeAccounts: CrossModeAccount[] = (() => {
    const map = new Map<string, Set<string>>();
    for (const acc of allAccounts) {
      if (!acc.institution_name || !acc.mask || !acc.account_mode) continue;
      const key = `${acc.institution_name}|${acc.mask}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(acc.account_mode);
    }
    const result: CrossModeAccount[] = [];
    map.forEach((modes, key) => {
      if (modes.size > 1) {
        const [inst, mask] = key.split('|');
        result.push({
          institution_name: inst,
          mask,
          modes: Array.from(modes),
        });
      }
    });
    return result;
  })();

  const totalBalance = accounts.reduce(
    (sum, a) => sum + (a.balance_current ?? 0),
    0,
  );

  return {
    accounts,
    allAccounts,
    loading,
    primaryAccount,
    totalBalance,
    crossModeAccounts,
    setPrimary,
    updateBalance,
    toggleBusinessCard,
    refresh: load,
  };
}

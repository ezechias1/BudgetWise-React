import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ok, reportWriteFailure } from '@/lib/db';
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
   *  Business/Personal review decision, even inside a trip window. Live
   *  column is `is_business` (not `is_business_card` — don't rename back). */
  is_business?: boolean | null;
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

  // Both writes below used to discard their error. The dangerous case is a
  // half-applied switch: the clear succeeds, the set fails, and the user is
  // left with NO main account at all — silently, since the UI just
  // reloaded. Now the clear bails out before touching anything else, and a
  // failed set puts the previous main back.
  const setPrimary = useCallback(
    async (accountId: string): Promise<boolean> => {
      if (!user) return false;
      // Remember the current main so we can restore it if the second write
      // fails after the first one has already cleared it.
      const previousPrimaryId = accounts.find((a) => a.is_primary)?.id ?? null;
      // Clear primary on all accounts in this mode
      const modeIds = accounts.map((a) => a.id);
      if (modeIds.length > 0) {
        const cleared = await ok(
          supabase
            .from('linked_accounts')
            .update({ is_primary: false })
            .in('id', modeIds)
            .eq('user_id', user.id),
          'change your main account',
        );
        // Nothing has changed yet, so stopping here leaves the old main in
        // place — the safe outcome.
        if (!cleared) return false;
      }
      // Set the new primary
      const { error } = await supabase
        .from('linked_accounts')
        .update({ is_primary: true })
        .eq('id', accountId)
        .eq('user_id', user.id);
      if (error) {
        // The clear above already went through, so right now no account is
        // main. Put the old one back rather than leaving the user with none.
        let restored = false;
        if (previousPrimaryId) {
          const { error: restoreError } = await supabase
            .from('linked_accounts')
            .update({ is_primary: true })
            .eq('id', previousPrimaryId)
            .eq('user_id', user.id);
          restored = !restoreError;
        }
        reportWriteFailure(
          'change your main account',
          previousPrimaryId && !restored
            ? `${error.message}. No account is set as main right now — please pick one again.`
            : error.message,
        );
        await load();
        return false;
      }
      await load();
      return true;
    },
    [user, accounts, load],
  );

  const updateBalance = useCallback(
    async (accountId: string, newBalance: number): Promise<boolean> => {
      if (!user) return false;
      // Silently failed before: a rejected update still called load(), so
      // the card redrew with the old balance as if the new one had saved.
      const updated = await ok(
        supabase
          .from('linked_accounts')
          .update({
            balance_current: newBalance,
            balance_available: newBalance,
            last_synced: new Date().toISOString(),
          })
          .eq('id', accountId)
          .eq('user_id', user.id),
        'update this balance',
      );
      if (!updated) return false;
      await load();
      return true;
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
        .update({ is_business: value })
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

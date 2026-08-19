import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';

interface UserSettingsRow {
  user_id: string;
  currency: string | null;
  avatar_url: string | null;
  is_pro: boolean | null;
  company_name: string | null;
  family_name: string | null;
  // Personal
  income: number | null;
  savings_goal: number | null;
  // Business
  biz_income: number | null;
  biz_savings_goal: number | null;
  // Family
  fam_income: number | null;
  fam_savings_goal: number | null;
}

interface UpdateInput {
  currency?: string;
  income?: number;
  savings_goal?: number;
}

/**
 * Reads (and mutates) the current user's settings row.
 *
 * The vanilla app stores income + savings_goal as three separate column pairs
 * on `user_settings` — one per mode (personal/business/family). This hook
 * reads all three pairs and returns the one that matches the current mode,
 * so switching modes shows the correct income + savings target.
 *
 * Mirrors the vanilla mapping in js/app.js:607-614, 1701-1708, and the
 * transfer-money logic at 2553-2602.
 */

// ---------------------------------------------------------------------------
// Shared fetch layer.
//
// 24 files call useUserSettings(), and every instance used to run its own
// identical query — a single page could fire five or six copies, which is a
// large part of why pages took seconds to settle. This module-level store
// gives all callers one in-flight request and one cached row, and pushes
// updates to every mounted hook so they stay in sync.
// ---------------------------------------------------------------------------

const SETTINGS_COLUMNS =
  'user_id, currency, avatar_url, is_pro, company_name, family_name, income, savings_goal, biz_income, biz_savings_goal, fam_income, fam_savings_goal';

let cachedUserId: string | null = null;
let cachedRow: UserSettingsRow | null = null;
/** Distinct from `cachedRow !== null`: a user with no settings row caches a
 *  legitimate null, and without this we would refetch forever. */
let cacheLoaded = false;
let inflight: Promise<UserSettingsRow | null> | null = null;

const subscribers = new Set<(row: UserSettingsRow | null) => void>();

async function fetchSettings(
  userId: string,
  force = false,
): Promise<UserSettingsRow | null> {
  if (cachedUserId !== userId) {
    // Different user (account switch) — drop everything.
    cachedUserId = userId;
    cachedRow = null;
    cacheLoaded = false;
    inflight = null;
  }
  if (!force && cacheLoaded) return cachedRow;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const { data, error } = await supabase
      .from('user_settings')
      .select(SETTINGS_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      // A failed read must NOT be cached as "this user has no settings row".
      // That sticky null made the whole app read income/goal/currency as
      // empty for the session, and a later "Save Changes" then wrote those
      // zeros over the real values. Leave the cache unloaded so the next
      // caller retries, and return whatever we last knew.
      console.error('[user_settings read failed]', error.message);
      inflight = null;
      return cachedRow;
    }
    if (!data) {
      // Zero rows with no error is also what an RLS-filtered read returns
      // (no session attached yet at boot, expired JWT, signed-out race) —
      // byte-for-byte identical to a genuinely missing row. Only cache the
      // "no row" answer when a session is actually present.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        inflight = null;
        return cachedRow;
      }
    }
    cachedRow = (data as UserSettingsRow | null) ?? null;
    cacheLoaded = true;
    inflight = null;
    subscribers.forEach((fn) => fn(cachedRow));
    return cachedRow;
  })();
  return inflight;
}

export function useUserSettings() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [row, setRow] = useState<UserSettingsRow | null>(() =>
    cachedUserId === user?.id && cacheLoaded ? cachedRow : null,
  );
  const [loading, setLoading] = useState(
    () => !(cachedUserId === user?.id && cacheLoaded),
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const next = await fetchSettings(user.id, true);
    setRow(next);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const notify = (next: UserSettingsRow | null) => {
      if (!cancelled) setRow(next);
    };
    subscribers.add(notify);
    fetchSettings(user.id).then((next) => {
      if (cancelled) return;
      setRow(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      subscribers.delete(notify);
    };
  }, [user]);

  // Pick the right pair of columns for the current mode.
  const income =
    mode === 'business'
      ? row?.biz_income ?? 0
      : mode === 'family'
        ? row?.fam_income ?? 0
        : row?.income ?? 0;

  const savingsGoal =
    mode === 'business'
      ? row?.biz_savings_goal ?? 0
      : mode === 'family'
        ? row?.fam_savings_goal ?? 0
        : row?.savings_goal ?? 0;

  const updateSettings = useCallback(
    async (input: UpdateInput): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };

      // Map logical keys to the mode-specific physical columns.
      const patch: Record<string, unknown> = { user_id: user.id };
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.income !== undefined) {
        if (mode === 'business') patch.biz_income = input.income;
        else if (mode === 'family') patch.fam_income = input.income;
        else patch.income = input.income;
      }
      if (input.savings_goal !== undefined) {
        if (mode === 'business') patch.biz_savings_goal = input.savings_goal;
        else if (mode === 'family') patch.fam_savings_goal = input.savings_goal;
        else patch.savings_goal = input.savings_goal;
      }

      // AUDIT Imp — explicit onConflict so upsert merges on user_id instead
      // of creating a duplicate row when patch omits id.
      const { error } = await supabase
        .from('user_settings')
        .upsert(patch, { onConflict: 'user_id' });
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [user, mode, load],
  );

  return {
    loading,
    currency: row?.currency ?? 'ZAR',
    avatarUrl: row?.avatar_url ?? null,
    isProFromSettings: row?.is_pro ?? false,
    companyName: row?.company_name ?? null,
    familyName: row?.family_name ?? null,
    income,
    savingsGoal,
    updateSettings,
    refresh: load,
  };
}

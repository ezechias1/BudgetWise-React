import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { getCategoriesForMode, type CategoryOption } from '@/lib/categories';
import type { Mode } from '@/types';

/**
 * The categories a picker should offer: the built-in list for the current
 * mode, plus whatever the user added under Expenses → Categories.
 *
 * Before this hook, `custom_categories` was written and read by exactly one
 * modal and nothing else — you could create a category and then never select
 * it, which made the whole feature a dead end. Every category dropdown should
 * use this rather than calling getCategoriesForMode directly.
 *
 * Shares one request across every instance, the same way useUserSettings
 * does. Three of these can be mounted at once on the Expenses page
 * (the page, the add/edit modal, the review inbox) and without the cache
 * each fired its own query and its own auth-lock acquisition, which showed up
 * as a run of "lock was not released within 5000ms" warnings.
 */

let cachedKey: string | null = null;
let cachedRows: CategoryOption[] = [];
let cacheLoaded = false;
let inflight: Promise<CategoryOption[]> | null = null;

const subscribers = new Set<(rows: CategoryOption[]) => void>();

function keyFor(userId: string, mode: Mode) {
  return `${userId}:${mode}`;
}

async function fetchCustom(
  userId: string,
  mode: Mode,
  force = false,
): Promise<CategoryOption[]> {
  const key = keyFor(userId, mode);
  if (cachedKey !== key) {
    // Different user or mode — the previous list doesn't apply.
    cachedKey = key;
    cachedRows = [];
    cacheLoaded = false;
    inflight = null;
  }
  if (!force && cacheLoaded) return cachedRows;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const { data, error } = await supabase
      .from('custom_categories')
      .select('name')
      .eq('user_id', userId)
      .eq('account_mode', mode)
      .order('name');
    // A failure here means the built-in list only. Losing a custom category
    // from the dropdown is survivable; blocking the form over it is not.
    cachedRows =
      error || !data
        ? []
        : (data as { name: string }[]).map((r) => ({ value: r.name, label: r.name }));
    cacheLoaded = true;
    inflight = null;
    subscribers.forEach((fn) => fn(cachedRows));
    return cachedRows;
  })();
  return inflight;
}

export function useCategories() {
  const { user } = useAuth();
  const { mode } = useMode();

  const [custom, setCustom] = useState<CategoryOption[]>(() =>
    user && cachedKey === keyFor(user.id, mode) && cacheLoaded ? cachedRows : [],
  );

  useEffect(() => {
    if (!user) {
      setCustom([]);
      return;
    }
    let cancelled = false;
    const notify = (rows: CategoryOption[]) => {
      if (!cancelled) setCustom(rows);
    };
    subscribers.add(notify);
    void fetchCustom(user.id, mode).then((rows) => {
      if (!cancelled) setCustom(rows);
    });
    return () => {
      cancelled = true;
      subscribers.delete(notify);
    };
  }, [user, mode]);

  /** Re-reads after the Manage Categories modal has added or removed one. */
  const refreshCategories = useCallback(async () => {
    if (!user) return;
    await fetchCustom(user.id, mode, true);
  }, [user, mode]);

  const categories = useMemo(() => {
    const base = getCategoriesForMode(mode);
    const seen = new Set(base.map((c) => c.value));
    const extra = custom.filter((c) => !seen.has(c.value));
    if (extra.length === 0) return base;
    // Slot them in before "Other" so the catch-all stays last in the list.
    const otherIdx = base.findIndex((c) => c.value === 'Other');
    if (otherIdx === -1) return [...base, ...extra];
    return [...base.slice(0, otherIdx), ...extra, ...base.slice(otherIdx)];
  }, [mode, custom]);

  return { categories, refreshCategories };
}

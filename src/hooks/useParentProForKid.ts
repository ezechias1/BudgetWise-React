import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ENABLE_PRO_SYSTEM } from '@/lib/access';

/**
 * Reads the parent's user_settings.is_pro for a kid session.
 *
 * A Junior kid is signed in as their own Supabase user but doesn't have a
 * user_settings row — the Pro flag lives on the parent's settings. The kid
 * needs to know it to decide whether a freemium gate (e.g. 5 completed
 * missions) should trip.
 *
 * TODO(rls): user_settings currently has RLS `user_id = auth.uid()`, which
 * will block a kid from reading the parent's row. For Phase 4 we fail open:
 * if the query returns null (either RLS blocking, or no row yet) treat the
 * user as Pro. That's safe while ENABLE_PRO_SYSTEM is false; when the flag
 * flips we'll need a kid-scoped RLS policy (or an edge function that
 * returns just `is_pro`).
 */
export function useParentProForKid(parentUserId: string | null | undefined) {
  const [isPro, setIsPro] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ENABLE_PRO_SYSTEM) {
      setIsPro(true);
      setLoading(false);
      return;
    }
    if (!parentUserId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('is_pro')
        .eq('user_id', parentUserId)
        .maybeSingle();
      if (cancelled) return;
      // Fail open: if we couldn't read the row (likely RLS), treat as Pro.
      if (data == null) setIsPro(true);
      else setIsPro(data.is_pro === true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [parentUserId]);

  return { isPro, loading };
}

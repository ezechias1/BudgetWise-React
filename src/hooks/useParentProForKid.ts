import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ENABLE_PRO_SYSTEM } from '@/lib/access';

/**
 * Reads the parent's user_settings.is_pro for a kid session.
 *
 * A Junior kid is signed in as their own Supabase user and user_settings
 * RLS blocks them from reading the parent's row directly. Previously we
 * failed open (treated unreadable as Pro), which was safe while
 * ENABLE_PRO_SYSTEM=false but broken the moment Pro gates mattered.
 *
 * AUDIT Imp #4: now calls the kid-pro-status edge function, which uses
 * the service role to look up the caller's linked parent and return the
 * parent's is_pro flag. On error we fail CLOSED (isPro=false) so a
 * misconfig can never grant Pro implicitly.
 */
export function useParentProForKid(_parentUserId: string | null | undefined) {
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ENABLE_PRO_SYSTEM) {
      // Dev short-circuit — every gate is off when the whole system is off.
      setIsPro(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) {
            setIsPro(false);
            setLoading(false);
          }
          return;
        }
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kid-pro-status`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: '{}',
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          // Fail closed — audit Imp #4 requirement.
          setIsPro(false);
          setLoading(false);
          return;
        }
        const body = await res.json();
        setIsPro(body.is_pro === true);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setIsPro(false);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { isPro, loading };
}

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchKidMemberForUser, type KidMemberRow } from '@/lib/access';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Reads the current user's family_members row where auth_user_id = auth.uid().
 * If a row exists, the user is a kid. Otherwise they're a parent (or no role
 * yet).
 *
 * loading: true while we fetch. When loading is true, callers must render a
 * spinner — don't assume parent-ness during load.
 */
export function useKidProfile() {
  const { user, loading: authLoading } = useAuth();
  const [member, setMember] = useState<KidMemberRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMember(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchKidMemberForUser(supabase, user.id)
      .then((row) => {
        if (!cancelled) {
          setMember(row);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return {
    member,
    isChild: !!member,
    loading: authLoading || loading,
    error,
  };
}

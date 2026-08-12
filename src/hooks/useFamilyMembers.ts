import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';

export interface FamilyMemberInfo {
  user_id: string;
  display_name: string;
  color: string;
}

/** Used when a member has no colour yet, or for rows we can't resolve. */
export const FALLBACK_MEMBER_COLOR = '#94a3b8';

/** Same palette the migration used to backfill existing rows. */
export const MEMBER_COLORS = [
  '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
];

/**
 * Pick a colour for a new family_links row.
 *
 * Every insert site must call this. The migration backfilled colours for
 * rows that already existed, but nothing assigned one to *new* members —
 * so without this every member renders in FALLBACK_MEMBER_COLOR and the
 * per-person colour coding silently does nothing.
 *
 * Prefers a colour nobody in the group is using; falls back to cycling the
 * palette once a group is larger than it.
 */
export function pickMemberColor(taken: (string | null | undefined)[]): string {
  const used = new Set(taken.filter(Boolean) as string[]);
  return (
    MEMBER_COLORS.find((c) => !used.has(c)) ??
    MEMBER_COLORS[used.size % MEMBER_COLORS.length]
  );
}

/**
 * The family group the signed-in user belongs to, if any.
 *
 * Kept separate from the roster because `useExpenses` needs only the id (to
 * stamp `group_id` on new Family-mode rows) and is mounted on nearly every
 * page — making it pull the full roster on every mount would be wasteful.
 */
export function useFamilyGroupId(): string | null {
  const { user } = useAuth();
  const { mode } = useMode();
  const [groupId, setGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || mode !== 'family') {
      setGroupId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('family_links')
        .select('group_id')
        .eq('user_id', user.id)
        .eq('approved', true)
        .limit(1);
      if (!cancelled) setGroupId((data?.[0]?.group_id as string) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, mode]);

  return groupId;
}

/**
 * Roster for the shared family ledger — who is in the group, and what colour
 * represents them.
 *
 * Goes through the `get_family_members` RPC rather than selecting
 * `family_links` directly: we can't assume a member's own RLS lets them read
 * other members' rows, which is the same reason `get_family_income` exists.
 */
export function useFamilyMembers() {
  const { user } = useAuth();
  const { mode } = useMode();
  const groupId = useFamilyGroupId();

  const [members, setMembers] = useState<Record<string, FamilyMemberInfo>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || mode !== 'family' || !groupId) {
      setMembers({});
      return;
    }
    setLoading(true);
    const { data } = await supabase.rpc('get_family_members', {
      p_group_id: groupId,
    });
    const byId: Record<string, FamilyMemberInfo> = {};
    for (const r of (data ?? []) as {
      user_id: string;
      display_name: string | null;
      color: string | null;
    }[]) {
      byId[r.user_id] = {
        user_id: r.user_id,
        display_name:
          r.user_id === user.id ? 'You' : r.display_name || 'Partner',
        color: r.color || FALLBACK_MEMBER_COLOR,
      };
    }
    setMembers(byId);
    setLoading(false);
  }, [user, mode, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { members, groupId, loading, refresh: load };
}

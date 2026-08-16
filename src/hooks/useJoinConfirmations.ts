import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type JoinKind = 'family' | 'stokvel';

export interface JoinConfirmation {
  /** Stable key for acknowledgement — `${kind}:${groupId}`. */
  key: string;
  kind: JoinKind;
  name: string;
}

const ACK_KEY = 'bw-acked-joins';

function readAcked(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ACK_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeAcked(keys: string[]) {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(keys));
  } catch {
    // Private browsing — the banner reappears next load. Repetitive, not wrong.
  }
}

/**
 * "You're in" confirmations for join-by-code.
 *
 * Joining is asynchronous: you request, then an owner approves, possibly
 * hours later and while your app is closed. Nothing told you when it
 * happened — you had to notice the app had changed.
 *
 * Derived from state rather than a queued notification, deliberately. The
 * push pipeline (notification_queue -> cron -> VAPID) only reaches people who
 * have already granted notification permission, which someone who signed up
 * ten minutes ago almost never has — so the one moment worth announcing is
 * the one push would miss. An approved membership row IS the event, so
 * reading it needs no schema, no permission and no edge function, and it
 * still works if the approval happened while the app was closed.
 *
 * Covers Family and Business the same way: business "Partners" share the
 * family_groups/family_links tables (App.tsx routes both to
 * SpendingTrackerPage), so one query serves both. Stokvel keeps its own.
 */

/**
 * Pull a field off a PostgREST embedded relation.
 *
 * The embed comes back as an array or a single object depending on how
 * PostgREST infers the relationship's cardinality, and getting it wrong
 * fails soft — you'd show the fallback name and never know the real one
 * was right there. Handle both rather than bet on one.
 */
function embedded(rel: unknown, field: string): string | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (row && typeof row === 'object') {
    const value = (row as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

export function useJoinConfirmations() {
  const { user } = useAuth();
  const [items, setItems] = useState<JoinConfirmation[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const acked = new Set(readAcked());

      const [famRes, stokRes] = await Promise.all([
        supabase
          .from('family_links')
          .select('group_id, approved, family_groups(family_name)')
          .eq('user_id', user.id)
          .eq('approved', true)
          // Owners are auto-linked into their own group, so without this
          // they'd be told they joined something they created.
          .neq('role', 'owner'),
        supabase
          .from('stokvel_members')
          .select('stokvel_id, approved, stokvel_groups(name)')
          .eq('user_id', user.id)
          .eq('approved', true)
          .neq('role', 'owner'),
      ]);
      if (cancelled) return;

      const found: JoinConfirmation[] = [];

      for (const r of (famRes.data ?? []) as Record<string, unknown>[]) {
        const key = `family:${String(r.group_id)}`;
        if (acked.has(key)) continue;
        found.push({
          key,
          kind: 'family',
          name: embedded(r.family_groups, 'family_name') ?? 'your family',
        });
      }

      for (const r of (stokRes.data ?? []) as Record<string, unknown>[]) {
        const key = `stokvel:${String(r.stokvel_id)}`;
        if (acked.has(key)) continue;
        found.push({
          key,
          kind: 'stokvel',
          name: embedded(r.stokvel_groups, 'name') ?? 'your stokvel',
        });
      }

      setItems(found);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Called once the confirmation has been shown, so it doesn't return. */
  const acknowledge = useCallback((key: string) => {
    const next = Array.from(new Set([...readAcked(), key]));
    writeAcked(next);
    setItems((list) => list.filter((i) => i.key !== key));
  }, []);

  return { items, acknowledge };
}

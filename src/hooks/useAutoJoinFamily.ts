import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { pickMemberColor } from '@/hooks/useFamilyMembers';
import { readStashedInvite, clearStashedInvite } from '@/lib/family-invite';

export interface AutoJoinResult {
  kind: 'joined' | 'already' | 'failed';
  message: string;
}

/** family_links.display_name is NOT NULL, so this must always return something. */
function displayNameFor(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const full = user.user_metadata?.full_name;
  if (typeof full === 'string' && full.trim()) return full.trim();
  if (user.email) return user.email.split('@')[0];
  return 'Member';
}

/**
 * Completes a family invite the moment the invitee reaches the dashboard.
 *
 * They tapped a link, signed up, and confirmed their email. Without this they
 * would then have to know to switch to Family mode, find Spending Tracker,
 * and type a code they were never shown — three steps of the app's filing
 * system, to finish something they already agreed to.
 *
 * Deliberately fires once: the stash is cleared before the network call, so a
 * failure surfaces as a message with the code still visible rather than a
 * silent retry loop on every dashboard mount.
 *
 * The row is inserted with approved = false. The owner still approves, which
 * is enforced by the database, not by this code — see the family_links write
 * guard migration.
 */
export function useAutoJoinFamily(): AutoJoinResult | null {
  const { user } = useAuth();
  const { setMode } = useMode();
  const [result, setResult] = useState<AutoJoinResult | null>(null);

  useEffect(() => {
    if (!user) return;
    const code = readStashedInvite();
    if (!code) return;

    // `cancelled` gates state updates only. It must never gate the join
    // itself: the previous version cleared the stash up front and bailed on
    // `cancelled` before the insert, so any re-run of this effect mid-flight
    // lost the invite for good — the first pass had already thrown the code
    // away, the second found nothing to do, and the invitee silently never
    // joined. React StrictMode reproduces that on every mount in development;
    // in production a token refresh changing the `user` identity does the
    // same thing, less often and far harder to spot.
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.rpc('find_family_group_by_code', {
        p_code: code,
      });
      const group = (data as { id: string; family_name: string }[] | null)?.[0];

      if (error || !group) {
        // A bad code is definitive — drop it so this doesn't retry forever.
        clearStashedInvite();
        if (cancelled) return;
        setResult({
          kind: 'failed',
          message: `That invite link didn't work (code ${code}). Ask for a new one, or enter the code on the Spending Tracker page.`,
        });
        return;
      }

      const existing = await supabase
        .from('family_links')
        .select('id, approved')
        .eq('user_id', user.id)
        .eq('group_id', group.id)
        .maybeSingle();

      if (existing.data) {
        clearStashedInvite();
        if (cancelled) return;
        setMode('family');
        setResult({
          kind: 'already',
          message: existing.data.approved
            ? `You're already part of ${group.family_name}.`
            : `You've already asked to join ${group.family_name} — waiting for them to approve you.`,
        });
        return;
      }

      const { error: joinErr } = await supabase.from('family_links').insert({
        group_id: group.id,
        user_id: user.id,
        display_name: displayNameFor(user),
        // Picked blind — RLS stops a joiner reading the group's other rows,
        // so a colour clash is possible and harmless; the owner's next load
        // reassigns from the full set.
        color: pickMemberColor([]),
        role: 'member',
        approved: false,
      });

      // 23505 on the (group_id, user_id) unique index means a concurrent run
      // of this same effect already inserted the row. That's the join having
      // succeeded, not failed — telling the invitee it went wrong would be
      // both alarming and untrue.
      if (joinErr && joinErr.code !== '23505') {
        // Leave the stash in place: a transient failure here should get
        // another go on the next dashboard mount rather than stranding them.
        if (cancelled) return;
        setResult({
          kind: 'failed',
          message: `Could not join ${group.family_name}: ${joinErr.message}`,
        });
        return;
      }

      // Joined for real — now the code has done its job.
      clearStashedInvite();
      if (cancelled) return;
      setMode('family');
      setResult({
        kind: 'joined',
        message: `You've asked to join ${group.family_name}. You'll see the shared budget as soon as they approve you.`,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, setMode]);

  return result;
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { ok, reportWriteFailure } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { JuniorUpgradeModal } from '@/components/JuniorUpgradeModal';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { checkJuniorGate, isProUser } from '@/lib/access';

/**
 * Ports #page-chores from dashboard.html (line 1795) and
 * `renderChores()` in js/app.js (line 1538).
 *
 * CRUD on `family_chores`. Completing a chore credits the assignee's
 * earned + allowance totals. Parent approval flow is TODO.
 */

interface FamilyMember {
  id: string;
  name: string;
  color: string;
  allowance: number;
  earned: number;
  role?: string;
  auth_user_id?: string | null;
}

interface Chore {
  id: string;
  user_id: string;
  name: string;
  assignee: string | null;
  reward: number;
  frequency: string;
  completed: boolean;
  pending_approval: boolean;
  approved_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
}

function symbolFor(currency: string): string {
  const sym: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
    KES: 'KSh', GHS: 'GH\u20B5', INR: '\u20B9', BRL: 'R$', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$',
  };
  return sym[currency] || currency + ' ';
}

/**
 * Local midnight that the current daily / weekly period started at, or null for
 * a one-time chore. Weeks start on Monday, matching how the allowance week is
 * described elsewhere in the app.
 */
function periodStart(frequency: string): Date | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (frequency === 'daily') return d;
  if (frequency === 'weekly') {
    // getDay() is 0 on Sunday, which belongs to the week that began six days
    // earlier \u2014 not to the one starting tomorrow.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  return null;
}

/**
 * "Daily" and "Weekly" were stored on the chore and shown as a label, but
 * nothing ever cleared `completed` \u2014 there is no cron job and no trigger behind
 * Frequency \u2014 so a recurring chore sat struck through in the child's Done list
 * forever and the parent had to un-tick it by hand every single day. The
 * roll-over therefore happens here, on the parent's next visit to this page: a
 * completed daily/weekly chore whose last approval falls before the current
 * period goes back to "not done" so the child can do it again.
 *
 * kid_ledger is deliberately left alone. Each period's approval is its own IOU
 * and the earlier ones are real history the family may not have settled yet.
 *
 * Only *completed* chores roll over. A chore sitting in pending_approval is
 * skipped on purpose, and it is worth writing down why so it does not get
 * "fixed": family_chores records no timestamp for the child's mark — its only
 * time columns are created_at, approved_at and rejected_at — so for a pending
 * row the newest date we have is the *previous* period's approval. Rolling
 * those over on that date would routinely erase a mark the child made hours
 * earlier (daily chore approved Monday, child marks it Tuesday morning, parent
 * opens this page Tuesday evening → approved_at is still Monday, so the mark
 * would be wiped out from under the ✓ the parent was about to press). Erasing
 * work the child really did, and hiding it from the only person who can pay
 * for it, is worse than the row staying pending — and the parent already has ✓
 * and ✗ on that row, either of which frees the chore for the next period.
 * A correct per-period reset needs a column recording when the child marked it.
 */
async function rollOverRecurring(rows: Chore[], userId: string): Promise<Chore[]> {
  const due = rows.filter((c) => {
    if (!c.completed) return false;
    const start = periodStart(c.frequency);
    if (!start) return false;
    const last = c.approved_at ?? c.created_at;
    // No timestamp at all (pre-approval-flow rows): leave it rather than
    // resurrect a chore on a guess.
    if (!last) return false;
    return new Date(last).getTime() < start.getTime();
  });
  if (due.length === 0) return rows;

  const { data: reset, error } = await supabase
    .from('family_chores')
    .update({ completed: false, pending_approval: false })
    .in(
      'id',
      due.map((c) => c.id),
    )
    .eq('user_id', userId)
    .select('id');
  if (error || !reset) {
    // Best effort: it retries on the next load. Don't block the page and don't
    // show rows as available when the write did not land.
    console.error('[write failed]', 'reset recurring chores', error?.message);
    return rows;
  }
  const resetIds = new Set(reset.map((r) => r.id as string));
  return rows.map((c) =>
    resetIds.has(c.id) ? { ...c, completed: false, pending_approval: false } : c,
  );
}

interface OwedRow {
  id: string;
  amount_cents: number;
}

/**
 * The chore's unpaid IOUs, newest first. Rows already status='paid' are settled
 * history and are never matched.
 *
 * Returns null when the READ ITSELF failed. Callers must not fold that into
 * "nothing is owed": those two answers point at opposite decisions about a
 * child's money, and treating a failed read as an empty result is how the rest
 * of this codebase lost data.
 */
async function readOwedForChore(
  userId: string,
  choreId: string,
): Promise<OwedRow[] | null> {
  const { data, error } = await supabase
    .from('kid_ledger')
    .select('id, amount_cents')
    .eq('user_id', userId)
    .eq('source_type', 'chore')
    .eq('source_id', choreId)
    .eq('status', 'owed')
    .order('earned_at', { ascending: false });
  if (error) {
    console.error('[read failed]', 'unpaid rewards for this chore', error.message);
    return null;
  }
  return (data as OwedRow[]) ?? [];
}

/** Total of a set of IOU rows, converted from cents to the display unit. */
function owedTotal(rows: OwedRow[]): number {
  return rows.reduce((sum, r) => sum + (Number(r.amount_cents) || 0), 0) / 100;
}

const UNRESOLVED_ASSIGNEE =
  'the family member it is assigned to could not be loaded. Reload the page and try again.';

export default function ChoresPage() {
  const { user } = useAuth();
  const { isProFromSettings } = useUserSettings();
  const isPro = isProUser(isProFromSettings, user);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [showModal, setShowModal] = useState(false);
  const [choreGateBlocked, setChoreGateBlocked] = useState<{ current: number; limit: number } | null>(null);
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reward, setReward] = useState('');
  const [frequency, setFrequency] = useState('once');
  const [submitting, setSubmitting] = useState(false);
  // Per-chore in-flight guard. approveChore inserts a kid_ledger IOU, which is
  // not idempotent: a double-click used to bill the parent twice for one chore.
  const [busyChoreId, setBusyChoreId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const choreDialog = useDialogA11y(showModal);
  const sym = symbolFor(currency);

  const load = useCallback(async () => {
    if (!user) return;
    const [mRes, cRes, sRes] = await Promise.all([
      supabase
        .from('family_members')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at'),
      supabase
        .from('family_chores')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at'),
      supabase
        .from('user_settings')
        .select('currency')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    // Both reads used to be taken as `.data || []`. A failed family_members read
    // then left every chore reading "Unassigned", and approving one marked it
    // done while crediting nobody — silently, because approveChore skips both
    // reward branches when the assignee row is missing. Keep whatever is already
    // on screen and say a load failed instead of overwriting it with nothing.
    const readErr = mRes.error ?? cRes.error;
    setLoadError(readErr ? readErr.message : null);
    if (!mRes.error) setMembers((mRes.data as FamilyMember[]) || []);
    if (!cRes.error) {
      const rows = (cRes.data as Chore[]) || [];
      setChores(await rollOverRecurring(rows, user.id));
    }
    // Plain `currency`, matching every other screen and get_kid_currency(), so
    // the parent's chore card and the child's read the same symbol. This briefly
    // preferred fam_currency to mirror an earlier version of that function —
    // but nothing in the app ever writes fam_currency, so the preference only
    // put this page out of step with Allowances, Members, Family Goals and the
    // Junior dashboard, which the delete confirm points the parent straight at.
    const ownCur = (sRes.data?.currency || '').trim();
    if (ownCur) setCurrency(ownCur);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || submitting) return; // AUDIT Imp #14: double-submit guard.

    // Gate: if the assignee is a Junior kid and already at the free chore
    // limit, show the upgrade modal instead of inserting.
    const assigneeMember = members.find((m) => m.id === assignee);
    const isJuniorKid =
      assigneeMember?.role === 'child' && !!assigneeMember?.auth_user_id;
    if (isJuniorKid) {
      const existingForKid = chores.filter((c) => c.assignee === assignee).length;
      const gate = checkJuniorGate(isPro, 'chores', existingForKid);
      if (gate) {
        setChoreGateBlocked({ current: gate.current, limit: gate.limit });
        return;
      }
    }

    setSubmitting(true);
    const chore = {
      user_id: user.id,
      name: name.trim(),
      assignee: assignee || null,
      // AUDIT Imp #21: NaN-safe parse + clamp to 0.
      reward: Number.isFinite(parseFloat(reward)) ? Math.max(0, parseFloat(reward)) : 0,
      frequency,
      completed: false,
      pending_approval: false,
    };
    const { data, error } = await supabase
      .from('family_chores')
      .insert(chore)
      .select()
      .single();
    if (error) {
      alert(`Could not add chore: ${error.message}`);
      setSubmitting(false);
      return;
    }
    if (data) setChores((prev) => [...prev, data as Chore]);
    setName('');
    setAssignee('');
    setReward('');
    setFrequency('once');
    setShowModal(false);
    setSubmitting(false);
  };

  /** Child marks chore done → goes to pending_approval. */
  const markDone = async (chore: Chore) => {
    if (!user) return;
    // AUDIT Imp #9: verify success before flipping state.
    const { error } = await supabase
      .from('family_chores')
      .update({ pending_approval: true })
      .eq('id', chore.id)
      .eq('user_id', user.id);
    if (error) {
      alert(`Could not mark done: ${error.message}`);
      return;
    }
    setChores((prev) =>
      prev.map((c) =>
        c.id === chore.id ? { ...c, pending_approval: true } : c,
      ),
    );
  };

  /**
   * True when the chore names an assignee we could not resolve out of
   * `members`. load() now deliberately keeps the previous `members` rather than
   * blanking it on a failed read, so an unresolved assignee means "we don't
   * know who this is", never "nobody".
   *
   * Every path that decides what happens to a child's money off the back of
   * that lookup has to stop instead of guessing. Guessing "not a Junior kid"
   * makes juniorOwedTo return null, which skips the confirm AND the ledger
   * cleanup and orphans the IOU forever — the exact bug the cleanup exists to
   * fix. approveChore already did this; un-completing and deleting did not.
   */
  const assigneeUnresolved = (chore: Chore): boolean =>
    !!chore.assignee && !members.some((m) => m.id === chore.assignee);

  /**
   * The Junior kid still owed money for this chore, or null. Only a Junior kid
   * (role='child' AND auth_user_id set) with a reward gets a kid_ledger IOU, so
   * only those paths care about the IOU when the chore is undone. Call
   * assigneeUnresolved() first — a null here is only trustworthy once the
   * assignee is known.
   */
  const juniorOwedTo = (chore: Chore): FamilyMember | null => {
    const m = members.find((x) => x.id === chore.assignee);
    if (!m || m.role !== 'child' || !m.auth_user_id) return null;
    return Number(chore.reward) > 0 ? m : null;
  };

  /** Parent approves → completed + audit timestamp + ledger row (for Junior kids). */
  const approveChore = async (chore: Chore) => {
    // The kid_ledger insert below is not idempotent and there is no unique
    // constraint on (source_type, source_id), so two taps inside the request
    // window used to commit two 'owed' rows for one chore — and no screen in
    // the app can remove the extra one.
    if (!user || busyChoreId) return;
    const assigneeMember = members.find((m) => m.id === chore.assignee);
    // A failed family_members read leaves this undefined, in which case both
    // reward branches below are skipped: the chore would go green having
    // credited nobody, with the ✓ gone and nothing left to retry.
    if (assigneeUnresolved(chore)) {
      reportWriteFailure('approve this chore', UNRESOLVED_ASSIGNEE);
      return;
    }
    setBusyChoreId(chore.id);
    const approvedAt = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('family_chores')
      .update({
        completed: true,
        pending_approval: false,
        approved_at: approvedAt,
      })
      .eq('id', chore.id)
      .eq('user_id', user.id);
    // AUDIT: this used to be a bare `return` — the parent tapped Approve, the
    // write failed, and nothing on screen changed or explained why.
    if (updErr) {
      alert(`Could not approve chore: ${updErr.message}`);
      setBusyChoreId(null);
      return;
    }

    // The approval above and the reward write below are separate statements
    // with no transaction. Both reward writes used to discard their error, so a
    // failure left the chore reading as approved while nobody was credited —
    // for a Junior kid that is the child's money going missing silently. This
    // puts the chore back exactly as we found it so it can be approved again.
    const revertApproval = async (detail: string) => {
      const { error: revertErr } = await supabase
        .from('family_chores')
        .update({
          completed: chore.completed,
          pending_approval: chore.pending_approval,
          approved_at: chore.approved_at ?? null,
        })
        .eq('id', chore.id)
        .eq('user_id', user.id);
      if (revertErr) {
        // Revert failed too: the chore really is stored as approved with no
        // reward behind it. Keep local state matching what persisted and tell
        // the parent, rather than leaving them to discover it later.
        setChores((prev) =>
          prev.map((c) =>
            c.id === chore.id
              ? {
                  ...c,
                  completed: true,
                  pending_approval: false,
                  approved_at: approvedAt,
                }
              : c,
          ),
        );
        console.error('[write failed]', 'undo chore approval', revertErr.message);
        alert(
          `Could not record the reward: ${detail}\n\n` +
            `The chore is still marked approved and could not be reset (${revertErr.message}), ` +
            `so the reward was not credited. Reject it and approve it again to credit it.`,
        );
        return;
      }
      // Reverted cleanly: nothing persisted, so leave local state untouched.
      reportWriteFailure(
        'record the reward',
        `${detail}. The approval was undone — approve the chore again to credit it.`,
      );
    };

    // Junior-only: write an IOU ledger row. A Junior kid has role='child' AND auth_user_id set.
    const isJuniorKid =
      assigneeMember?.role === 'child' && !!assigneeMember?.auth_user_id;
    if (isJuniorKid && chore.reward > 0) {
      const { error: ledgerErr } = await supabase.from('kid_ledger').insert({
        user_id: user.id,
        member_id: assigneeMember.id,
        amount_cents: Math.round(chore.reward * 100),
        source_type: 'chore',
        source_id: chore.id,
        status: 'owed',
        notes: chore.name,
      });
      if (ledgerErr) {
        await revertApproval(ledgerErr.message);
        setBusyChoreId(null);
        return;
      }
    } else if (!isJuniorKid && assigneeMember && chore.reward > 0) {
      // Legacy (pre-Junior) flow for adult/teen family members: credit the
      // reward onto their family_members.earned (and bump allowance).
      // Tracked in audit's Phase 2/3/4 section as a regression if dropped.
      const nextEarned = Math.round(((assigneeMember as FamilyMember).earned || 0) * 100 + chore.reward * 100) / 100;
      const nextAllowance = Math.round(((assigneeMember as FamilyMember).allowance || 0) * 100 + chore.reward * 100) / 100;
      const { error: creditErr } = await supabase
        .from('family_members')
        .update({ earned: nextEarned, allowance: nextAllowance })
        .eq('id', assigneeMember.id)
        .eq('user_id', user.id);
      if (creditErr) {
        await revertApproval(creditErr.message);
        setBusyChoreId(null);
        return;
      }
      setMembers((prev) =>
        prev.map((m) =>
          m.id === assigneeMember.id
            ? { ...m, earned: nextEarned, allowance: nextAllowance }
            : m,
        ),
      );
    }

    setChores((prev) =>
      prev.map((c) =>
        c.id === chore.id
          ? { ...c, completed: true, pending_approval: false, approved_at: approvedAt }
          : c,
      ),
    );
    setBusyChoreId(null);
  };

  /** Parent rejects → back to not done. */
  const rejectChore = async (chore: Chore) => {
    if (!user) return;
    const rejectedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('family_chores')
      .update({
        pending_approval: false,
        completed: false,
        rejected_at: rejectedAt,
      })
      .eq('id', chore.id)
      .eq('user_id', user.id);
    // Previously returned silently: a failed reject left the chore sitting in
    // "pending approval" while the parent believed they had rejected it.
    if (updErr) {
      reportWriteFailure('reject this chore', updErr.message);
      return;
    }
    setChores((prev) =>
      prev.map((c) =>
        c.id === chore.id
          ? { ...c, pending_approval: false, completed: false, rejected_at: rejectedAt }
          : c,
      ),
    );
  };

  /** Direct toggle for quick complete (parent shortcut). */
  const toggleComplete = async (chore: Chore) => {
    if (!user || busyChoreId) return;
    if (chore.completed) {
      // Un-complete. Same guard as approveChore: with a stale/empty `members`
      // we cannot tell a Junior kid from an adult, and guessing wrong here
      // leaves the IOU behind with nothing able to find it again.
      if (assigneeUnresolved(chore)) {
        reportWriteFailure('mark this chore as not done', UNRESOLVED_ASSIGNEE);
        return;
      }
      const owedTo = juniorOwedTo(chore);
      // Only ask when real money is at stake — un-ticking a plain chore should
      // stay a single tap.
      //
      // The read happens BEFORE the question, the way deleteChore already does
      // it. Asking first and reading afterwards meant the sentence could not
      // describe what was about to happen: a parent whose reward had already
      // been settled was told the money "will be cancelled" when there was
      // nothing left to cancel, and the figure quoted was the chore's reward
      // rather than the ledger row that would actually be deleted — which
      // differ once a chore's reward has been edited.
      let owed: OwedRow[] | null = null;
      if (owedTo) {
        owed = await readOwedForChore(user.id, chore.id);
        const money =
          owed === null
            ? `Its unpaid rewards could not be read, so nothing will be cancelled — ` +
              `anything still owed to ${owedTo.name} stays on the settle-up screen.`
            : owed.length === 0
              ? `Nothing is currently owed to ${owedTo.name} for it, so no reward is ` +
                `cancelled.`
              : `The most recent ${sym}${(Number(owed[0].amount_cents) / 100).toFixed(2)} ` +
                `still owed to ${owedTo.name} for it will be cancelled. Rewards from ` +
                `earlier rounds of this chore, and anything already paid, stay.`;
        if (!confirm(`Mark "${chore.name}" as not done?\n\n${money}`)) {
          return;
        }
      }

      setBusyChoreId(chore.id);
      // Chore row FIRST, ledger second — the reverse of what round 1 did, and
      // the comment there had the risk backwards. These are two statements with
      // no transaction, so either can land alone:
      //   ledger first → if the chore update then fails, the money is gone for
      //     good and the parent is told only that the chore did not change. The
      //     chore still reads as done, so they conclude nothing happened and
      //     never learn the reward was destroyed.
      //   chore first  → if the ledger delete then fails, the chore reads as
      //     not done and the reward is still listed on the settle-up screen,
      //     where the parent can see it and still pay it.
      // A visible leftover IOU beats silent destruction, so the risk is taken
      // on the side that stays visible.
      //
      // Previously this update discarded its error while flipping local state
      // anyway, so the chore appeared un-completed until the next reload
      // silently restored it.
      const { error: uncompleteErr } = await supabase
        .from('family_chores')
        .update({ completed: false, pending_approval: false })
        .eq('id', chore.id)
        .eq('user_id', user.id);
      if (uncompleteErr) {
        setBusyChoreId(null);
        reportWriteFailure('mark this chore as not done', uncompleteErr.message);
        return;
      }

      if (owedTo) {
        // Reuses the read taken before the confirm — the parent has already
        // been told exactly which amount this cancels, so re-reading here
        // could only act on something different from what they agreed to.
        if (owed === null) {
          // Read failed, so we cannot tell which row belongs to this round.
          // Cancel nothing rather than delete the wrong one, and say plainly
          // that the money is still owed so it is not a silent surprise on the
          // settle-up screen. (The confirm said this would happen.)
          reportWriteFailure(
            'cancel the reward owed for this chore',
            `the chore is now marked not done, but its unpaid rewards could not be read, ` +
              `so ${owedTo.name} is still owed for it on the settle-up screen.`,
          );
        } else if (owed.length > 0) {
          // Newest first: this round's IOU only. The earlier ones are wages
          // already earned in previous periods and are not ours to cancel.
          //
          // `status = 'owed'` is re-asserted on the delete because the read now
          // happens before the confirm, so a parent settling up on another
          // device in between would otherwise have a PAID row destroyed here —
          // settled history, not a cancellable IOU.
          await ok(
            supabase
              .from('kid_ledger')
              .delete()
              .eq('user_id', user.id)
              .eq('id', owed[0].id)
              .eq('status', 'owed'),
            'cancel the reward owed for this chore',
          );
        }
      }
      setBusyChoreId(null);
      setChores((prev) =>
        prev.map((c) =>
          c.id === chore.id
            ? { ...c, completed: false, pending_approval: false }
            : c,
        ),
      );
    } else if (chore.pending_approval) {
      // Already pending — treat click as approve
      await approveChore(chore);
    } else {
      // Not done — mark as pending approval
      await markDone(chore);
    }
  };

  /**
   * Delete the chore and LEAVE the child's unpaid rewards alone.
   *
   * Round 1 cancelled every status='owed' row for the chore here. That is a
   * money-destroying answer to a tidy-up gesture: a recurring chore banks one
   * unpaid IOU per period, so a weekly reward approved three weeks running and
   * not yet settled is three rows, and one tap on × wiped all of it — wages the
   * child had really earned, with no undo anywhere in the app. The bug that
   * change was aimed at is a single phantom IOU from a mis-approval, which is a
   * far smaller harm than an unbounded backlog of real wages.
   *
   * So the money now outlives the chore. kid_ledger.notes carries the chore
   * name, so the settle-up screen still says what the reward was for, and the
   * parent can pay it. Un-completing the chore is the path that cancels a
   * mistaken approval, and the confirm below points at it. Nothing is written
   * to kid_ledger on this path at all, so there is no ordering hazard either.
   */
  const deleteChore = async (chore: Chore) => {
    if (!user || busyChoreId) return;
    // Same guard as approveChore: a stale/empty `members` makes juniorOwedTo
    // answer "no money involved" for a Junior kid who is owed, which would
    // delete the chore without ever telling the parent what is outstanding.
    if (assigneeUnresolved(chore)) {
      reportWriteFailure('delete this chore', UNRESOLVED_ASSIGNEE);
      return;
    }

    // Claimed before the await below so a second tap during the read cannot
    // open a second confirm for the same chore.
    setBusyChoreId(chore.id);

    const owedTo = juniorOwedTo(chore);
    if (owedTo) {
      // Read purely to tell the parent what is at stake. Nothing is destroyed
      // either way, so a failed read degrades the wording instead of blocking
      // the delete.
      const owed = await readOwedForChore(user.id, chore.id);
      const money =
        owed === null
          ? `Any reward still owed to ${owedTo.name} for it is kept — it stays on the ` +
            `settle-up screen so you can still pay it.`
          : owed.length === 0
            ? `Nothing is currently owed to ${owedTo.name} for it.`
            : `${owedTo.name} is still owed ${sym}${owedTotal(owed).toFixed(2)} for it ` +
              `(${owed.length} unpaid reward${owed.length === 1 ? '' : 's'}). That money is ` +
              `KEPT — it stays on the settle-up screen so you can still pay it.\n\n` +
              `If you approved this chore by mistake, mark it as not done first, then ` +
              `delete it.`;
      if (!confirm(`Delete "${chore.name}"?\n\n${money}`)) {
        setBusyChoreId(null);
        return;
      }
    }

    // AUDIT Imp #9: optimistic + rollback.
    const snapshot = chores;
    setChores((prev) => prev.filter((c) => c.id !== chore.id));
    const { error } = await supabase
      .from('family_chores')
      .delete()
      .eq('id', chore.id)
      .eq('user_id', user.id);
    setBusyChoreId(null);
    if (error) {
      setChores(snapshot);
      alert(`Could not delete chore: ${error.message}`);
    }
  };

  return (
    <section className="page active" id="page-chores">
      <div className="page-header">
        <div>
          <h1>Chores &amp; Rewards</h1>
          <p className="page-subtitle">Assign tasks and earn rewards</p>
        </div>
        <button
          className="btn-primary"
          id="addChoreBtn"
          onClick={() => setShowModal(true)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14m-7-7h14" />
          </svg>
          Add Chore
        </button>
      </div>
      {loadError && (
        <div className="empty-state" role="alert" style={{ color: '#ef4444' }}>
          <p>
            Couldn&apos;t load your chores and family members: {loadError}
            <br />
            Anything below may be out of date — don&apos;t approve chores until this
            loads.
          </p>
          <button className="btn-secondary" onClick={() => load()}>
            Try again
          </button>
        </div>
      )}
      <div className="chores-list" id="choresList">
        {chores.length === 0 && !loadError ? (
          <div className="empty-state" id="emptyChores">
            <svg
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.3 }}
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            <p>
              No chores assigned yet. Create chores with rewards to motivate
              the family.
            </p>
          </div>
        ) : (
          chores.map((ch) => {
            const member = members.find((m) => m.id === ch.assignee);
            const memberName = member ? member.name : 'Unassigned';
            const statusClass = ch.completed
              ? ' completed'
              : ch.pending_approval
                ? ' pending'
                : '';
            return (
              <div key={ch.id} className={'chore-card' + statusClass}>
                <div
                  className="chore-check"
                  onClick={() => toggleComplete(ch)}
                />
                <div className="chore-details">
                  <div className="chore-name">{ch.name}</div>
                  <div className="chore-meta">
                    {memberName} • {ch.frequency}
                    {ch.pending_approval && (
                      <span
                        style={{
                          marginLeft: 8,
                          color: '#f59e0b',
                          fontWeight: 600,
                          fontSize: '0.72rem',
                        }}
                      >
                        Awaiting approval
                      </span>
                    )}
                  </div>
                </div>
                <div className="chore-reward">
                  +{sym}
                  {Number(ch.reward).toFixed(2)}
                </div>
                <div className="chore-actions">
                  {ch.pending_approval && !ch.completed && (
                    <>
                      <button
                        title="Approve"
                        onClick={() => approveChore(ch)}
                        disabled={busyChoreId !== null}
                        style={{
                          color: '#10b981',
                          fontWeight: 700,
                          fontSize: '1rem',
                        }}
                      >
                        {busyChoreId === ch.id ? '…' : '✓'}
                      </button>
                      <button
                        title="Reject"
                        onClick={() => rejectChore(ch)}
                        disabled={busyChoreId !== null}
                        style={{
                          color: '#ef4444',
                          fontWeight: 700,
                          fontSize: '1rem',
                        }}
                      >
                        ✗
                      </button>
                    </>
                  )}
                  <button
                    title="Delete"
                    onClick={() => deleteChore(ch)}
                    disabled={busyChoreId !== null}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {choreGateBlocked && (
        <JuniorUpgradeModal
          reason="chores"
          current={choreGateBlocked.current}
          limit={choreGateBlocked.limit}
          onClose={() => setChoreGateBlocked(null)}
        />
      )}

      {showModal && (
        <div
          className="modal-overlay"
          id="choreModal"
          {...choreDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-chore-title"
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="add-chore-title">Add Chore</h2>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Chore Name</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. Clean bedroom"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Assign To</label>
                <select
                  required
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Select member...</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Reward Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  placeholder="5.00"
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Frequency</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                >
                  <option value="once">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%' }}
                disabled={submitting}
              >
                {submitting ? 'Adding…' : 'Add Chore'}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

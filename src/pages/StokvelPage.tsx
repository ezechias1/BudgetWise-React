import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useExpenses } from '@/hooks/useExpenses';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { formatCurrency, monthKey, todayIso } from '@/lib/format';
import { ok, reportWriteFailure } from '@/lib/db';

/**
 * Ports #page-stokvel (dashboard.html lines 1002-1024) + the full stokvel
 * flow from js/app.js (setupStokvel line 8834, loadStokvelData line 8995,
 * renderStokvelPage line 9015).
 *
 * Tables: stokvel_groups, stokvel_members, stokvel_contributions,
 * stokvel_payouts.
 *
 * Implemented: list groups, invite code + copy, stats + monthly progress,
 * member list with paid/unpaid markers, pending request approve/reject,
 * bank reference display, create/join/delete group, contribute (writes
 * to stokvel_contributions AND expenses, like the vanilla app does at
 * line 8962), admin confirm-paid, view history modal, advance payout
 * rotation.
 *
 * Stokvel contribution reminders use the web Notification API
 * (mirrors checkStokvelReminders from app.js line 9291).
 */

interface StokvelGroup {
  id: string;
  owner_id: string;
  name: string;
  monthly_amount: number;
  frequency: 'monthly' | 'yearly';
  goal: string | null;
  stokvel_code: string;
  start_date: string | null;
  end_date: string | null;
  bank_reference: string | null;
  payout_order: string[] | null;
  current_payout_index: number | null;
  created_at: string;
}

interface StokvelMember {
  id: string;
  stokvel_id: string;
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  approved: boolean;
}

interface StokvelContribution {
  id: string;
  stokvel_id: string;
  user_id: string;
  amount: number;
  date: string;
  note: string | null;
}

/**
 * A recorded payout — one period's pot handed to one member.
 *
 * Nothing in the app read this table until now: it was written by "Mark Paid
 * Out" and then never displayed anywhere, so the single most consequential
 * fact in a rotating savings club — who has already had their turn and for how
 * much — existed only in a table no screen showed. That is what let two
 * identical R5,000 rows sit in production unnoticed, and it left a recipient
 * with no way to check or dispute what the group recorded about their turn.
 */
interface StokvelPayout {
  id: string;
  stokvel_id: string;
  recipient_id: string | null;
  amount: number;
  month: string;
  paid: boolean | null;
  created_at: string | null;
}

/**
 * Find whose turn it actually is.
 *
 * `payout_order` is a plain jsonb array of user ids with no foreign key and no
 * trigger behind it, so ids in it go stale: `stokvel_members.user_id` cascades
 * away when someone deletes their BudgetWise account, and nothing prunes the
 * order. The old code read `payout_order[current_payout_index]` and did a
 * single `find` over the approved members — one stale id and that `find`
 * returned undefined, which the card treated as "render nothing". The entire
 * Next payout block AND the Mark Paid Out button disappeared with no error, so
 * the rotation was over permanently: no screen in the app writes the order or
 * the index except that vanished button, and the only remaining remedy was
 * deleting the stokvel, which cascades every member's contribution history
 * away with it.
 *
 * So walk forward from the current index instead, wrapping, and stop at the
 * first slot that belongs to someone who is still an approved member.
 * `skipped` is how many dead slots were passed over — the caller surfaces that
 * rather than silently papering over it, because a rotation with holes in it
 * needs the owner to rebuild it, not just to keep limping.
 *
 * Returns slot `null` only when NOBODY in the order is an approved member
 * (including the empty-order case). That is still not allowed to blank the UI:
 * the card says so out loud and offers the owner a rebuild.
 */
function nextRotationSlot(
  order: string[],
  currentIndex: number,
  approvedIds: Set<string>,
): { slot: number | null; skipped: number } {
  const len = order.length;
  if (len === 0) return { slot: null, skipped: 0 };
  // Normalise first: current_payout_index is a plain int column with no check
  // constraint, so it can sit past the end of a shortened order, and the old
  // `curPayoutIdx < payoutOrder.length` guard turned that into a blank card too.
  const start = ((currentIndex % len) + len) % len;
  for (let step = 0; step < len; step++) {
    const at = (start + step) % len;
    if (approvedIds.has(order[at])) return { slot: at, skipped: step };
  }
  return { slot: null, skipped: 0 };
}

/** Round to cents. Every figure on this page is money someone hands over. */
function cents(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Half-open date range covering one "YYYY-MM", for filtering `date` columns.
 *
 * The obvious `.lte('date', month + '-31')` is a trap: '2026-02-31' is not a
 * valid date literal, so PostgREST rejects the whole request for February and
 * the caller sees a read failure rather than the rows. Both ends are plain
 * calendar strings, so nothing here can be shifted by a timezone.
 */
function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  return {
    from: `${month}-01`,
    to: `${nextYear}-${String(nextMon).padStart(2, '0')}-01`,
  };
}

/**
 * A Date as a LOCAL calendar date, in the same 'YYYY-MM-DD' shape the date
 * columns, `todayIso()` and `hasEnded()` all use.
 *
 * The create form defaulted its dates with `toISOString().split('T')[0]`, which
 * converts to UTC first. Anywhere ahead of UTC — South Africa is UTC+2 — a Date
 * built at local midnight renders as the PREVIOUS day, so the "one year from
 * today" end date the form offered was always a day short, and after 22:00 the
 * start date was yesterday's. Those strings are what `hasEnded` later compares
 * against the local today, so the group went "(ENDED)" a day before its owner
 * meant it to and the reminders stopped a day early with it.
 */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Has this stokvel's end date passed?
 *
 * Was `new Date(g.end_date) < new Date()`. `new Date('2026-12-31')` is parsed
 * as UTC midnight, while the right-hand side is the local instant, so a group
 * ending on the 31st was labelled "(ENDED)" in red from 02:00 SAST ON the 31st
 * — hours before its final day was over, to every member at once.
 *
 * Both values here are local calendar strings in the same 'YYYY-MM-DD' shape,
 * so a plain string comparison is the correct one and no timezone is involved.
 * Ended means the end date is in the past; the last day itself still counts.
 */
function hasEnded(endDate: string | null | undefined, today: string): boolean {
  return !!endDate && endDate.slice(0, 10) < today;
}

/**
 * What the signed-in user or a member still owes for the current period.
 *
 * The old code kept a `Record<string, boolean>` keyed purely on a row existing
 * — `c.amount` was never read and `monthly_amount` never compared — so R50
 * against a R500 obligation produced the same green tick as R500 and dropped
 * the member out of the treasurer's Confirm Payments list entirely. Partial
 * payment is an ordinary event in a savings club, and nobody chased the
 * missing R450 because nothing on the card said it was missing.
 */
type PaidState = 'unknown' | 'none' | 'partial' | 'full';

function paidState(paid: number | null, owed: number): PaidState {
  if (paid === null) return 'unknown';
  // Nothing owed, so nothing can be outstanding — whatever has been paid in.
  // This branch has to come before the partial test: written the other way
  // round, a group whose monthly_amount is 0 (the create form only enforced
  // min="0") turned any contribution into 'partial', and the member row then
  // read "R50.00 of R0.00" with "−R50.00 short" beside it. A negative shortfall
  // is not a thing anyone can settle, and on this page every figure is cash.
  if (owed <= 0) return 'full';
  if (paid >= owed) return 'full';
  if (paid > 0) return 'partial';
  return 'none';
}

/**
 * The stokvel the Record Contribution modal is open for.
 *
 * Carries what is ALREADY recorded for this member this period, because
 * "Confirm Paid" and "+ Contribute" both write a contribution row and neither
 * used to look at the other. The treasurer ticks Nomsa off the bank statement,
 * Nomsa opens the app, sees the expense missing from her own budget, and taps
 * Contribute for the same R500 — the group ledger then holds R1,000 from her
 * and the pot the app tells the treasurer to hand over is R500 more than the
 * cash that exists.
 */
interface ContributeTarget {
  id: string;
  groupName: string;
  amount: number;
  /** Sum already recorded for this user this period, or null if not known. */
  paidSoFar: number | null;
  paidCount: number;
}

/**
 * A membership the owner has not approved yet.
 *
 * `is_stokvel_member(sid)` now tests `approved is true`, so a pending joiner
 * cannot SELECT stokvel_groups, stokvel_contributions or stokvel_payouts at
 * all — the group simply is not in `groups` for them. Before that change the
 * page happily rendered the whole card to anyone who had typed the invite
 * code: every member's name, the pot total, and the owner's bank account
 * number, plus a Contribute button that actually wrote money into the ledger.
 * Their own stokvel_members row is still readable (that SELECT policy has a
 * `user_id = auth.uid()` branch) but it carries no group name or amount, so
 * the SECURITY DEFINER RPC `get_pending_stokvel_memberships` returns exactly
 * the two facts the waiting card is allowed to show.
 */
interface PendingMembership {
  stokvel_id: string;
  group_name: string;
  monthly_amount: number;
  joined_at: string | null;
}

/**
 * Everything the payout form needs, snapshotted from the DATABASE at the
 * moment the owner opened it — not from the rendered card.
 *
 * `collected` in particular is the whole point: the card's "This Month" total
 * comes from a read that may have failed and coalesced to `[]`, and a payout
 * form defaulting to a stale or zero figure is a wrong amount of real cash
 * handed to a real person. `approvedIds` is snapshotted for the same reason —
 * it decides which rotation slots are skippable when the write goes in.
 */
interface PayoutDraft {
  groupId: string;
  groupName: string;
  recipientId: string;
  recipientName: string;
  approvedIds: string[];
  monthlyAmount: number;
  /** monthly_amount x approved headcount — what the group agreed the pot is. */
  potTarget: number;
  /** What has actually been contributed for this period. */
  collected: number;
  month: string;
}

/**
 * A contribution being corrected, snapshotted from the row that was clicked.
 *
 * Until now a contribution could never be changed or removed by anyone: the
 * table was written in two places and read in three, and nothing in the whole
 * app issued an update or a delete against it. A member who typed R5000 instead
 * of R500 inflated the group's All Time total by R4,500 permanently, and the
 * treasurer settling cash against a bank statement had no way to bring the two
 * back together. RLS has always allowed the fix — `user_id = auth.uid() OR
 * is_stokvel_owner(stokvel_id)` on both UPDATE and DELETE — the buttons simply
 * did not exist.
 *
 * `openedAmount` / `openedDate` are what the row said when the form opened.
 * They are compared against a fresh read at save time so an edit made on
 * another device is reported rather than silently overwritten, and they are the
 * values used to look for the matching personal expense row.
 */
interface ContributionEdit {
  id: string;
  stokvelId: string;
  groupName: string;
  memberName: string;
  /** True when this is the signed-in user's own contribution. */
  isMine: boolean;
  openedAmount: number;
  openedDate: string;
  openedNote: string;
}

/**
 * The whole of what someone waiting for approval is allowed to see.
 *
 * Deliberately has no member list, no totals, no history, no invite code, no
 * bank details and no action buttons — not just because the database would
 * refuse those reads now, but because the previous card told a pending joiner
 * they were in the club and then pushed them a reminder to pay. The one thing
 * this card must do is stop them sending real cash before the owner has said
 * yes.
 */
function PendingStokvelCard({
  name,
  monthlyAmount,
  currency,
  joinedAt,
}: {
  name: string;
  monthlyAmount: number;
  currency: string;
  joinedAt: string | null;
}) {
  return (
    <div className="stokvel-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
          gap: 8,
        }}
      >
        <div>
          <h3>{name}</h3>
          <div className="stokvel-goal">
            {formatCurrency(Number(monthlyAmount), currency)} per person, per month
          </div>
        </div>
        <div
          style={{
            background: 'rgba(245,158,11,0.15)',
            color: '#f59e0b',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: '0.7rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          AWAITING APPROVAL
        </div>
      </div>

      <div
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 10,
          padding: 10,
          margin: '8px 0',
          fontSize: '0.85rem',
          lineHeight: 1.5,
        }}
      >
        The admin of this stokvel has not approved you yet. You are not a member
        until they do.
        <div style={{ marginTop: 6, fontWeight: 600 }}>
          Do not pay anything in yet.
        </div>
        <div style={{ marginTop: 6, opacity: 0.7 }}>
          Once you are approved this stokvel will appear here in full, with the
          payment details and everyone's contributions. Until then you cannot
          see or record anything in it.
        </div>
      </div>

      {joinedAt && (
        <div style={{ fontSize: '0.7rem', opacity: 0.4 }}>
          Requested {new Date(joinedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function generateStokvelCode(): string {
  // Mirrors app.js line 8827
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function StokvelPage() {
  const { user } = useAuth();
  const { currency } = useUserSettings();
  const { refresh: refreshExpenses } = useExpenses();
  // The page used to call Notification.requestPermission() straight out of a
  // useEffect on mount, with no user gesture — exactly what this hook's own
  // header says not to do ("mobile browsers treat that as spam"). One Block on
  // that unexplained prompt set permission to 'denied' forever, which also
  // permanently hides DashboardLayout's opt-in banner (it renders only while
  // permission === 'default'), killing kid-approval nudges and the allowance
  // reminder along with stokvel reminders, with no way back inside the app.
  // Reading the state here instead means the reminder rides on a decision the
  // user made deliberately from that banner, and re-runs when they make it.
  const { permission: notifyPermission } = useNotificationPermission();

  const [groups, setGroups] = useState<StokvelGroup[]>([]);
  // A group id missing from these maps means "not known", NOT "empty". The old
  // `?? []` at every read site is what let a failed contributions fetch render
  // as "This Month R0 / All Time R0" with a red cross beside every member,
  // stated as fact — and hand the owner a Confirm Paid button for each member
  // who had in fact already paid. Reads that fail leave the previous values in
  // place and record the reason alongside.
  const [membersMap, setMembersMap] = useState<Record<string, StokvelMember[]>>({});
  const [contribsMap, setContribsMap] = useState<Record<string, StokvelContribution[]>>({});
  const [membersErrors, setMembersErrors] = useState<Record<string, string>>({});
  const [contribsErrors, setContribsErrors] = useState<Record<string, string>>({});
  // The groups read discarded its error too, and supabase-js RESOLVES a
  // PostgREST failure rather than throwing, so the try/catch never saw it —
  // and the catch itself did setGroups([]). An ordinary mobile connection drop
  // told a member "No stokvels yet. Create one or join with an invite code.",
  // which reads as "you were removed and your money is gone".
  const [groupsError, setGroupsError] = useState('');
  // True only once a load has finished writing every map. See the reminder
  // effect: `groups` commits one render BEFORE the contribution reads return,
  // so the "have they already paid?" test ran against {} every single time.
  const [loadComplete, setLoadComplete] = useState(false);
  // Payouts are read now, not just written. Kept alongside its own error map
  // rather than collapsed with `?? []`: "no payouts recorded" and "we could not
  // read the payouts" look identical on screen and mean opposite things to a
  // recipient checking whether their turn was logged.
  const [payoutsMap, setPayoutsMap] = useState<Record<string, StokvelPayout[]>>({});
  const [payoutsErrors, setPayoutsErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Join requests the owner has not answered yet. These are NOT in `groups`:
  // the database no longer lets a pending joiner read the group row at all,
  // so they have to come from the RPC and render as their own card.
  const [pendingMemberships, setPendingMemberships] = useState<PendingMembership[]>([]);
  // A failed pending-read must not render as "you have no requests out" —
  // someone waiting on an approval would conclude their request vanished and
  // re-enter the code, or worse, assume they were rejected.
  const [pendingError, setPendingError] = useState('');
  // Confirmation after a successful join. The group cannot appear yet, so
  // without this the modal just closes and nothing visibly happens.
  const [joinNotice, setJoinNotice] = useState('');

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [contribTarget, setContribTarget] = useState<ContributeTarget | null>(null);
  const [detailTarget, setDetailTarget] = useState<string | null>(null);
  const createDialog = useDialogA11y(createOpen);
  const joinDialog = useDialogA11y(joinOpen);
  const contribDialog = useDialogA11y(contribTarget !== null);
  const detailDialog = useDialogA11y(detailTarget !== null);

  // Create form
  const [cName, setCName] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [cFrequency, setCFrequency] = useState<'monthly' | 'yearly'>('monthly');
  const [cGoal, setCGoal] = useState('');
  const [cStart, setCStart] = useState('');
  const [cEnd, setCEnd] = useState('');
  const [cBankRef, setCBankRef] = useState('');
  const [cBusy, setCBusy] = useState(false);

  // Join form
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);

  // Contribute form
  const [contribAmount, setContribAmount] = useState('');
  const [contribDate, setContribDate] = useState(todayIso());
  const [contribNote, setContribNote] = useState('');
  const [contribBusy, setContribBusy] = useState(false);

  // Payout form. Recording a payout used to be a bare confirm() quoting
  // monthly_amount x headcount — the contractual target, never the cash that
  // was actually collected or handed over — and that unedited figure was what
  // landed in the permanent ledger. It now opens a form, and the numbers in it
  // are read from the database at open time rather than taken from the card.
  const [payoutDraft, setPayoutDraft] = useState<PayoutDraft | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutError, setPayoutError] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);
  // Which group's Mark Paid Out button is mid-open. The old button fired an
  // insert directly with no busy state and no disabled prop, and for a
  // one-member group nextIdx = (0+1) % 1 = 0, so the index never moved and the
  // button re-armed itself immediately after every payout — that is how two
  // identical R5,000 rows got into production.
  const [payoutOpening, setPayoutOpening] = useState<string | null>(null);
  const payoutDialog = useDialogA11y(payoutDraft !== null);

  // Correcting a contribution, from the History modal where the rows already
  // render. See ContributionEdit — nothing in the app could change or remove
  // one of these before, so a mistyped amount was permanent and every figure
  // derived from it stayed wrong forever.
  const [editContrib, setEditContrib] = useState<ContributionEdit | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const editDialog = useDialogA11y(editContrib !== null);

  // Group settings. Every field here was write-once: a mistyped bank account
  // number — the string every member reads before sending real cash — could
  // only be "corrected" by deleting the stokvel, which cascades away every
  // member's contribution history.
  const [settingsTarget, setSettingsTarget] = useState<StokvelGroup | null>(null);
  const [sName, setSName] = useState('');
  const [sAmount, setSAmount] = useState('');
  const [sFrequency, setSFrequency] = useState<'monthly' | 'yearly'>('monthly');
  const [sGoal, setSGoal] = useState('');
  const [sStart, setSStart] = useState('');
  const [sEnd, setSEnd] = useState('');
  const [sBankRef, setSBankRef] = useState('');
  const [sError, setSError] = useState('');
  const [sBusy, setSBusy] = useState(false);
  const settingsDialog = useDialogA11y(settingsTarget !== null);

  // Which member row has a membership write in flight. Approve/Reject had no
  // busy state either, and these buttons sit a few pixels apart on a phone —
  // an un-disabled button that has already been pressed is how the same action
  // gets fired twice.
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  // Group-wide, unlike memberBusy which is per-member. Approving two DIFFERENT
  // members concurrently is the case that corrupts payout_order, and a
  // per-member flag cannot see it.
  const [rotationBusy, setRotationBusy] = useState(false);

  // Which member's Confirm Paid is in flight. This button had no busy state and
  // no disabled prop at all, so two taps before the reload returned wrote two
  // contribution rows for one payment — and nothing in the app could delete
  // either of them until the History Edit/Delete controls existed.
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null);

  // Copy code feedback
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // NOTE: stokvel_groups has no `user_id` column — it is `owner_id`
  // (migration 20260810000005). Three writes here filtered on `user_id`,
  // so PostgREST rejected them with "column does not exist" and the
  // discarded error meant nobody noticed: deleting a stokvel, advancing
  // the payout rotation, and adding an approved member to the payout
  // order have never worked. Now filtered on owner_id, which also matches
  // the RLS policies (owner_id = auth.uid()).

  // Load everything — mirrors loadStokvelData() (app.js line 8995).
  // Uses Promise.all over member + contribution fetches per-group so the
  // requests run in parallel instead of a waterfall.
  const loadStokvelData = useCallback(async () => {
    if (!user) {
      setGroups([]);
      setMembersMap({});
      setContribsMap({});
      setMembersErrors({});
      setContribsErrors({});
      setPayoutsMap({});
      setPayoutsErrors({});
      setPendingMemberships([]);
      setPendingError('');
      setGroupsError('');
      setLoadComplete(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadComplete(false);
    try {
      // Two separate things now, because approval genuinely gates access:
      // `stokvel_groups` returns only the groups this user owns or is an
      // APPROVED member of, and the RPC returns the ones they are still
      // waiting on. A joiner used to appear in the first list the instant
      // they submitted the code; now they appear in neither until the owner
      // acts, which is why the second read exists at all.
      const [groupsRes, pendingRes] = await Promise.all([
        supabase
          .from('stokvel_groups')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.rpc('get_pending_stokvel_memberships'),
      ]);

      if (pendingRes.error) {
        // Say so rather than silently showing nothing: "no pending requests"
        // and "we could not check" look identical on screen and mean opposite
        // things to someone deciding whether to pay.
        setPendingError(
          'Could not check your pending join requests: ' + pendingRes.error.message,
        );
        setPendingMemberships([]);
      } else {
        setPendingError('');
        setPendingMemberships((pendingRes.data ?? []) as PendingMembership[]);
      }

      // Bind the groups error instead of discarding it. `?? []` here was the
      // single most damaging line on the page: PostgREST resolves its failures,
      // so a statement timeout, a 5xx or an expired token all arrived as
      // {data: null, error}, collapsed to an empty list, and rendered "No
      // stokvels yet" to a member whose club and money were perfectly fine.
      // Keep whatever is already on screen and say a load failed — a stale
      // total the user can see is stale beats a confident zero.
      if (groupsRes.error) {
        setGroupsError(
          'Could not load your stokvels: ' +
            groupsRes.error.message +
            '. Nothing has been lost — anything shown below is from the last ' +
            'load that worked. Check your connection and try again.',
        );
        setLoading(false);
        return;
      }
      setGroupsError('');

      const gs = (groupsRes.data ?? []) as StokvelGroup[];
      setGroups(gs);

      const results = await Promise.all(
        gs.map(async (g) => {
          const [members, contribs, payouts] = await Promise.all([
            supabase.from('stokvel_members').select('*').eq('stokvel_id', g.id),
            supabase
              .from('stokvel_contributions')
              .select('*')
              .eq('stokvel_id', g.id)
              .order('date', { ascending: false }),
            // Newest turn first, same as contributions. RLS on stokvel_payouts
            // is owner-or-approved-member, so every member is entitled to this
            // — the app simply never asked for it before.
            supabase
              .from('stokvel_payouts')
              .select('*')
              .eq('stokvel_id', g.id)
              .order('month', { ascending: false }),
          ]);
          return {
            id: g.id,
            members: (members.data ?? []) as StokvelMember[],
            contribs: (contribs.data ?? []) as StokvelContribution[],
            payouts: (payouts.data ?? []) as StokvelPayout[],
            // supabase-js RESOLVES a PostgREST failure rather than throwing, so
            // the try/catch below never sees one. Carry every message out
            // instead of letting `?? []` render a failed read as "nothing here".
            // The contributions one is the expensive mistake: with it swallowed,
            // the card asserted R0 collected and nobody paid, which is both a
            // member believing their money is gone AND an owner being offered a
            // duplicate Confirm Paid for every member who had already paid.
            membersError: members.error ? members.error.message : '',
            contribsError: contribs.error ? contribs.error.message : '',
            payoutsError: payouts.error ? payouts.error.message : '',
          };
        }),
      );

      // Merge rather than replace. A group whose read failed keeps the rows it
      // already had, so a refresh that half-fails degrades to "these figures
      // are from the last good load" instead of to zero. Groups that are gone
      // are dropped, so nothing stale survives a real removal.
      setMembersMap((prev) => {
        const next: Record<string, StokvelMember[]> = {};
        for (const r of results) {
          if (r.membersError) {
            if (prev[r.id]) next[r.id] = prev[r.id];
          } else next[r.id] = r.members;
        }
        return next;
      });
      setContribsMap((prev) => {
        const next: Record<string, StokvelContribution[]> = {};
        for (const r of results) {
          if (r.contribsError) {
            if (prev[r.id]) next[r.id] = prev[r.id];
          } else next[r.id] = r.contribs;
        }
        return next;
      });
      const pMap: Record<string, StokvelPayout[]> = {};
      const meMap: Record<string, string> = {};
      const ceMap: Record<string, string> = {};
      const peMap: Record<string, string> = {};
      for (const r of results) {
        pMap[r.id] = r.payouts;
        if (r.membersError) meMap[r.id] = r.membersError;
        if (r.contribsError) ceMap[r.id] = r.contribsError;
        if (r.payoutsError) peMap[r.id] = r.payoutsError;
      }
      setMembersErrors(meMap);
      setContribsErrors(ceMap);
      setPayoutsMap(pMap);
      setPayoutsErrors(peMap);
      // Only now is it true that every map reflects this load. The reminder
      // effect waits on this; see there for why.
      setLoadComplete(true);
    } catch (err) {
      console.warn('Stokvel load error:', err);
      // Was setGroups([]) with a console.warn and nothing else, so a dropped
      // connection produced the identical "No stokvels yet" empty state as a
      // PostgREST error — a member reasonably concluding they had been removed
      // from the club and their contributions were gone. Keep what is on
      // screen and label it.
      setGroupsError(
        'Could not load your stokvels. Check your connection and try again. ' +
          'Nothing has been lost — anything shown below is from the last load ' +
          'that worked.',
      );
      // Same reasoning as the pendingRes.error branch: a thrown load must not
      // leave a stale pending card on screen implying we re-checked it, nor
      // an empty one implying the request is gone.
      setPendingMemberships([]);
      setPendingError('Could not check your pending join requests. Check your connection and try again.');
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadStokvelData();
  }, [loadStokvelData]);

  /**
   * Stokvel contribution reminders — web Notification API.
   * Mirrors checkStokvelReminders() from app.js line 9291.
   *
   * This is the only place the app pushes a payment instruction at a person, so
   * every gate below exists because the version without it told someone to send
   * real cash they did not owe. Four separate defects lived here:
   *
   * 1. It ran on the render where `groups` was populated and `contribsMap` was
   *    still the initial {}. `setGroups` commits in the microtask continuation
   *    of the groups fetch, then execution hits the per-group Promise.all and
   *    React's default-priority flush lands long before those responses. So the
   *    "have they already paid?" test was evaluated against an empty array on
   *    every single load and was structurally incapable of suppressing
   *    anything: a member who paid on the 3rd opened the page on the 4th, got
   *    "your contribution is due this month", and saw a green tick next to
   *    their own name on the same screen. People either learn to ignore the
   *    reminder or pay twice to be safe. `loadComplete` is the fix, and an
   *    unknown (failed) contributions read is skipped for the same reason — not
   *    knowing whether someone paid is not a licence to tell them they have not.
   * 2. The flag was one key for the whole device with no user id in it, so the
   *    first account to open the page on a shared household tablet spent the
   *    day's reminder for everyone who signed in after them.
   * 3. It `break`ed after the first unpaid group, and groups are ordered newest
   *    first, so a member of three stokvels only ever heard about the most
   *    recently created one — the older club was never mentioned on any day.
   *    The flag is now per user AND per group, and every due group is told.
   * 4. `localStorage.setItem` ran unconditionally and synchronously inside the
   *    `if`, before either `serviceWorker.ready` or the permission prompt had
   *    resolved — so a browser with no service worker, or a user who dismissed
   *    the prompt, displayed nothing and still burned the day. It is now
   *    written only after showNotification has actually resolved.
   *
   * See notifyPermission for why nothing here ever calls requestPermission.
   */
  useEffect(() => {
    if (!user || !loadComplete || groups.length === 0) return;
    // Never prompt from here: no user gesture, and one Block kills every
    // notification in the app permanently. Silence is the correct behaviour
    // until the user opts in from DashboardLayout's banner.
    // Read the live browser value, not just the hook's copy.
    // useNotificationPermission keeps per-instance state updated only by that
    // instance's own request(), and the opt-in banner lives in
    // DashboardLayout with its own instance — so this page's copy stays
    // 'default' after a user grants permission, and the reminder stayed
    // silent until the page remounted. Still never calls requestPermission:
    // there is no user gesture here, and one Block kills every notification
    // in the app permanently.
    const livePermission =
      typeof Notification !== 'undefined' ? Notification.permission : 'denied';
    if (notifyPermission !== 'granted' && livePermission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;

    const today = todayIso();
    const currentMonth = monthKey();

    const due = groups.filter((g) => {
      // Never nag someone who is not actually in the club. This push was the
      // step that turned the old approval hole into lost cash: a pending
      // joiner was told "your R500 is due this month", EFT'd it, and tapped
      // Contribute — money in the group total with no member behind it. RLS
      // now keeps a pending group out of `groups` entirely, but this re-checks
      // membership itself rather than trusting a single layer.
      //
      // A read that FAILED on this load is not the same as one that has not
      // arrived, and `undefined` no longer catches it: the maps deliberately
      // keep the last good rows so the card can show them labelled "from the
      // last load that worked". Stale figures are fine to look at. They are not
      // fine to push a payment instruction from, because the contribution
      // missing from the copy we still hold may be precisely the one the member
      // already made — which is the double payment this whole effect was
      // sending people into.
      if (membersErrors[g.id] || contribsErrors[g.id]) return false;
      const rows = membersMap[g.id];
      if (rows === undefined) return false; // member read failed or not in yet
      const myRow = rows.find((m) => m.user_id === user.id);
      if (g.owner_id !== user.id && myRow?.approved !== true) return false;

      // A finished stokvel does not collect anything. `end_date` was read only
      // for the card's "(ENDED)" label and never consulted here, so a 12-month
      // club that ended in December kept pushing "your contribution of R1,000
      // is due this month" in January and every month after it, forever.
      if (hasEnded(g.end_date, today)) return false;
      if (!(Number(g.monthly_amount) > 0)) return false;

      const contribs = contribsMap[g.id];
      if (contribs === undefined) return false; // see (1): unknown is not unpaid
      const paid = contribs
        .filter((c) => c.user_id === user.id && c.date?.substring(0, 7) === currentMonth)
        .reduce((s, c) => s + Number(c.amount), 0);
      // Partial counts as paid for the purpose of nagging. The card shows the
      // shortfall in full, and a push telling someone the whole amount is due
      // when they have already sent most of it invites a duplicate payment.
      return paid <= 0;
    });
    if (due.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const g of due) {
        // Per user AND per group. The old key was 'budgetwise-stokvel-reminder'
        // for everyone and everything; entries under it are simply left behind.
        const key = `budgetwise-stokvel-reminder:${user.id}:${g.id}`;
        try {
          if (localStorage.getItem(key) === today) continue;
        } catch {
          return; // storage unavailable: better silent than one push per render
        }
        try {
          const reg = await navigator.serviceWorker.ready;
          if (cancelled) return;
          await reg.showNotification('Stokvel Reminder', {
            body:
              `Your ${g.name} contribution of ` +
              `${formatCurrency(Number(g.monthly_amount), currency)} is due this month.`,
            icon: '/icons/icon-192.png',
            tag: `bw-stokvel-${g.id}`,
          });
          // Only now — the day is spent on a reminder that was really shown.
          localStorage.setItem(key, today);
        } catch (err) {
          // Was an un-caught `.then()` chain, so a rejected ready/show surfaced
          // as an unhandled rejection. Leaving the flag unset is deliberate:
          // the reminder can be retried on the next load.
          console.warn('Stokvel reminder could not be shown:', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    groups,
    membersMap,
    contribsMap,
    membersErrors,
    contribsErrors,
    user,
    currency,
    loadComplete,
    notifyPermission,
  ]);

  // ============================================================
  // Handlers
  // ============================================================
  const openCreate = () => {
    const now = new Date();
    // See isoDate: both of these were computed through toISOString(), which is
    // UTC, so the default term was a day short of the year it claims to be and
    // the start date rolled over to "yesterday" after 22:00 SAST.
    const endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    setCName('');
    setCAmount('');
    setCFrequency('monthly');
    setCGoal('');
    setCStart(isoDate(now));
    setCEnd(isoDate(endDate));
    setCBankRef('');
    setCreateOpen(true);
  };

  const handleCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!user) return;
    // `monthly_amount` went in as a bare parseFloat of the input. The field is
    // only `min="0"`, so 0 was accepted and became the obligation every member
    // is measured against: the card said "Monthly/Person R0.00", the month
    // target and the pot were both 0, and nobody could record anything because
    // handleContribute rejects a non-positive amount. An unrounded value was
    // accepted too, so R500.555 was stored, displayed as R500.56, and
    // multiplied by the headcount into a pot that matched neither. The settings
    // form already validates and rounds exactly this way; creation did not.
    const parsedAmount = parseFloat(cAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      alert(
        'Enter a monthly contribution greater than zero — it is the amount ' +
          'every member is asked for and the figure the whole card is measured ' +
          'against.',
      );
      return;
    }
    const monthlyAmount = cents(parsedAmount);
    if (cStart && cEnd && cEnd < cStart) {
      alert('The end date is before the start date.');
      return;
    }
    setCBusy(true);
    try {
      const code = generateStokvelCode();
      const result = await supabase
        .from('stokvel_groups')
        .insert({
          owner_id: user.id,
          name: cName,
          monthly_amount: monthlyAmount,
          frequency: cFrequency,
          goal: cGoal || '',
          stokvel_code: code,
          payout_order: [user.id],
          start_date: cStart || null,
          end_date: cEnd || null,
          bank_reference: cBankRef || '',
        })
        .select()
        .single();

      // Was `if (result.data) { … }` with no else: when the insert failed the
      // whole block was skipped in silence — the user pressed Create and
      // literally nothing happened, not even an error message.
      if (result.error || !result.data) {
        reportWriteFailure('create this stokvel', result.error?.message);
        setCBusy(false);
        return;
      }

      // Was unchecked: on failure the creator owned a stokvel they were not a
      // member of — the same class of bug that broke family linking — and the
      // UI still closed the modal as if everything had worked.
      const ownerAdded = await ok(
        supabase.from('stokvel_members').insert({
          stokvel_id: result.data.id,
          user_id: user.id,
          display_name: user.email?.split('@')[0] ?? 'Owner',
          role: 'owner',
          approved: true,
        }),
        'add you as the owner of this stokvel',
      );
      if (!ownerAdded) {
        // Roll the group back rather than leave an ownerless stokvel behind.
        await ok(
          supabase.from('stokvel_groups').delete().eq('id', result.data.id),
          'clean up the half-created stokvel — please delete it manually',
        );
        setCBusy(false);
        return;
      }

      setCreateOpen(false);
      await loadStokvelData();
    } catch (err) {
      console.error('Create stokvel error:', err);
      alert('Error creating stokvel');
    }
    setCBusy(false);
  };

  const openJoin = () => {
    setJoinCode('');
    setJoinError('');
    setJoinNotice('');
    setJoinOpen(true);
  };

  const handleJoin = async () => {
    if (!user) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Enter a code');
      return;
    }
    setJoinBusy(true);
    try {
      // A direct select on stokvel_groups can never find the group here: the
      // only SELECT policy is owner-or-member, and a first-time joiner is
      // neither, so every valid code came back as zero rows and was reported
      // as "Invalid code". The SECURITY DEFINER RPC resolves the code
      // server-side and returns only id/name/monthly_amount.
      const { data: lookupData, error: lookupError } = await supabase.rpc(
        'find_stokvel_group_by_code',
        { p_code: code },
      );
      if (lookupError) {
        // A real failure is not the same as an unknown code — don't send the
        // user back to the admin over a network hiccup.
        setJoinError('Could not check that code: ' + lookupError.message);
        setJoinBusy(false);
        return;
      }
      const group = (
        lookupData as { id: string; name: string; monthly_amount: number }[] | null
      )?.[0];
      if (!group) {
        setJoinError('Invalid code. Check with the stokvel admin.');
        setJoinBusy(false);
        return;
      }
      // The RPC doesn't expose owner_id, but RLS lets an owner read their own
      // group row — so if this id comes back filtered on owner_id, the joiner
      // is the owner.
      const owned = await supabase
        .from('stokvel_groups')
        .select('id')
        .eq('id', group.id)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (owned.data) {
        setJoinError('You already own this stokvel!');
        setJoinBusy(false);
        return;
      }
      // Re-entering a code you already used is the normal case, not an error:
      // the group does not appear anywhere while you are pending, so people
      // reasonably assume the first attempt failed and try again. Read the
      // approved flag as well as the id so the two cases can be told apart —
      // previously both produced a red "You are already in this stokvel."
      // with no hint of which one it was or what to do next.
      const existing = await supabase
        .from('stokvel_members')
        .select('id, approved')
        .eq('stokvel_id', group.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing.error) {
        // Was discarded: on a failed read this fell through to the insert,
        // which then hit the UNIQUE (stokvel_id, user_id) index and reported
        // a raw Postgres constraint message as if joining had gone wrong.
        setJoinError('Could not check your membership: ' + existing.error.message);
        setJoinBusy(false);
        return;
      }
      if (existing.data) {
        setJoinOpen(false);
        setJoinNotice(
          existing.data.approved === true
            ? 'You are already a member of ' + group.name + '. It is in your list below.'
            : 'Your request to join ' +
              group.name +
              ' has already been sent and is still waiting for the admin to approve it. ' +
              'Do not pay anything in until it is approved.',
        );
        setJoinBusy(false);
        await loadStokvelData();
        return;
      }
      // Was unchecked: a failed insert still closed the modal, so the user
      // believed their join request was pending when no row existed at all.
      const joinWrite = await supabase.from('stokvel_members').insert({
        stokvel_id: group.id,
        user_id: user.id,
        display_name: user.email?.split('@')[0] ?? 'Member',
        role: 'member',
        approved: false,
      });
      if (joinWrite.error) {
        // 23505 = the unique index on (stokvel_id, user_id). The read above
        // usually catches this, but two taps on Join race past it; that is a
        // duplicate request, not a failure, so don't show a constraint dump.
        if (joinWrite.error.code === '23505') {
          setJoinOpen(false);
          setJoinNotice(
            'Your request to join ' +
              group.name +
              ' is already in — it is waiting for the admin to approve it.',
          );
          setJoinBusy(false);
          await loadStokvelData();
          return;
        }
        setJoinError('Could not join: ' + joinWrite.error.message);
        setJoinBusy(false);
        return;
      }
      // The group will NOT appear in the list now, and that is correct: until
      // the owner approves, the database returns nothing about it. Say so
      // plainly — the old code called loadStokvelData() and relied on the
      // full card showing up, so with approval enforced the modal would just
      // close on an unchanged screen and the joiner would have no idea
      // whether anything had happened.
      setJoinOpen(false);
      setJoinNotice(
        'Request sent to the admin of ' +
          group.name +
          '. You are not a member yet — do not pay anything in until it shows ' +
          'up here as an approved stokvel.',
      );
      await loadStokvelData();
    } catch (err) {
      console.error('Join stokvel error:', err);
      setJoinError('Error joining stokvel');
    }
    setJoinBusy(false);
  };

  /**
   * @param paidSoFar what this user has already recorded this period, or null
   *   when the contributions read has not landed or failed. Only used to
   *   pre-fill and to warn — handleContribute re-reads it from the database
   *   before writing, because this figure decides whether a real payment gets
   *   counted twice.
   */
  const openContribute = (g: StokvelGroup, paidSoFar: number | null, paidCount: number) => {
    const owed = cents(Number(g.monthly_amount));
    // Pre-fill with what is still outstanding, not with the full monthly
    // amount. Someone who paid R50 of R500 and taps Contribute is topping up,
    // and the old default handed them R500 to record on top of the R50.
    const outstanding = paidSoFar === null ? owed : cents(Math.max(0, owed - paidSoFar));
    setContribTarget({
      id: g.id,
      groupName: g.name,
      amount: owed,
      paidSoFar,
      paidCount,
    });
    setContribAmount((outstanding > 0 ? outstanding : owed).toFixed(2));
    setContribDate(todayIso());
    setContribNote('');
  };

  const handleContribute = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!user || !contribTarget) return;
    setContribBusy(true);
    try {
      // AUDIT Imp #21: NaN-safe + positive check instead of writing garbage.
      const parsed = parseFloat(contribAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        alert('Enter a valid positive amount.');
        setContribBusy(false);
        return;
      }
      // AUDIT Imp #11: round to cents before persisting so repeated small
      // contributions don't drift the running totals.
      const amt = Math.round(parsed * 100) / 100;
      const group = groups.find((g) => g.id === contribTarget.id);
      const groupName = group ? group.name : contribTarget.groupName;

      // Look for what is already on record for this member in the period being
      // contributed to, and read it from the database rather than from the card.
      //
      // "Confirm Paid" and "+ Contribute" both insert a contribution row and
      // neither knew about the other, so one payment was routinely counted
      // twice: the treasurer ticks Nomsa off the bank statement, Nomsa later
      // opens the app, finds the expense missing from her own budget (Confirm
      // Paid deliberately cannot write to it) and taps Contribute for the same
      // R500. The group ledger then holds R1,000 from her, the month reads as
      // over-collected, and the pot the app tells the treasurer to hand over is
      // R500 more than the cash that exists. The card's own copy is no use for
      // catching that — it can be minutes old, and if its read failed it says
      // nobody has paid at all, which is the exact state that invites the
      // duplicate.
      const month = contribDate.substring(0, 7);
      const bounds = monthBounds(month);
      const mine = await supabase
        .from('stokvel_contributions')
        .select('id, amount, date, note')
        .eq('stokvel_id', contribTarget.id)
        .eq('user_id', user.id)
        .gte('date', bounds.from)
        .lt('date', bounds.to);
      if (mine.error) {
        // Refuse rather than write blind. A duplicate contribution is real
        // money counted twice in a ledger the club settles cash from, and
        // until this page had a History Delete there was no way back at all.
        reportWriteFailure(
          'check what you have already recorded for ' +
            month +
            ' in ' +
            groupName +
            ' — nothing was recorded, because adding a second payment on top ' +
            'of one already on the books would overstate the pot',
          mine.error.message,
        );
        setContribBusy(false);
        return;
      }
      const already = (mine.data ?? []) as {
        id: string;
        amount: number;
        date: string;
        note: string | null;
      }[];
      if (already.length > 0) {
        const alreadyTotal = cents(already.reduce((s, c) => s + Number(c.amount), 0));
        const byAdmin = already.some((c) => (c.note ?? '').startsWith('Confirmed by admin'));
        if (
          !confirm(
            'You already have ' +
              already.length +
              (already.length === 1 ? ' contribution' : ' contributions') +
              ' recorded in ' +
              groupName +
              ' for ' +
              month +
              ', totalling ' +
              formatCurrency(alreadyTotal, currency) +
              ':\n\n' +
              already
                .map(
                  (c) =>
                    '  ' +
                    formatCurrency(Number(c.amount), currency) +
                    ' on ' +
                    c.date +
                    (c.note ? ' — ' + c.note : ''),
                )
                .join('\n') +
              '\n\n' +
              (byAdmin
                ? 'One of these was recorded by the stokvel admin from the bank ' +
                  'statement, so the money you sent is ALREADY counted. Adding ' +
                  'another would count the same payment twice.\n\n'
                : '') +
              'Record a further ' +
              formatCurrency(amt, currency) +
              ' on top?\n\nYour total for ' +
              month +
              ' becomes ' +
              formatCurrency(cents(alreadyTotal + amt), currency) +
              ' against ' +
              formatCurrency(cents(Number(contribTarget.amount)), currency) +
              ' owed, and the pot the club settles cash from goes up by ' +
              formatCurrency(amt, currency) +
              '.',
          )
        ) {
          setContribBusy(false);
          return;
        }
      }

      // Was unchecked: a failed insert still closed the modal and reported
      // success, so the contribution vanished from the group ledger with the
      // member believing they had paid. In a stokvel the ledger IS the
      // product, so bail out here rather than write the expenses row for a
      // contribution that was never recorded.
      //
      // ok() is not enough here: PostgREST returns error:null for an INSERT
      // that wrote nothing, which is exactly what RLS gives a user who is no
      // longer an approved member of this stokvel — un-approved or removed
      // while the page sat open. That reported success, and the expenses write
      // below then put the money in the member's own budget, so their budget
      // said they had paid and the club's ledger had never heard of it.
      const contribWrite = await supabase
        .from('stokvel_contributions')
        .insert({
          stokvel_id: contribTarget.id,
          user_id: user.id,
          amount: amt,
          date: contribDate,
          note: contribNote,
        })
        .select('id');
      if (contribWrite.error || (contribWrite.data ?? []).length === 0) {
        reportWriteFailure(
          'record this contribution in ' +
            groupName +
            ' — nothing was saved, and nothing was added to your own budget ' +
            'either',
          contribWrite.error?.message ??
            'the database accepted the request but recorded nothing. You may no longer be an approved member of this stokvel — reload and check',
        );
        setContribBusy(false);
        return;
      }

      // Also write an expenses row so it shows in totals/pie (app.js line 8971).
      // source='stokvel' is what stops this being double-counted once bank
      // import is live: the same contribution also arrives as a bank debit,
      // and the dedupe matcher uses source to tell the two apart. The
      // migration backfilled existing rows; this tags new ones at write time.
      //
      // Was unchecked: when this failed the contribution existed in the group
      // ledger but never reached the member's own budget, and the two silently
      // disagreed forever. The contribution above has already committed and
      // there is no transaction spanning both tables, so say plainly what did
      // and did not happen instead of leaving the user inconsistent.
      const expenseWrite = await supabase.from('expenses').insert({
        user_id: user.id,
        category: 'Stokvel',
        description: groupName + (contribNote ? ' — ' + contribNote : ''),
        amount: amt,
        date: contribDate,
        recurring: 'no',
        account_mode: 'personal',
        source: 'stokvel',
      });
      if (expenseWrite.error) {
        reportWriteFailure(
          'add this contribution to your budget — it IS recorded in the ' +
            groupName +
            ' ledger, so add it manually as a "Stokvel" expense to keep your own totals in step',
          expenseWrite.error.message,
        );
      }

      setContribTarget(null);
      await Promise.all([loadStokvelData(), refreshExpenses()]);
    } catch (err) {
      console.error('Contribution error:', err);
      alert('Error recording contribution');
    }
    setContribBusy(false);
  };

  const handleApproveMember = async (memberId: string, stokvelId: string, uid: string) => {
    if (!user) return;
    // Serialised deliberately, and this is not belt-and-braces.
    //
    // Re-reading payout_order per call (below) is what makes a stale tab safe,
    // but it introduces a race the previous in-place `order.push(uid)` did not
    // have: two Approves fired within one round-trip both read the order
    // BEFORE either write lands, and the second overwrites the first. The
    // erased member stays approved and keeps paying every month for a turn
    // that never comes.
    //
    // A per-member flag is not enough here — these are two DIFFERENT members,
    // so `memberBusy === m.id` would let both through. Nothing else in this
    // file needed a group-wide lock; the rotation write is the one place two
    // different rows contend for the same array.
    if (memberBusy || rotationBusy) return;
    setMemberBusy(memberId);
    setRotationBusy(true);
    try {
      await approveMemberInner(memberId, stokvelId, uid);
    } finally {
      setMemberBusy(null);
      setRotationBusy(false);
    }
  };

  const approveMemberInner = async (memberId: string, stokvelId: string, uid: string) => {
    if (!user) return;
    // NOTE: stokvel_members is scoped by id only — the row's user_id is the
    // member being approved, not the caller. RLS must enforce that only the
    // group owner can update. Tightening via RPC is tracked as follow-up.
    //
    // ok() would call this a success even when it matched zero rows, because
    // PostgREST returns no error for an UPDATE that hit nothing. That mattered:
    // an owner with the page open on two devices could reject someone on one
    // and then tap Approve for them on the other's stale list, and the code
    // below would cheerfully write the deleted user's id into payout_order —
    // a slot no member can ever fill. Prove the row was actually updated.
    const approveWrite = await supabase
      .from('stokvel_members')
      .update({ approved: true })
      .eq('id', memberId)
      .select('id');
    if (approveWrite.error) {
      reportWriteFailure('approve this member', approveWrite.error.message);
      return;
    }
    if ((approveWrite.data ?? []).length === 0) {
      alert(
        'That join request is no longer there — it was rejected or withdrawn ' +
          'somewhere else since this page loaded. Nobody was approved and the ' +
          'payout rotation was not touched.',
      );
      await loadStokvelData();
      return;
    }

    // Add to payout order — app.js line 9201.
    //
    // Was read out of the React `groups` snapshot and PUT back as a whole
    // array, so an owner approving from a second, stale tab wrote their old
    // copy of the order over the server's and erased whoever had been approved
    // in between. The erased member stays approved and keeps paying every
    // month, but is not in the rotation, so their turn simply never arrives and
    // nothing on screen shows it. Re-read the order immediately before merging
    // into it so the write is against what the database actually holds.
    const rotRes = await supabase
      .from('stokvel_groups')
      .select('payout_order')
      .eq('id', stokvelId)
      .maybeSingle();
    if (rotRes.error || !rotRes.data) {
      reportWriteFailure(
        'add this member to the payout rotation — they ARE approved, but they ' +
          'will not get a payout turn until this is retried or an admin ' +
          'rebuilds the rotation',
        rotRes.error?.message,
      );
      await loadStokvelData();
      return;
    }
    const order = (rotRes.data.payout_order ?? []) as string[];
    if (!order.includes(uid)) {
      // Was unchecked, and zero rows here means RLS refused the write — the
      // member is approved and contributing but never enters the rotation.
      const orderWrite = await supabase
        .from('stokvel_groups')
        .update({ payout_order: [...order, uid] })
        .eq('id', stokvelId)
        .eq('owner_id', user.id)
        .select('id');
      if (orderWrite.error || (orderWrite.data ?? []).length === 0) {
        reportWriteFailure(
          'add this member to the payout rotation — they ARE approved, but they ' +
            'will not get a payout turn until this is retried or an admin ' +
            'rebuilds the rotation',
          orderWrite.error?.message,
        );
      }
    }
    await loadStokvelData();
  };

  const handleRejectMember = async (memberId: string, groupName: string) => {
    // Same page-wide lock as Approve. Reject does not write payout_order, but
    // it shares the buttons with the action that does, and an owner working
    // through a list of requests taps them alternately — so leaving Reject
    // un-guarded would leave Approve's guard reachable around.
    if (memberBusy || rotationBusy) return;
    setMemberBusy(memberId);
    setRotationBusy(true);
    try {
      await rejectMemberInner(memberId, groupName);
    } finally {
      setMemberBusy(null);
      setRotationBusy(false);
    }
  };

  const rejectMemberInner = async (memberId: string, groupName: string) => {
    // Reject sits about 4px from Approve on a phone and had no confirmation at
    // all, while Delete Stokvel — a less final action for the applicant — did.
    //
    // It also used to orphan money. stokvel_contributions has FKs only to
    // stokvel_groups and auth.users, nothing to stokvel_members, so deleting
    // the membership left the applicant's rows in the group forever: counted
    // in All Time, shown as "Unknown" in History, and unreadable to the person
    // who actually paid (the contributions SELECT policy is owner-or-member,
    // with no `user_id = auth.uid()` branch). Pending members can no longer
    // contribute at all, so this is mostly historical rows now — but "mostly"
    // is not good enough when the number is cash, so read the ledger first and
    // put the real figure in front of the owner before anything is deleted.

    // Re-read the row instead of trusting the card. A stale list is exactly
    // how someone gets rejected after being approved on another device — and
    // that would delete an APPROVED member's contributions below.
    const memberRead = await supabase
      .from('stokvel_members')
      .select('id, user_id, stokvel_id, display_name, approved')
      .eq('id', memberId)
      .maybeSingle();
    if (memberRead.error) {
      reportWriteFailure('look up this join request', memberRead.error.message);
      return;
    }
    if (!memberRead.data) {
      alert('That join request is no longer there — it was already handled somewhere else.');
      await loadStokvelData();
      return;
    }
    const target = memberRead.data as {
      id: string;
      user_id: string | null;
      stokvel_id: string | null;
      display_name: string;
      approved: boolean | null;
    };
    if (target.approved === true) {
      alert(
        target.display_name +
          ' has already been approved — approval happened on another device ' +
          'since this page loaded. Nothing was changed. Reload to see the ' +
          'current list.',
      );
      await loadStokvelData();
      return;
    }
    if (!target.stokvel_id || !target.user_id) {
      reportWriteFailure(
        'reject this join request — the request row is missing the stokvel or ' +
          'the user it belongs to, so it cannot be cleaned up safely',
      );
      return;
    }
    const stokvelId = target.stokvel_id;
    const uid = target.user_id;
    const name = target.display_name;

    // Read the applicant's contributions from the database, not from the
    // card's copy: the confirm below states an amount of real money and it has
    // to be the amount that is actually there.
    const contribRead = await supabase
      .from('stokvel_contributions')
      .select('id, amount')
      .eq('stokvel_id', stokvelId)
      .eq('user_id', uid);
    if (contribRead.error) {
      // Refuse rather than guess. Rejecting while blind to the ledger is the
      // exact path that leaves cash in the group total under "Unknown".
      reportWriteFailure(
        'check whether ' +
          name +
          ' has already paid into this stokvel — nothing was rejected, because ' +
          'removing them without knowing would leave any payment of theirs in ' +
          'the group total with nobody able to see or correct it',
        contribRead.error.message,
      );
      return;
    }
    const theirContribs = (contribRead.data ?? []) as { id: string; amount: number }[];
    const theirTotal = theirContribs.reduce((s, c) => s + Number(c.amount), 0);

    const question =
      theirContribs.length === 0
        ? 'Reject ' +
          name +
          "'s request to join " +
          groupName +
          '?\n\nThey have not paid anything into this stokvel. They will be ' +
          'removed from the pending list and will have to enter the invite ' +
          'code again if you change your mind.'
        : 'Reject ' +
          name +
          "'s request to join " +
          groupName +
          '?\n\n' +
          name +
          ' has ' +
          theirContribs.length +
          (theirContribs.length === 1 ? ' contribution' : ' contributions') +
          ' recorded here, totalling ' +
          formatCurrency(theirTotal, currency) +
          '.\n\nRejecting will DELETE those records, and this stokvel’s All ' +
          'Time total will drop by ' +
          formatCurrency(theirTotal, currency) +
          '. Any cash they actually handed over must be paid back to them ' +
          'outside the app — the app cannot do that.\n\nThis cannot be undone.';
    if (!confirm(question)) return;

    // Contributions go first. If the membership went first and this then
    // failed, the rows would be orphaned — the very bug being fixed. This way
    // the worst case is an applicant who is still pending, which is visible on
    // screen and can be retried.
    if (theirContribs.length > 0) {
      const contribDel = await supabase
        .from('stokvel_contributions')
        .delete()
        .eq('stokvel_id', stokvelId)
        .eq('user_id', uid)
        .select('id');
      if (contribDel.error) {
        reportWriteFailure(
          "delete " + name + "'s contributions — they have NOT been rejected, " +
            'so nothing is orphaned. Try again',
          contribDel.error.message,
        );
        return;
      }
      // ok() would call a zero-row delete a success, and a zero-row delete
      // here means RLS refused it — leave the member in place rather than
      // strand the money. (Fewer rows than expected just means someone else
      // already removed some, which is harmless.)
      if ((contribDel.data ?? []).length === 0) {
        reportWriteFailure(
          "delete " + name + "'s contributions — the database accepted the " +
            'request but removed nothing, so they have NOT been rejected. ' +
            'Only the stokvel admin can remove these',
        );
        return;
      }
    }

    // See handleApproveMember note — stokvel_members ownership is via the
    // parent group, enforced by RLS. Not scoping by user_id here.
    // Was unchecked: a failed delete still reloaded, and the request quietly
    // stayed in the pending list with no explanation.
    const memberDel = await supabase
      .from('stokvel_members')
      .delete()
      .eq('id', memberId)
      .select('id');
    if (memberDel.error || (memberDel.data ?? []).length === 0) {
      reportWriteFailure(
        'remove ' +
          name +
          ' from this stokvel' +
          (theirContribs.length > 0
            ? ' — their contributions HAVE been deleted, so please try Reject again'
            : ''),
        memberDel.error?.message,
      );
      await loadStokvelData();
      return;
    }
    await loadStokvelData();
  };

  const handleDeleteStokvel = async (id: string) => {
    if (!user) return;
    // This is the most final action on the page — members, every contribution
    // and every payout record CASCADE from stokvel_groups — and it used to
    // have the vaguest confirm of the lot: "all its data" with no numbers,
    // while removing a single member quoted that member's exact total. Read
    // the real scale first and put it in front of the owner, the same way
    // every other destructive handler here now does.
    const [gRes, mRes, cRes, pRes] = await Promise.all([
      supabase.from('stokvel_groups').select('name').eq('id', id).maybeSingle(),
      supabase.from('stokvel_members').select('id').eq('stokvel_id', id),
      supabase.from('stokvel_contributions').select('amount').eq('stokvel_id', id),
      supabase.from('stokvel_payouts').select('id').eq('stokvel_id', id),
    ]);
    if (gRes.error || !gRes.data) {
      reportWriteFailure(
        'look up this stokvel before deleting it — nothing was deleted',
        gRes.error?.message ?? 'it is no longer there',
      );
      await loadStokvelData();
      return;
    }
    // A failed count must not read as "there is nothing here to lose".
    const countsKnown = !mRes.error && !cRes.error && !pRes.error;
    const contribRows = (cRes.data ?? []) as { amount: number }[];
    const total = cents(contribRows.reduce((s, c) => s + Number(c.amount), 0));
    const scale = countsKnown
      ? '• ' +
        (mRes.data ?? []).length +
        ' member record' +
        ((mRes.data ?? []).length === 1 ? '' : 's') +
        '\n• ' +
        contribRows.length +
        ' contribution' +
        (contribRows.length === 1 ? '' : 's') +
        ' totalling ' +
        formatCurrency(total, currency) +
        '\n• ' +
        (pRes.data ?? []).length +
        ' payout record' +
        ((pRes.data ?? []).length === 1 ? '' : 's')
      : '• Its members, contributions and payout records — the exact counts ' +
        'could not be read just now, so this may be more than you expect.';
    if (
      !confirm(
        'Delete the stokvel "' +
          gRes.data.name +
          '"?\n\nThis permanently removes:\n' +
          scale +
          '\n\nEvery member loses access to the record of what they paid in, ' +
          'and no cash is moved or refunded by this — it only destroys the ' +
          'app’s record of it. This cannot be undone.',
      )
    ) {
      return;
    }
    // Was unchecked: the user confirmed a destructive delete, the write failed,
    // and the stokvel simply reappeared in the list with no error shown.
    // ok() alone is not enough — src/lib/db.ts treats a zero-row delete as
    // success, which is exactly what RLS returns to a non-owner.
    const del = await supabase
      .from('stokvel_groups')
      .delete()
      .eq('id', id)
      .eq('owner_id', user.id)
      .select('id');
    if (del.error) {
      reportWriteFailure('delete this stokvel', del.error.message);
      return;
    }
    if ((del.data ?? []).length === 0) {
      alert(
        'Nothing was deleted — this stokvel is either already gone or is not ' +
          'yours to delete. Only the admin who created it can remove it.',
      );
      await loadStokvelData();
      return;
    }
    await loadStokvelData();
  };

  /**
   * Read the rotation straight from the database.
   *
   * Every rotation write below starts here rather than from the `groups` state,
   * because `payout_order` is written as a whole array and the React copy can
   * be minutes old — long enough for another tab to have appended a member that
   * a stale write would erase.
   */
  const readRotation = async (
    stokvelId: string,
    action: string,
  ): Promise<{ order: string[]; rawIndex: number | null } | null> => {
    const res = await supabase
      .from('stokvel_groups')
      .select('payout_order, current_payout_index')
      .eq('id', stokvelId)
      .maybeSingle();
    if (res.error || !res.data) {
      reportWriteFailure(action, res.error?.message ?? 'this stokvel is no longer there');
      return null;
    }
    return {
      order: (res.data.payout_order ?? []) as string[],
      rawIndex: res.data.current_payout_index as number | null,
    };
  };

  /**
   * Move the rotation on by one slot, but only if it is still where we think.
   *
   * The `current_payout_index` filter is optimistic concurrency: if another
   * device already advanced the rotation, this update matches zero rows instead
   * of overwriting their move with ours and skipping someone's turn. Zero rows
   * is ambiguous on its own — it is also what RLS returns when a non-owner
   * tries — so re-read to tell "already moved, nothing to do" from "refused".
   *
   * Returns null on success, or a message describing what did not happen.
   */
  const advanceRotationIndex = async (
    stokvelId: string,
    fromRawIndex: number | null,
    nextIndex: number,
  ): Promise<string | null> => {
    if (!user) return 'you are signed out';
    const base = supabase
      .from('stokvel_groups')
      .update({ current_payout_index: nextIndex })
      .eq('id', stokvelId)
      .eq('owner_id', user.id);
    // `.eq(col, null)` is not a null test in PostgREST — it has to be `.is`.
    const guarded =
      fromRawIndex === null
        ? base.is('current_payout_index', null)
        : base.eq('current_payout_index', fromRawIndex);
    const res = await guarded.select('id');
    if (res.error) return res.error.message;
    if ((res.data ?? []).length === 0) {
      const recheck = await supabase
        .from('stokvel_groups')
        .select('current_payout_index')
        .eq('id', stokvelId)
        .maybeSingle();
      if (
        !recheck.error &&
        recheck.data &&
        ((recheck.data.current_payout_index as number | null) ?? 0) !== (fromRawIndex ?? 0)
      ) {
        return null; // someone else moved it on; nothing was lost
      }
      return 'the database accepted the request but changed nothing — only the stokvel admin can move the rotation on';
    }
    return null;
  };

  /**
   * Open the payout form, with every figure in it read fresh.
   *
   * The old flow was a single confirm() built from the card: "Confirm payout of
   * R" + monthly_amount * headcount, unrounded and uneditable, and that exact
   * value went into the permanent ledger. Two things were wrong with it. The
   * amount was the theoretical pot, not the cash actually collected — a
   * 5-member R1,000 group with 3 paid showed "This Month R3,000" and directly
   * under it a R5,000 payout — and the multiplication was raw float, so a
   * R100.01 group read "Confirm payout of R300.03000000000003" at the exact
   * moment real cash was about to change hands.
   */
  const openPayout = async (g: StokvelGroup, recipient: StokvelMember) => {
    if (!user) return;
    setPayoutOpening(g.id);
    const month = monthKey();
    const [memRes, contribRes, existingRes] = await Promise.all([
      supabase
        .from('stokvel_members')
        .select('user_id, display_name, approved')
        .eq('stokvel_id', g.id),
      supabase.from('stokvel_contributions').select('amount, date').eq('stokvel_id', g.id),
      supabase
        .from('stokvel_payouts')
        .select('id, amount, recipient_id')
        .eq('stokvel_id', g.id)
        .eq('month', month),
    ]);
    setPayoutOpening(null);
    const readError = memRes.error ?? contribRes.error ?? existingRes.error;
    if (readError) {
      // Refuse rather than open a form full of guesses. Whatever number sits in
      // that box is the number the owner hands over in cash and the number the
      // group's permanent record will assert forever.
      reportWriteFailure(
        'check what has actually been paid into ' +
          g.name +
          ' this month — no payout was recorded, because the amount on this ' +
          'form has to be the real one and we could not read it',
        readError.message,
      );
      return;
    }

    const memberRows = (memRes.data ?? []) as {
      user_id: string | null;
      display_name: string;
      approved: boolean | null;
    }[];

    // There is now a UNIQUE INDEX on (stokvel_id, month), so a second insert
    // fails with 23505 — but telling the owner at the front door beats letting
    // them fill in an amount and then bouncing them.
    const already = (existingRes.data ?? []) as {
      id: string;
      amount: number;
      recipient_id: string | null;
    }[];
    if (already.length > 0) {
      const prev = already[0];
      const prevName =
        memberRows.find((m) => m.user_id === prev.recipient_id)?.display_name ??
        'someone who has since left the stokvel';
      alert(
        g.name +
          ' already has a payout recorded for ' +
          month +
          ': ' +
          formatCurrency(Number(prev.amount), currency) +
          ' to ' +
          prevName +
          '.\n\nOnly one payout per period can be recorded, so nothing was ' +
          'changed. Open History to see it.',
      );
      await loadStokvelData();
      return;
    }

    const approvedIds = memberRows
      .filter((m) => m.approved === true && m.user_id)
      .map((m) => m.user_id as string);
    if (!approvedIds.includes(recipient.user_id)) {
      alert(
        recipient.display_name +
          ' is no longer an approved member of ' +
          g.name +
          ', so no payout was recorded for them. Reload to see who is next.',
      );
      await loadStokvelData();
      return;
    }

    const collected =
      Math.round(
        ((contribRes.data ?? []) as { amount: number; date: string | null }[])
          .filter((c) => typeof c.date === 'string' && c.date.substring(0, 7) === month)
          .reduce((s, c) => s + Number(c.amount), 0) * 100,
      ) / 100;
    const potTarget = Math.round(Number(g.monthly_amount) * approvedIds.length * 100) / 100;

    setPayoutDraft({
      groupId: g.id,
      groupName: g.name,
      recipientId: recipient.user_id,
      recipientName: recipient.display_name,
      approvedIds,
      monthlyAmount: Number(g.monthly_amount),
      potTarget,
      collected,
      month,
    });
    // Default to what is actually in the pot, not to the target. The owner can
    // type over it — an owner who topped the pot up, or who handed over less,
    // must be able to record what really happened.
    setPayoutAmount(collected.toFixed(2));
    setPayoutError('');
  };

  const handleRecordPayout = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!user || !payoutDraft) return;
    const d = payoutDraft;
    const parsed = parseFloat(payoutAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPayoutError('Enter the amount that was actually handed over.');
      return;
    }
    // Round to cents before it is stored, the way handleContribute already
    // does. stokvel_payouts.amount is unconstrained numeric, so an unrounded
    // float is kept verbatim and can never be reconciled against a bank record.
    const amt = Math.round(parsed * 100) / 100;
    setPayoutBusy(true);
    setPayoutError('');
    try {
      // Re-resolve the turn against the live rotation. Between opening this
      // form and submitting it, another device may have advanced or rebuilt it.
      const rot = await readRotation(
        d.groupId,
        'read the payout rotation — nothing was recorded',
      );
      if (!rot) {
        setPayoutBusy(false);
        return;
      }
      const approvedIds = new Set(d.approvedIds);
      const { slot } = nextRotationSlot(rot.order, rot.rawIndex ?? 0, approvedIds);
      if (slot === null || rot.order[slot] !== d.recipientId) {
        setPayoutError(
          'The rotation has moved on since this form was opened — ' +
            d.recipientName +
            ' is no longer the next recipient. Nothing was recorded. Close ' +
            'this and check the card again.',
        );
        setPayoutBusy(false);
        await loadStokvelData();
        return;
      }
      const nextIndex = (slot + 1) % Math.max(rot.order.length, 1);

      const insert = await supabase
        .from('stokvel_payouts')
        .insert({
          stokvel_id: d.groupId,
          recipient_id: d.recipientId,
          amount: amt,
          month: d.month,
          paid: true,
        })
        .select('id');
      if (insert.error) {
        // 23505 = stokvel_payouts_one_per_period, the UNIQUE (stokvel_id,
        // month) index. Reaching it means a payout for this period already
        // exists — a double submit, or another admin device. Say that, not the
        // raw constraint dump, because this is the moment cash changes hands.
        if (insert.error.code === '23505') {
          setPayoutError(
            'A payout for ' +
              d.month +
              ' has already been recorded in ' +
              d.groupName +
              '. Nothing was recorded twice. Close this and open History to ' +
              'see what is on record.',
          );
          setPayoutBusy(false);
          await loadStokvelData();
          return;
        }
        setPayoutError('Could not record this payout: ' + insert.error.message);
        setPayoutBusy(false);
        return;
      }
      // ok() would treat a zero-row insert as success; here that would mean RLS
      // refused it (payouts are owner-only) while the rotation moved on anyway.
      if ((insert.data ?? []).length === 0) {
        setPayoutError(
          'The database accepted the request but recorded nothing — only the ' +
            'stokvel admin can record a payout. Nothing was saved and the ' +
            'rotation was not moved on.',
        );
        setPayoutBusy(false);
        return;
      }

      const rotateProblem = await advanceRotationIndex(d.groupId, rot.rawIndex, nextIndex);
      if (rotateProblem) {
        reportWriteFailure(
          'move the rotation on — the payout of ' +
            formatCurrency(amt, currency) +
            ' to ' +
            d.recipientName +
            ' IS recorded, but the next payout still points at them. Ask an ' +
            'admin to use Skip turn, or this month will look unpaid',
          rotateProblem,
        );
      }
      setPayoutDraft(null);
      await loadStokvelData();
    } catch (err) {
      console.error('Payout error:', err);
      setPayoutError('Error recording payout. Nothing may have been saved — reload and check History.');
    }
    setPayoutBusy(false);
  };

  /**
   * Move the rotation on without recording a payout.
   *
   * The owner had no way to do this at all, which is what made a stale slot
   * unrecoverable. It is also the ordinary case: a member defers their turn, or
   * the club settled that period outside the app.
   */
  const handleSkipTurn = async (g: StokvelGroup, recipient: StokvelMember) => {
    if (!user) return;
    if (
      !confirm(
        'Skip ' +
          recipient.display_name +
          "'s turn in " +
          g.name +
          '?\n\nNo payout is recorded and no money moves — this only moves the ' +
          'rotation on to the next person in the order. ' +
          recipient.display_name +
          ' keeps their place and comes up again on the next cycle.',
      )
    )
      return;
    const rot = await readRotation(
      g.id,
      'read the payout rotation — nothing was skipped',
    );
    if (!rot) return;
    const approvedIds = new Set(
      (membersMap[g.id] || []).filter((m) => m.approved).map((m) => m.user_id),
    );
    const { slot } = nextRotationSlot(rot.order, rot.rawIndex ?? 0, approvedIds);
    if (slot === null) {
      reportWriteFailure(
        'skip this turn — no one in the payout rotation is still a member of ' +
          'this stokvel, so there is no turn to move on from. Rebuild the ' +
          'rotation instead',
      );
      return;
    }
    // The confirm above named a specific person, so refuse if the live rotation
    // no longer has them up next. Skipping the wrong person's turn is a real
    // loss to them — they wait a whole cycle for a pot they paid into.
    if (rot.order[slot] !== recipient.user_id) {
      alert(
        'The rotation has moved on since this page loaded — ' +
          recipient.display_name +
          ' is no longer the next recipient, so nothing was skipped. Reload to ' +
          'see whose turn it is.',
      );
      await loadStokvelData();
      return;
    }
    const nextIndex = (slot + 1) % Math.max(rot.order.length, 1);
    const problem = await advanceRotationIndex(g.id, rot.rawIndex, nextIndex);
    if (problem) {
      reportWriteFailure('skip this turn — the rotation was not changed', problem);
    }
    await loadStokvelData();
  };

  /**
   * Prune dead slots out of `payout_order` and put every member into it.
   *
   * This is the escape hatch the page did not have. `payout_order` holds bare
   * uuids with no foreign key, so a member who deletes their BudgetWise account
   * has their stokvel_members row cascaded away while their slot stays — and
   * the append in handleApproveMember never pruned. Separately, a stale
   * whole-array write could drop an approved member out of the order entirely,
   * leaving them paying in every month for a turn that never comes.
   *
   * Turn order is real money, so this preserves the existing sequence: it keeps
   * surviving members in the order they were already in, appends anyone missing
   * to the END, and keeps the same PERSON up next wherever possible.
   */
  const handleRepairRotation = async (g: StokvelGroup) => {
    if (!user) return;
    const [rotRes, memRes] = await Promise.all([
      supabase
        .from('stokvel_groups')
        .select('payout_order, current_payout_index')
        .eq('id', g.id)
        .maybeSingle(),
      supabase
        .from('stokvel_members')
        .select('user_id, display_name, approved')
        .eq('stokvel_id', g.id),
    ]);
    if (rotRes.error || !rotRes.data || memRes.error) {
      reportWriteFailure(
        'read this stokvel before rebuilding its rotation — nothing was changed',
        (rotRes.error ?? memRes.error)?.message ?? 'this stokvel is no longer there',
      );
      return;
    }
    const order = (rotRes.data.payout_order ?? []) as string[];
    const rawIndex = rotRes.data.current_payout_index as number | null;
    const approved = ((memRes.data ?? []) as {
      user_id: string | null;
      display_name: string;
      approved: boolean | null;
    }[]).filter((m) => m.approved === true && m.user_id);
    const approvedIds = new Set(approved.map((m) => m.user_id as string));
    const nameOf = (id: string) =>
      approved.find((m) => m.user_id === id)?.display_name ?? 'a former member';

    const kept = order.filter((id) => approvedIds.has(id));
    const added = approved
      .map((m) => m.user_id as string)
      .filter((id) => !order.includes(id));
    const dropped = order.length - kept.length;
    if (dropped === 0 && added.length === 0) {
      alert(
        'The payout rotation for ' +
          g.name +
          ' is already correct — everyone in it is a member, and every member ' +
          'is in it. Nothing was changed.',
      );
      await loadStokvelData();
      return;
    }
    const newOrder = [...kept, ...added];
    if (newOrder.length === 0) {
      reportWriteFailure(
        'rebuild the payout rotation — this stokvel has no approved members to ' +
          'put in one',
      );
      return;
    }
    // Keep the same person up next if they survived the prune; otherwise the
    // turn falls to the first person in the rebuilt order, which is the whole
    // point — a rotation stuck on a departed member has to be able to restart.
    const { slot } = nextRotationSlot(order, rawIndex ?? 0, approvedIds);
    const stayingUpNext = slot === null ? null : order[slot];
    const newIndex = stayingUpNext ? Math.max(0, newOrder.indexOf(stayingUpNext)) : 0;

    const question =
      'Rebuild the payout rotation for ' +
      g.name +
      '?\n\n' +
      (dropped > 0
        ? '• Remove ' +
          dropped +
          (dropped === 1 ? ' turn' : ' turns') +
          ' belonging to people who are no longer members of this stokvel.\n'
        : '') +
      (added.length > 0
        ? '• Add ' +
          added.map(nameOf).join(', ') +
          ' — ' +
          (added.length === 1 ? 'a member who has' : 'members who have') +
          ' no place in the rotation at all — to the end.\n'
        : '') +
      '\nThe rotation becomes:\n' +
      newOrder
        .map((id, i) => i + 1 + '. ' + nameOf(id) + (i === newIndex ? '   ← next payout' : ''))
        .join('\n') +
      '\n\nThis changes whose turn comes when. No money moves and no payout ' +
      'already on record is changed.';
    if (!confirm(question)) return;

    const write = await supabase
      .from('stokvel_groups')
      .update({ payout_order: newOrder, current_payout_index: newIndex })
      .eq('id', g.id)
      .eq('owner_id', user.id)
      .select('id');
    if (write.error || (write.data ?? []).length === 0) {
      reportWriteFailure(
        'rebuild the payout rotation — nothing was changed' +
          (write.error ? '' : '. Only the stokvel admin can do this'),
        write.error?.message,
      );
      return;
    }
    await loadStokvelData();
  };

  /**
   * Record, on the member's behalf, money the treasurer has seen arrive.
   *
   * Three things were wrong with the old one-line version. It inserted
   * `monthly_amount` with no prior read, so a member who had already paid — by
   * their own Contribute, or by an earlier tap of this same button — was
   * credited a second time; there is no unique constraint on (stokvel_id,
   * user_id, month) to stop it, and the card offering the button was itself
   * driven by a contributions read whose failure rendered as "nobody has paid".
   * It had no busy state and its button no disabled prop, so two taps before
   * the reload returned wrote two rows. And it always wrote the FULL monthly
   * amount, so confirming a member who had already sent R50 of R500 credited
   * them R550.
   *
   * Everything the confirm dialog states is read here, live, immediately
   * before it is shown.
   */
  const handleConfirmPaid = async (g: StokvelGroup, m: StokvelMember) => {
    if (!user) return;
    setConfirmBusy(m.id);
    try {
      const month = monthKey();
      const bounds = monthBounds(month);
      // monthly_amount is read live alongside the rows, not taken off `g`.
      // Settings can now change it, and this handler WRITES the difference
      // into the ledger — so an owner whose laptop loaded before they raised
      // the contribution on their phone would credit the member the old
      // amount and mark them settled, leaving a shortfall nobody chases
      // because the Confirm Payments list uses the same stale figure.
      const [existing, groupNow] = await Promise.all([
        supabase
          .from('stokvel_contributions')
          .select('id, amount, date, note')
          .eq('stokvel_id', g.id)
          .eq('user_id', m.user_id)
          .gte('date', bounds.from)
          .lt('date', bounds.to),
        supabase
          .from('stokvel_groups')
          .select('monthly_amount')
          .eq('id', g.id)
          .maybeSingle(),
      ]);
      if (groupNow.error || !groupNow.data) {
        setConfirmBusy(null);
        reportWriteFailure(
          'check how much ' +
            m.display_name +
            ' owes for ' +
            month +
            ' — nothing was recorded',
          groupNow.error?.message ?? 'this stokvel is no longer there',
        );
        return;
      }
      if (existing.error) {
        setConfirmBusy(null);
        reportWriteFailure(
          'check what ' +
            m.display_name +
            ' has already paid for ' +
            month +
            ' — nothing was recorded, because confirming a payment that is ' +
            'already on the books counts the same cash twice and inflates the ' +
            'pot the club settles from',
          existing.error.message,
        );
        return;
      }
      const rows = (existing.data ?? []) as {
        id: string;
        amount: number;
        date: string;
        note: string | null;
      }[];
      const already = cents(rows.reduce((s, c) => s + Number(c.amount), 0));
      const owed = cents(Number(groupNow.data.monthly_amount));
      const outstanding = cents(owed - already);

      if (outstanding <= 0) {
        setConfirmBusy(null);
        alert(
          m.display_name +
            ' is already fully recorded for ' +
            month +
            ' in ' +
            g.name +
            ': ' +
            formatCurrency(already, currency) +
            ' against ' +
            formatCurrency(owed, currency) +
            ' owed.\n\n' +
            rows
              .map(
                (c) =>
                  '  ' +
                  formatCurrency(Number(c.amount), currency) +
                  ' on ' +
                  c.date +
                  (c.note ? ' — ' + c.note : ''),
              )
              .join('\n') +
            '\n\nNothing was recorded — a second row here would count the same ' +
            'cash twice. If one of these is wrong, correct it in History.',
        );
        await loadStokvelData();
        return;
      }

      if (
        !confirm(
          'Record ' +
            formatCurrency(outstanding, currency) +
            ' as paid by ' +
            m.display_name +
            ' into ' +
            g.name +
            ' for ' +
            month +
            '?\n\n' +
            (rows.length === 0
              ? 'They have nothing recorded for this month yet, so this is the ' +
                'full ' +
                formatCurrency(owed, currency) +
                '.'
              : 'They already have ' +
                formatCurrency(already, currency) +
                ' recorded for this month, so this is only the ' +
                formatCurrency(outstanding, currency) +
                ' still outstanding:\n' +
                rows
                  .map(
                    (c) =>
                      '  ' +
                      formatCurrency(Number(c.amount), currency) +
                      ' on ' +
                      c.date +
                      (c.note ? ' — ' + c.note : ''),
                  )
                  .join('\n')) +
            "\n\nOnly do this once you have seen the money arrive. This stokvel's " +
            'All Time total goes up by ' +
            formatCurrency(outstanding, currency) +
            ' for every member.\n\n' +
            'It does NOT add the expense to ' +
            m.display_name +
            "'s own budget — only they can do that, and their app will show " +
            'them this contribution so they do not record it again.',
        )
      ) {
        setConfirmBusy(null);
        return;
      }

      // Was `ok(...)`, which reports a zero-row insert as success. Prove a row
      // landed: the admin is about to tell the club this member has paid.
      const insert = await supabase
        .from('stokvel_contributions')
        .insert({
          stokvel_id: g.id,
          user_id: m.user_id,
          amount: outstanding,
          date: todayIso(),
          note: 'Confirmed by admin for ' + m.display_name,
        })
        .select('id');
      setConfirmBusy(null);
      if (insert.error || (insert.data ?? []).length === 0) {
        reportWriteFailure(
          'confirm this payment — ' +
            m.display_name +
            ' is still shown as owing it',
          insert.error?.message ??
            'the database accepted the request but recorded nothing, so it was refused. Only the stokvel admin can confirm a payment',
        );
        await loadStokvelData();
        return;
      }
      await loadStokvelData();
    } catch (err) {
      console.error('Confirm error:', err);
      setConfirmBusy(null);
      alert('Error confirming payment. Nothing may have been recorded — reload and check History.');
    }
  };

  /**
   * Offer to bring the member's OWN budget back in step after they correct a
   * contribution.
   *
   * handleContribute writes two rows, not one: the stokvel_contributions row
   * that IS the club's ledger, and a personal `expenses` row (category
   * 'Stokvel', source 'stokvel') so the money also shows in the member's own
   * budget and pie chart. Nothing links them — `expenses` has no
   * stokvel_contribution_id column — so the pair can only be matched on
   * (user, source, category, date, amount). That match is a guess, and quietly
   * deleting the wrong row would remove real spending from someone's budget,
   * so it is only ever acted on when EXACTLY ONE row matches and the user has
   * said yes to that specific row by name. Zero matches or several: say what
   * was found and leave the budget alone.
   *
   * Never attempted for anyone else's contribution. Every `expenses` policy is
   * `user_id = auth.uid()`, so an admin fixing a member's figure cannot touch
   * that member's budget at all — only the member can, which is exactly what
   * the confirm tells them.
   *
   * @param next new amount/date to copy across, or null when the contribution
   *   was deleted.
   */
  const reconcileOwnExpense = async (
    edit: ContributionEdit,
    next: { amount: number; date: string } | null,
  ) => {
    if (!user || !edit.isMine) return;
    const matches = await supabase
      .from('expenses')
      .select('id, description, amount, date')
      .eq('user_id', user.id)
      .eq('source', 'stokvel')
      .eq('category', 'Stokvel')
      .eq('date', edit.openedDate)
      .eq('amount', edit.openedAmount);
    if (matches.error) {
      alert(
        'The stokvel ledger has been updated. Your own budget was not touched — ' +
          'we could not check it (' +
          matches.error.message +
          '). If you want them to match, edit the ' +
          formatCurrency(edit.openedAmount, currency) +
          ' "Stokvel" expense dated ' +
          edit.openedDate +
          ' on the Expenses page.',
      );
      return;
    }
    // Narrow by the description handleContribute writes — `groupName` on its
    // own, or `groupName — note`. Without this, a member in two stokvels who
    // pays both R500 on the same day could have the wrong club's expense
    // matched. Filtered here rather than with `.like()` because a group name
    // containing % or _ would be read as a wildcard and widen the match, which
    // is the opposite of what this is for. A stokvel renamed since the
    // contribution simply stops matching, and the user is told nothing was
    // touched — the safe direction to fail in.
    const rows = ((matches.data ?? []) as {
      id: string;
      description: string;
      amount: number;
      date: string;
    }[]).filter(
      (r) =>
        r.description === edit.groupName ||
        r.description.startsWith(edit.groupName + ' — '),
    );
    if (rows.length === 0) {
      alert(
        'The stokvel ledger has been updated.\n\nYour own budget was not ' +
          'changed: it has no "' +
          edit.groupName +
          '" expense of ' +
          formatCurrency(edit.openedAmount, currency) +
          ' dated ' +
          edit.openedDate +
          ' left to match. Check the Expenses page if you want the two to agree.',
      );
      return;
    }
    if (rows.length > 1) {
      alert(
        'The stokvel ledger has been updated.\n\nYour own budget was not ' +
          'changed: ' +
          rows.length +
          ' of its expenses are for "' +
          edit.groupName +
          '", ' +
          formatCurrency(edit.openedAmount, currency) +
          ' on ' +
          edit.openedDate +
          ', and nothing links an expense to a particular contribution, so ' +
          'the app cannot tell which one belongs to this. Fix it yourself on ' +
          'the Expenses page.',
      );
      return;
    }
    const row = rows[0];
    if (next) {
      if (
        !confirm(
          'The stokvel ledger has been updated.\n\nAlso update the matching ' +
            'expense in your own budget?\n\n"' +
            row.description +
            '"\n' +
            formatCurrency(Number(row.amount), currency) +
            ' on ' +
            row.date +
            '  →  ' +
            formatCurrency(next.amount, currency) +
            ' on ' +
            next.date +
            '\n\nThis only changes YOUR budget. The stokvel is already correct ' +
            'either way.',
        )
      )
        return;
      const upd = await supabase
        .from('expenses')
        .update({ amount: next.amount, date: next.date })
        .eq('id', row.id)
        .eq('user_id', user.id)
        .select('id');
      // ok() would report a zero-row write as success. Here that means the row
      // went while we were asking, and the budget still shows the old figure.
      if (upd.error || (upd.data ?? []).length === 0) {
        reportWriteFailure(
          'update the matching expense in your own budget — the stokvel IS ' +
            'corrected, so change that expense on the Expenses page',
          upd.error?.message,
        );
        return;
      }
    } else {
      if (
        !confirm(
          'The contribution has been deleted from the stokvel.\n\nAlso delete ' +
            'the matching expense from your own budget?\n\n"' +
            row.description +
            '"\n' +
            formatCurrency(Number(row.amount), currency) +
            ' on ' +
            row.date +
            '\n\nThis only changes YOUR budget. If the money really did leave ' +
            'your account, keep it.',
        )
      )
        return;
      const del = await supabase
        .from('expenses')
        .delete()
        .eq('id', row.id)
        .eq('user_id', user.id)
        .select('id');
      if (del.error || (del.data ?? []).length === 0) {
        reportWriteFailure(
          'delete the matching expense from your own budget — the contribution ' +
            'IS deleted from the stokvel, so remove that expense on the ' +
            'Expenses page',
          del.error?.message,
        );
        return;
      }
    }
    await refreshExpenses();
  };

  /** Build the snapshot both the edit form and the delete confirm work from. */
  const contribEditFrom = (
    c: StokvelContribution,
    g: StokvelGroup,
    memberName: string,
  ): ContributionEdit => ({
    id: c.id,
    stokvelId: g.id,
    groupName: g.name,
    memberName,
    isMine: !!user && c.user_id === user.id,
    openedAmount: Number(c.amount),
    openedDate: c.date,
    openedNote: c.note ?? '',
  });

  const openEditContribution = (
    c: StokvelContribution,
    g: StokvelGroup,
    memberName: string,
  ) => {
    const edit = contribEditFrom(c, g, memberName);
    setEditAmount(edit.openedAmount.toFixed(2));
    setEditDate(edit.openedDate);
    setEditNote(edit.openedNote);
    setEditError('');
    setEditContrib(edit);
  };

  const handleSaveContribution = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!user || !editContrib) return;
    const edit = editContrib;
    const parsed = parseFloat(editAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setEditError('Enter a valid positive amount.');
      return;
    }
    if (!editDate) {
      setEditError('Enter the date the money was paid in.');
      return;
    }
    // Round to cents before persisting, exactly as handleContribute does —
    // otherwise a corrected amount is stored at a precision no bank statement
    // can be reconciled against.
    const amt = Math.round(parsed * 100) / 100;
    setEditBusy(true);
    setEditError('');
    try {
      // Read the row again before touching it. The confirm below quotes an
      // amount of real money, and the card's copy of it can be minutes old —
      // the treasurer may already have corrected this same row on another
      // device, and last-write-wins would throw their fix away in silence.
      const cur = await supabase
        .from('stokvel_contributions')
        .select('id, amount, date, note')
        .eq('id', edit.id)
        .maybeSingle();
      if (cur.error) {
        setEditError(
          'Could not check this contribution before changing it: ' +
            cur.error.message +
            '. Nothing was changed.',
        );
        setEditBusy(false);
        return;
      }
      if (!cur.data) {
        setEditError(
          'This contribution is no longer there — it was deleted somewhere ' +
            'else since this page loaded. Nothing was changed.',
        );
        setEditBusy(false);
        await loadStokvelData();
        return;
      }
      const liveAmount = Number(cur.data.amount);
      const liveDate = String(cur.data.date);
      const liveNote = (cur.data.note as string | null) ?? '';
      if (liveAmount === amt && liveDate === editDate && liveNote === editNote) {
        setEditContrib(null);
        setEditBusy(false);
        return;
      }
      const delta = Math.round((amt - liveAmount) * 100) / 100;
      const question =
        (edit.isMine
          ? 'Change your contribution to '
          : "Change " + edit.memberName + "'s contribution to ") +
        edit.groupName +
        '?\n\n' +
        formatCurrency(liveAmount, currency) +
        ' on ' +
        liveDate +
        '  →  ' +
        formatCurrency(amt, currency) +
        ' on ' +
        editDate +
        '\n\n' +
        (delta === 0
          ? 'The amount does not change, so the stokvel totals stay the same.'
          : "This stokvel's All Time total " +
            (delta > 0 ? 'goes UP by ' : 'goes DOWN by ') +
            formatCurrency(Math.abs(delta), currency) +
            ' for every member, and the pot the club settles cash from ' +
            'changes with it.') +
        (liveAmount !== edit.openedAmount || liveDate !== edit.openedDate
          ? '\n\nNOTE: this row has already been changed by someone else since ' +
            'you opened it — it now reads ' +
            formatCurrency(liveAmount, currency) +
            ' on ' +
            liveDate +
            ', not what the list showed you. Saving replaces their correction.'
          : '') +
        '\n\n' +
        (edit.isMine
          ? 'Your own budget is not changed by this. Recording a contribution ' +
            'also adds a matching "Stokvel" expense to your Expenses page, and ' +
            'nothing links the two rows, so you will be asked separately ' +
            'whether to update that expense too.'
          : edit.memberName +
            "'s own budget is NOT changed — their personal \"Stokvel\" " +
            'expense stays at the old figure and only they can change it.');
      if (!confirm(question)) {
        setEditBusy(false);
        return;
      }

      const upd = await supabase
        .from('stokvel_contributions')
        .update({ amount: amt, date: editDate, note: editNote })
        .eq('id', edit.id)
        .select('id');
      if (upd.error) {
        setEditError('Could not change this contribution: ' + upd.error.message);
        setEditBusy(false);
        return;
      }
      // ok() would call this a success: PostgREST returns error:null for an
      // UPDATE that matched nothing, and matching nothing is exactly what RLS
      // does to someone editing a row that is neither theirs nor in a stokvel
      // they run. Reporting that as "saved" is how a wrong figure survives.
      if ((upd.data ?? []).length === 0) {
        setEditError(
          'The database accepted the change but updated nothing, so nothing ' +
            'was saved. You can only change your own contribution, or any ' +
            'contribution in a stokvel you run.',
        );
        setEditBusy(false);
        return;
      }
      setEditContrib(null);
      setEditBusy(false);
      await loadStokvelData();
      await reconcileOwnExpense(edit, { amount: amt, date: editDate });
      return;
    } catch (err) {
      console.error('Edit contribution error:', err);
      setEditError(
        'Error saving this contribution. It may not have been changed — close ' +
          'this and check History.',
      );
    }
    setEditBusy(false);
  };

  const handleDeleteContribution = async (
    c: StokvelContribution,
    g: StokvelGroup,
    memberName: string,
  ) => {
    if (!user) return;
    const edit = contribEditFrom(c, g, memberName);
    // The list this row came from may be stale, and the confirm has to state
    // the amount that is actually about to be deleted, not the one on screen.
    const cur = await supabase
      .from('stokvel_contributions')
      .select('id, amount, date, note')
      .eq('id', c.id)
      .maybeSingle();
    if (cur.error) {
      reportWriteFailure(
        'check this contribution before deleting it — nothing was deleted',
        cur.error.message,
      );
      return;
    }
    if (!cur.data) {
      alert('That contribution is no longer there — it was already deleted somewhere else.');
      await loadStokvelData();
      return;
    }
    const liveAmount = Number(cur.data.amount);
    const liveDate = String(cur.data.date);
    edit.openedAmount = liveAmount;
    edit.openedDate = liveDate;

    if (
      !confirm(
        'Delete ' +
          (edit.isMine ? 'your ' : memberName + "'s ") +
          formatCurrency(liveAmount, currency) +
          ' contribution to ' +
          g.name +
          ' dated ' +
          liveDate +
          '?\n\n' +
          "This stokvel's All Time total drops by " +
          formatCurrency(liveAmount, currency) +
          ' for every member, and ' +
          (edit.isMine ? 'you' : memberName) +
          ' may stop being marked as paid for that month.\n\n' +
          'It does not move any cash. If the money really was paid in, it has ' +
          'to be handed back outside the app.\n\n' +
          (edit.isMine
            ? 'Your matching "Stokvel" expense in your own budget is not ' +
              'deleted by this — you will be asked about it separately.'
            : memberName +
              "'s own budget is NOT changed — their personal \"Stokvel\" " +
              'expense stays and only they can remove it.') +
          '\n\nThis cannot be undone.',
      )
    )
      return;

    const del = await supabase
      .from('stokvel_contributions')
      .delete()
      .eq('id', c.id)
      .select('id');
    if (del.error) {
      reportWriteFailure('delete this contribution', del.error.message);
      return;
    }
    // Zero rows deleted with no error means RLS refused it — the row is still
    // in the ledger and the total is unchanged. ok() would have said "done".
    if ((del.data ?? []).length === 0) {
      reportWriteFailure(
        'delete this contribution — the database accepted the request but ' +
          'removed nothing, so it is still there. You can only delete your own ' +
          'contribution, or any contribution in a stokvel you run',
      );
      await loadStokvelData();
      return;
    }
    await loadStokvelData();
    await reconcileOwnExpense(edit, null);
  };

  /**
   * Read what removing or un-approving someone would really cost, from the
   * database.
   *
   * Every confirm below states an amount of cash, a headcount and a rotation
   * position, and each of those decides what a real person is handed or waits
   * another cycle for. The card's copy of them is a render old at best and the
   * product of a read that may have failed and coalesced to `[]` at worst, so
   * none of it is trusted here.
   */
  const readMembershipImpact = async (g: StokvelGroup, member: StokvelMember) => {
    const [memberRes, membersRes, contribRes, payoutRes, rotRes] = await Promise.all([
      supabase
        .from('stokvel_members')
        .select('id, user_id, display_name, approved')
        .eq('id', member.id)
        .maybeSingle(),
      supabase.from('stokvel_members').select('user_id, approved').eq('stokvel_id', g.id),
      supabase
        .from('stokvel_contributions')
        .select('id, amount')
        .eq('stokvel_id', g.id)
        .eq('user_id', member.user_id),
      supabase
        .from('stokvel_payouts')
        .select('amount, month')
        .eq('stokvel_id', g.id)
        .eq('recipient_id', member.user_id),
      supabase
        .from('stokvel_groups')
        .select('payout_order, current_payout_index')
        .eq('id', g.id)
        .maybeSingle(),
    ]);
    const readError =
      memberRes.error ??
      membersRes.error ??
      contribRes.error ??
      payoutRes.error ??
      rotRes.error;
    if (readError) return { error: readError.message } as const;
    if (!memberRes.data) return { gone: true } as const;

    const contribs = (contribRes.data ?? []) as { id: string; amount: number }[];
    const payouts = (payoutRes.data ?? []) as { amount: number; month: string }[];
    const allMembers = (membersRes.data ?? []) as {
      user_id: string | null;
      approved: boolean | null;
    }[];
    return {
      row: memberRes.data as {
        id: string;
        user_id: string | null;
        display_name: string;
        approved: boolean | null;
      },
      contribCount: contribs.length,
      contribTotal: Math.round(contribs.reduce((s, c) => s + Number(c.amount), 0) * 100) / 100,
      payouts,
      payoutTotal: Math.round(payouts.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
      approvedIds: new Set(
        allMembers
          .filter((m) => m.approved === true && m.user_id)
          .map((m) => m.user_id as string),
      ),
      order: ((rotRes.data?.payout_order ?? []) as string[]),
      rawIndex: (rotRes.data?.current_payout_index ?? null) as number | null,
    } as const;
  };

  /**
   * Remove an approved member, or leave a stokvel yourself.
   *
   * `stokvel_members` DELETE has always been `is_stokvel_owner(stokvel_id) OR
   * user_id = auth.uid()`, so both halves of this were permitted and neither
   * had a control. The consequences of that were not cosmetic: an owner who
   * mis-tapped Approve had no way back, and their only remedy was Delete, which
   * cascades the entire contribution history away for everybody. A member who
   * wanted out stayed in the headcount that decides the payout amount, and kept
   * getting reminded to pay.
   *
   * Contributions are deliberately KEPT. The cash behind them was really paid
   * into the pot, so deleting them would make All Time understate what the club
   * received — the mirror image of the orphaned-money bug. Anyone who does want
   * them gone now has a per-row Delete in History, and the confirm says so.
   */
  const handleRemoveMember = async (
    g: StokvelGroup,
    m: StokvelMember,
    mode: 'remove' | 'leave',
  ) => {
    if (!user) return;
    // The owner is the one member who cannot go while the group exists: every
    // owner policy is `owner_id = auth.uid()`, so a stokvel whose admin has
    // left keeps a live group row that nobody can approve members into, record
    // a payout in, or fix a mistake in — and the delete would half-succeed,
    // because removing the membership row does not remove the ownership.
    if (m.user_id === g.owner_id) {
      alert(
        mode === 'leave'
          ? 'You are the admin of ' +
            g.name +
            ', so you cannot leave it.\n\nThe admin is the only person who can ' +
            'approve members, record payouts and correct mistakes, and that ' +
            'stays tied to your account. Either keep running it, hand the club ' +
            'over outside the app, or use Delete — which erases the stokvel and ' +
            "every member's contribution history with it."
          : m.display_name +
            ' is the admin of ' +
            g.name +
            ' and cannot be removed.\n\nEverything only the admin can do is ' +
            'tied to that account. To end the stokvel, use Delete on the card.',
      );
      return;
    }

    setMemberBusy(m.id);
    const impact = await readMembershipImpact(g, m);
    setMemberBusy(null);
    if ('error' in impact) {
      reportWriteFailure(
        (mode === 'leave' ? 'check what leaving ' : 'check what removing ') +
          (mode === 'leave' ? 'this stokvel' : m.display_name) +
          ' would do — nobody was removed, because doing it without knowing ' +
          'what has been paid in is how cash ends up in a total with nobody ' +
          'behind it',
        impact.error,
      );
      return;
    }
    if ('gone' in impact) {
      alert(
        mode === 'leave'
          ? 'You are no longer a member of ' + g.name + '.'
          : m.display_name + ' is no longer in this stokvel — they were already removed.',
      );
      await loadStokvelData();
      return;
    }

    const who = mode === 'leave' ? 'You' : impact.row.display_name;
    const remaining = impact.approvedIds.size - (impact.approvedIds.has(m.user_id) ? 1 : 0);
    const newPot = Math.round(Number(g.monthly_amount) * remaining * 100) / 100;

    // Who is up next once this person is out of the reckoning — needed both for
    // the confirm and for the prune below, and it must skip the person being
    // removed rather than pointing the rotation at a slot nobody can fill.
    const survivors = new Set(impact.approvedIds);
    survivors.delete(m.user_id);
    const { slot: survivingSlot } = nextRotationSlot(
      impact.order,
      impact.rawIndex ?? 0,
      survivors,
    );
    const upNextId = survivingSlot === null ? null : impact.order[survivingSlot];
    const nameOf = (id: string) =>
      (membersMap[g.id] || []).find((x) => x.user_id === id)?.display_name ?? 'someone';
    const inRotation = impact.order.includes(m.user_id);

    const moneyLine =
      impact.contribCount === 0
        ? who +
          (mode === 'leave' ? ' have' : ' has') +
          ' never paid anything into this stokvel, so no contribution is affected.'
        : who +
          (mode === 'leave' ? ' have ' : ' has ') +
          impact.contribCount +
          (impact.contribCount === 1 ? ' contribution' : ' contributions') +
          ' recorded here, totalling ' +
          formatCurrency(impact.contribTotal, currency) +
          '. Those STAY in the stokvel — that cash was really paid in, and ' +
          'deleting it would make All Time understate what the club has ' +
          'collected. ' +
          (mode === 'leave'
            ? 'You will no longer be able to see them.'
            : 'They will show in History as a past member. If any of them are ' +
              'wrong, delete them one by one in History first.');

    const payoutLine =
      impact.payouts.length > 0
        ? who +
          (mode === 'leave' ? ' have' : ' has') +
          ' already received ' +
          (impact.payouts.length === 1
            ? 'a payout of ' +
              formatCurrency(impact.payoutTotal, currency) +
              ' for ' +
              impact.payouts[0].month
            : impact.payouts.length +
              ' payouts totalling ' +
              formatCurrency(impact.payoutTotal, currency)) +
          '. That record stays.'
        : who +
          (mode === 'leave' ? ' have' : ' has') +
          ' never received a payout' +
          (impact.contribTotal > 0
            ? ', so the ' +
              formatCurrency(impact.contribTotal, currency) +
              ' paid in has to be settled in cash between ' +
              (mode === 'leave' ? 'you and the admin' : 'you and them') +
              ' outside the app. The app cannot move money.'
            : '.');

    const rotationLine =
      mode === 'leave'
        ? inRotation
          ? 'Your turn stays listed in the payout rotation until the admin ' +
            'rebuilds it, but the app skips over it, so nobody else’s turn ' +
            'is held up.'
          : 'You have no turn in the payout rotation, so nothing there changes.'
        : inRotation
          ? 'Their turn is taken out of the payout rotation. Everyone else keeps ' +
            'their place, and ' +
            (upNextId
              ? nameOf(upNextId) + ' is up next.'
              : 'no one is left in the rotation — you will need to rebuild it.')
          : 'They have no turn in the payout rotation, so nothing there changes.';

    const question =
      (mode === 'leave' ? 'Leave ' + g.name + '?' : 'Remove ' + impact.row.display_name + ' from ' + g.name + '?') +
      '\n\n' +
      moneyLine +
      '\n\n' +
      payoutLine +
      '\n\n' +
      rotationLine +
      '\n\n' +
      (mode === 'leave'
        ? 'You lose sight of this stokvel immediately — the group, its members, ' +
          'the totals, the bank details and your own contributions in it. You ' +
          'can ask to join again with the invite code.'
        : impact.row.display_name +
          ' loses sight of this stokvel immediately — the ledger, your bank ' +
          'details and the invite code. They can ask to join again and you ' +
          'would have to approve them.') +
      '\n\nThe monthly target and the full pot become ' +
      formatCurrency(newPot, currency) +
      ' across ' +
      remaining +
      (remaining === 1 ? ' member.' : ' members.');
    if (!confirm(question)) return;

    setMemberBusy(m.id);
    const del = await supabase
      .from('stokvel_members')
      .delete()
      .eq('id', m.id)
      .select('id');
    if (del.error || (del.data ?? []).length === 0) {
      setMemberBusy(null);
      reportWriteFailure(
        mode === 'leave'
          ? 'take you out of this stokvel — you are still a member'
          : 'remove ' + impact.row.display_name + ' from this stokvel — they are still a member',
        del.error?.message ??
          'the database accepted the request but removed nothing, so it was refused',
      );
      await loadStokvelData();
      return;
    }

    // Prune their slot. Only the owner can: stokvel_groups UPDATE is
    // `owner_id = auth.uid()`, which is why the leave path above tells the
    // member their slot stays and gets skipped instead of pretending otherwise.
    //
    // Deliberately AFTER the delete. The other order fails invisibly: if the
    // prune succeeded and the delete then failed, the member would still be in
    // the club, still paying in every month, with no turn in the rotation and
    // nothing on screen showing it. This way the worst case is a stale slot,
    // which nextRotationSlot skips and the card flags with Rebuild rotation.
    if (mode === 'remove' && inRotation) {
      const rotationFailed =
        'take ' +
        impact.row.display_name +
        "'s turn out of the payout rotation — they HAVE been removed from the " +
        'stokvel and their old turn will be skipped automatically, so nobody ' +
        'is stuck. Use Rebuild rotation on the card to tidy it up';
      // Read the order AGAIN, immediately before writing it, rather than
      // reusing the copy taken before the confirm — the owner may have sat on
      // that dialog for a minute. payout_order is written as a whole array, so
      // a stale copy silently erases anyone approved in the meantime, and an
      // erased member keeps paying in every month for a turn that never comes
      // with nothing on screen showing it.
      const fresh = await readRotation(g.id, rotationFailed);
      if (fresh && fresh.order.includes(m.user_id)) {
        const newOrder = fresh.order.filter((id) => id !== m.user_id);
        const { slot: freshSlot } = nextRotationSlot(
          fresh.order,
          fresh.rawIndex ?? 0,
          survivors,
        );
        const freshUpNext = freshSlot === null ? null : fresh.order[freshSlot];
        const newIndex = freshUpNext ? Math.max(0, newOrder.indexOf(freshUpNext)) : 0;
        const write = await supabase
          .from('stokvel_groups')
          .update({ payout_order: newOrder, current_payout_index: newIndex })
          .eq('id', g.id)
          .eq('owner_id', user.id)
          .select('id');
        // Zero rows is RLS refusing a non-owner, which ok() would report as
        // done — leaving a slot nobody can fill and the owner believing it was
        // cleaned up.
        if (write.error || (write.data ?? []).length === 0) {
          reportWriteFailure(rotationFailed, write.error?.message);
        }
      }
    }
    setMemberBusy(null);
    await loadStokvelData();
    if (mode === 'leave') {
      alert(
        'You have left ' +
          g.name +
          '. It is gone from your list, and you can no longer see anything in it.' +
          (impact.contribTotal > 0
            ? '\n\nThe ' +
              formatCurrency(impact.contribTotal, currency) +
              ' you paid in is still recorded in the stokvel for the admin to ' +
              'settle with you.'
            : ''),
      );
    }
  };

  /**
   * Put an approved member back into the pending list.
   *
   * Approve was a one-way door: `stokvel_members` UPDATE is owner-only and the
   * only update the app ever issued set `approved: true`. A mis-tap on Approve
   * — a button about four pixels from Reject on a phone — made someone a
   * permanent member with permanent sight of the ledger and the owner's bank
   * account number, and the owner's only remedy was to delete the whole
   * stokvel. This is the gentler correction: nothing is deleted, and the
   * request goes back to PENDING REQUESTS where it can be approved again.
   */
  const handleUnapproveMember = async (g: StokvelGroup, m: StokvelMember) => {
    if (!user) return;
    if (m.user_id === g.owner_id) {
      alert(
        'You are the admin of ' +
          g.name +
          ', so you cannot un-approve yourself. Everything only the admin can ' +
          'do is tied to your account.',
      );
      return;
    }
    setMemberBusy(m.id);
    const impact = await readMembershipImpact(g, m);
    setMemberBusy(null);
    if ('error' in impact) {
      reportWriteFailure(
        'check what un-approving ' +
          m.display_name +
          ' would do — nothing was changed, because it decides what the club ' +
          'thinks it has collected',
        impact.error,
      );
      return;
    }
    if ('gone' in impact) {
      alert(m.display_name + ' is no longer in this stokvel — they were already removed.');
      await loadStokvelData();
      return;
    }
    if (impact.row.approved !== true) {
      alert(
        m.display_name +
          ' is already waiting for approval — this was changed somewhere else ' +
          'since the page loaded. Nothing was changed.',
      );
      await loadStokvelData();
      return;
    }

    const remaining = impact.approvedIds.size - (impact.approvedIds.has(m.user_id) ? 1 : 0);
    const newPot = Math.round(Number(g.monthly_amount) * remaining * 100) / 100;
    const question =
      'Un-approve ' +
      impact.row.display_name +
      ' in ' +
      g.name +
      '?\n\nThey stop being a member straight away: they lose sight of the ' +
      'group, the member list, the totals, the invite code and your bank ' +
      'details, and they cannot record a contribution. Nothing is deleted — ' +
      'their request goes back to PENDING REQUESTS and you can approve them ' +
      'again.\n\n' +
      (impact.contribCount === 0
        ? 'They have not paid anything into this stokvel.'
        : 'Their ' +
          impact.contribCount +
          (impact.contribCount === 1 ? ' contribution' : ' contributions') +
          ' totalling ' +
          formatCurrency(impact.contribTotal, currency) +
          ' stay in this stokvel’s totals and history — that cash was ' +
          'really paid in — but they will not be able to see it until you ' +
          'approve them again.') +
      '\n\nThe monthly target and the full pot become ' +
      formatCurrency(newPot, currency) +
      ' across ' +
      remaining +
      (remaining === 1 ? ' member' : ' members') +
      ', and their turn in the payout rotation is skipped while they are ' +
      'un-approved.';
    if (!confirm(question)) return;

    setMemberBusy(m.id);
    const upd = await supabase
      .from('stokvel_members')
      .update({ approved: false })
      .eq('id', m.id)
      .select('id');
    setMemberBusy(null);
    // Same reason handleApproveMember checks: PostgREST reports an UPDATE that
    // matched no rows as a success, and that is precisely what a non-owner gets.
    if (upd.error || (upd.data ?? []).length === 0) {
      reportWriteFailure(
        'un-approve ' +
          impact.row.display_name +
          ' — they are still a full member of this stokvel',
        upd.error?.message ??
          'the database accepted the request but changed nothing, so it was refused. Only the stokvel admin can do this',
      );
      await loadStokvelData();
      return;
    }
    await loadStokvelData();
  };

  const openSettings = (g: StokvelGroup) => {
    setSName(g.name);
    setSAmount(String(g.monthly_amount));
    setSFrequency(g.frequency);
    setSGoal(g.goal ?? '');
    setSStart(g.start_date ?? '');
    setSEnd(g.end_date ?? '');
    setSBankRef(g.bank_reference ?? '');
    setSError('');
    setSettingsTarget(g);
  };

  /**
   * Save group settings.
   *
   * Nothing in the app wrote name, monthly_amount, frequency, the dates or
   * bank_reference after creation — the only stokvel_groups updates were
   * payout_order, current_payout_index and delete. So a mistyped account number
   * stayed on the card that every member reads before sending real money, and a
   * club that voted to raise its contribution had the old figure quoted forever
   * in the stat tile, the monthly target, the pot and the reminder push.
   */
  const handleSaveSettings = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!user || !settingsTarget) return;
    const g = settingsTarget;
    const name = sName.trim();
    if (!name) {
      setSError('The stokvel needs a name — every member sees it.');
      return;
    }
    const parsedAmount = parseFloat(sAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setSError('Enter a valid monthly contribution greater than zero.');
      return;
    }
    const amount = Math.round(parsedAmount * 100) / 100;
    if (sStart && sEnd && sEnd < sStart) {
      setSError('The end date is before the start date.');
      return;
    }
    setSBusy(true);
    setSError('');
    try {
      // Read the row and the roll before quoting any of it back. The confirm
      // states what each member will be asked to pay and what the pot becomes,
      // and both have to be the live figures — the card's copy could be from
      // before another admin device changed them.
      const [cur, membersRes] = await Promise.all([
        supabase
          .from('stokvel_groups')
          .select('name, monthly_amount, frequency, goal, start_date, end_date, bank_reference')
          .eq('id', g.id)
          .maybeSingle(),
        supabase.from('stokvel_members').select('user_id, approved').eq('stokvel_id', g.id),
      ]);
      if (cur.error || membersRes.error) {
        setSError(
          'Could not read this stokvel before changing it: ' +
            (cur.error ?? membersRes.error)?.message +
            '. Nothing was changed.',
        );
        setSBusy(false);
        return;
      }
      if (!cur.data) {
        setSError('This stokvel is no longer there. Nothing was changed.');
        setSBusy(false);
        return;
      }
      const live = cur.data as {
        name: string;
        monthly_amount: number;
        frequency: 'monthly' | 'yearly';
        goal: string | null;
        start_date: string | null;
        end_date: string | null;
        bank_reference: string | null;
      };
      const approvedCount = ((membersRes.data ?? []) as { approved: boolean | null }[]).filter(
        (m) => m.approved === true,
      ).length;

      const liveAmount = Number(live.monthly_amount);
      const changes: string[] = [];
      if (live.name !== name) {
        // The rename itself is safe for the stokvel's own ledger, but each
        // contribution also writes a personal `expenses` row described by the
        // group NAME, and reconcileOwnExpense matches on the current name. So
        // rows recorded under the old name stop being found — editing or
        // deleting an old contribution will no longer adjust the member's own
        // budget. Say so rather than let it be discovered later as a quiet
        // mismatch between two totals.
        changes.push(
          '• Name: "' +
            live.name +
            '" → "' +
            name +
            '"\n    Contributions already recorded under the old name stay in ' +
            'this stokvel exactly as they are, but they will no longer be ' +
            'matched to the copy in each member’s personal expenses — so ' +
            'correcting one of those older contributions later will not update ' +
            'their own budget too.',
        );
      }
      if (liveAmount !== amount) {
        changes.push(
          '• Monthly contribution per person: ' +
            formatCurrency(liveAmount, currency) +
            ' → ' +
            formatCurrency(amount, currency) +
            '\n    Every member is now asked for the new amount. With ' +
            approvedCount +
            (approvedCount === 1 ? ' approved member' : ' approved members') +
            ' the full pot goes from ' +
            formatCurrency(Math.round(liveAmount * approvedCount * 100) / 100, currency) +
            ' to ' +
            formatCurrency(Math.round(amount * approvedCount * 100) / 100, currency) +
            ' a month.\n    Contributions and payouts already recorded are NOT ' +
            'changed — this applies from now on. Tell your members before you ' +
            'save: this is the cash they each hand over.',
        );
      }
      if (live.frequency !== sFrequency) {
        changes.push(
          '• Payout frequency: ' +
            live.frequency +
            ' → ' +
            sFrequency +
            (sFrequency === 'yearly'
              ? '\n    The rotating payout controls (Next payout, Mark Paid Out, ' +
                'Skip turn) disappear, and a yearly stokvel has no other way to ' +
                'record a payout yet. Payouts already recorded stay in History.'
              : '\n    The rotating payout controls come back, picking up from ' +
                "whoever the rotation is currently pointing at."),
        );
      }
      if ((live.goal ?? '') !== sGoal) {
        changes.push('• Goal: "' + (live.goal ?? '') + '" → "' + sGoal + '"');
      }
      if ((live.start_date ?? '') !== sStart) {
        changes.push('• Start date: ' + (live.start_date ?? 'none') + ' → ' + (sStart || 'none'));
      }
      if ((live.end_date ?? '') !== sEnd) {
        changes.push(
          '• End date: ' +
            (live.end_date ?? 'none') +
            ' → ' +
            (sEnd || 'none') +
            '\n    A stokvel past its end date is shown as ENDED to everyone.',
        );
      }
      if ((live.bank_reference ?? '') !== sBankRef) {
        changes.push(
          '• EFT payment details: "' +
            (live.bank_reference ?? '') +
            '" → "' +
            sBankRef +
            '"\n    THIS IS THE LINE EVERY MEMBER READS BEFORE SENDING REAL ' +
            'MONEY. Check it against your bank app character by character — a ' +
            'wrong number sends their contributions to a stranger.',
        );
      }

      if (changes.length === 0) {
        setSettingsTarget(null);
        setSBusy(false);
        return;
      }
      if (
        !confirm(
          'Save these changes to ' +
            live.name +
            '?\n\n' +
            changes.join('\n\n') +
            '\n\nEvery member sees this straight away.',
        )
      ) {
        setSBusy(false);
        return;
      }

      const write = await supabase
        .from('stokvel_groups')
        .update({
          name,
          monthly_amount: amount,
          frequency: sFrequency,
          goal: sGoal,
          start_date: sStart || null,
          end_date: sEnd || null,
          bank_reference: sBankRef,
        })
        .eq('id', g.id)
        .eq('owner_id', user.id)
        .select('id');
      if (write.error) {
        setSError('Could not save these settings: ' + write.error.message);
        setSBusy(false);
        return;
      }
      // A zero-row update is what RLS returns to anyone who is not the owner,
      // and ok() would report it as saved — leaving the wrong bank details on
      // the card while the owner believed they had corrected them.
      if ((write.data ?? []).length === 0) {
        setSError(
          'The database accepted the change but saved nothing. Only the admin ' +
            'of this stokvel can change its settings, so nothing was changed.',
        );
        setSBusy(false);
        return;
      }
      setSettingsTarget(null);
      await loadStokvelData();
    } catch (err) {
      console.error('Stokvel settings error:', err);
      setSError('Error saving these settings. Close this and check the card before retrying.');
    }
    setSBusy(false);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
  };

  // ============================================================
  // Derived data for rendering
  // ============================================================
  const currentMonth = monthKey();
  const todayStr = todayIso();

  return (
    <>
      <section className="page active" id="page-stokvel">
        <div className="page-header">
          <div>
            <h1>Stokvel</h1>
            <p className="page-subtitle">Track your group savings contributions</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-primary btn-sm"
              id="addStokvelBtn"
              onClick={openCreate}
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
              Create
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              id="joinStokvelBtn"
              style={{ background: 'rgba(128,128,128,0.12)' }}
              onClick={openJoin}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4m-5-4l5-5-5-5m5 5H3" />
              </svg>
              Join
            </button>
          </div>
        </div>

        {/* Result of the last join attempt. The group cannot appear in the
            list while approval is pending, so this banner is the only thing
            that tells the user the request actually landed. */}
        {joinNotice && (
          <div
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 10,
              padding: 10,
              margin: '8px 0',
              fontSize: '0.85rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'start',
              gap: 8,
            }}
          >
            <span>{joinNotice}</span>
            <button
              type="button"
              onClick={() => setJoinNotice('')}
              aria-label="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                opacity: 0.5,
                cursor: 'pointer',
                fontSize: '1rem',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* A failed groups read is stated, never rendered as "you have no
            stokvels". That message told a member on a dropped connection they
            had been removed from their club and their money was gone. */}
        {groupsError && (
          <p
            className="auth-error"
            style={{ color: '#ef4444', fontSize: '0.85rem', margin: '8px 0' }}
          >
            {groupsError}
          </p>
        )}

        {/* A failed pending-read is stated, never rendered as "nothing here" */}
        {pendingError && (
          <p
            className="auth-error"
            style={{ color: '#ef4444', fontSize: '0.85rem', margin: '8px 0' }}
          >
            {pendingError}
          </p>
        )}

        {/* Stokvel Groups */}
        <div id="stokvelGroups" className="stokvel-grid">
          {groups.map((g) => {
            // `undefined` here means NOT KNOWN — the read failed, or has not
            // come back yet. It is not the same as "there are none", and the
            // old `|| []` erased the difference: a member on a flaky
            // connection was told "This Month R0 / All Time R0" with a red
            // cross against their own name, as a statement of fact, and
            // reasonably concluded their R500 was lost. Everything below
            // renders "not loaded" for the unknown case instead of a zero.
            const memberRows = membersMap[g.id];
            const contribRows = contribsMap[g.id];
            const membersKnown = memberRows !== undefined;
            const contribsKnown = contribRows !== undefined;
            const membersError = membersErrors[g.id] || '';
            const contribsError = contribsErrors[g.id] || '';
            const members = memberRows ?? [];
            const contribs = contribRows ?? [];
            const approvedMembers = members.filter((m) => m.approved);
            const pendingMembers = members.filter((m) => !m.approved);
            const isOwner = user ? g.owner_id === user.id : false;

            // Belt and braces. `is_stokvel_member` now requires `approved is
            // true`, so a group this user is only pending in should never
            // reach here — but if it ever does, show the waiting card instead
            // of the full one rather than leaking the ledger, the invite code
            // and the owner's bank details to someone who has not been let in.
            // Written as "we can see a member row of mine and it says not
            // approved" so that a members read which failed (`?? []`) leaves a
            // legitimate member's card alone instead of silently downgrading it.
            const myRow = user ? members.find((m) => m.user_id === user.id) : undefined;
            const iAmPendingHere = !isOwner && !!myRow && myRow.approved !== true;
            if (iAmPendingHere) {
              return (
                <PendingStokvelCard
                  key={g.id}
                  name={g.name}
                  monthlyAmount={g.monthly_amount}
                  currency={currency}
                  joinedAt={null}
                />
              );
            }

            const totalContrib = cents(contribs.reduce((s, c) => s + Number(c.amount), 0));

            const thisMonthContribs = contribs.filter(
              (c) => c.date && c.date.substring(0, 7) === currentMonth,
            );
            const thisMonthTotal = cents(
              thisMonthContribs.reduce((s, c) => s + Number(c.amount), 0),
            );
            const monthTarget = cents(Number(g.monthly_amount) * approvedMembers.length);
            const monthPct =
              monthTarget > 0 ? Math.min(100, (thisMonthTotal / monthTarget) * 100) : 0;
            // A percentage computed from figures we do not have is a lie with a
            // decimal point on it.
            const progressKnown = contribsKnown && membersKnown;

            // How much each member has paid this period, not merely whether a
            // row exists. The old Record<string, boolean> gave R50 against a
            // R500 obligation the same green tick as R500 and dropped that
            // member out of the treasurer's Confirm Payments list, so nobody
            // ever chased the missing R450 — the only hint was a progress bar
            // sitting at 91% with nothing drawing attention to it.
            const paidByUser: Record<string, number> = {};
            for (const c of thisMonthContribs) {
              paidByUser[c.user_id] = (paidByUser[c.user_id] ?? 0) + Number(c.amount);
            }
            const owedEach = cents(Number(g.monthly_amount));
            const myPaidThisMonth =
              contribsKnown && user ? cents(paidByUser[user.id] ?? 0) : null;
            const myPaidCount =
              contribsKnown && user
                ? thisMonthContribs.filter((c) => c.user_id === user.id).length
                : 0;
            const myState = paidState(myPaidThisMonth, owedEach);

            // Resolve the turn by skipping over ids that are no longer approved
            // members, rather than reading one slot and rendering nothing when
            // it misses. See nextRotationSlot — one stale uuid used to remove
            // the Next payout line and the Mark Paid Out button from the card
            // silently and end the rotation permanently.
            const payoutOrder = g.payout_order || [];
            const curPayoutIdx = g.current_payout_index || 0;
            const approvedIdSet = new Set(approvedMembers.map((m) => m.user_id));
            const { slot: payoutSlot, skipped: payoutSkipped } = nextRotationSlot(
              payoutOrder,
              curPayoutIdx,
              approvedIdSet,
            );
            const nextRecipient =
              payoutSlot === null
                ? undefined
                : approvedMembers.find((m) => m.user_id === payoutOrder[payoutSlot]);
            // Approved members with no slot at all. Invisible before this:
            // they pay in every month and their turn simply never arrives.
            const notInRotation = approvedMembers.filter(
              (m) => !payoutOrder.includes(m.user_id),
            );
            const rotationNeedsRepair =
              payoutSlot === null || payoutSkipped > 0 || notInRotation.length > 0;

            // See hasEnded: the old `new Date(g.end_date) < new Date()` parsed
            // the date column as UTC midnight and compared it to the local
            // instant, so this went red and said "(ENDED)" from 02:00 SAST on
            // the group's final day, to every member at once.
            const isExpired = hasEnded(g.end_date, todayStr);

            return (
              <div className="stokvel-card" key={g.id}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'start',
                  }}
                >
                  <div>
                    <h3>{g.name}</h3>
                    {g.goal && <div className="stokvel-goal">{g.goal}</div>}
                  </div>
                  {isOwner && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      {/* Settings was not a screen at all: nothing in the app
                          ever updated name, monthly_amount, frequency, the
                          dates or bank_reference, so the only way to fix a
                          mistyped bank account number — the string every
                          member reads before sending real money — was Delete,
                          which cascades every member's contribution history
                          away with it. Sits here rather than in
                          `.stokvel-actions`, whose `flex: 1` would squeeze a
                          fourth button's label onto two lines. */}
                      <button
                        type="button"
                        className="btn-edit-stokvel"
                        onClick={() => openSettings(g)}
                        style={{
                          background: 'rgba(128,128,128,0.12)',
                          border: 'none',
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          opacity: 0.6,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Settings
                      </button>
                      <div
                        style={{
                          background: 'rgba(16,185,129,0.15)',
                          color: '#10b981',
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                        }}
                      >
                        ADMIN
                      </div>
                    </div>
                  )}
                </div>

                {(g.start_date || g.end_date) && (
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: isExpired ? '#ef4444' : undefined,
                      opacity: isExpired ? undefined : 0.4,
                      margin: '4px 0',
                    }}
                  >
                    {g.start_date}
                    {g.start_date && g.end_date && ' → '}
                    {g.end_date}
                    {isExpired && ' (ENDED)'}
                  </div>
                )}

                {isOwner && g.stokvel_code && (
                  <div
                    style={{
                      background: 'rgba(16,185,129,0.08)',
                      border: '1px solid rgba(16,185,129,0.2)',
                      borderRadius: 10,
                      padding: 10,
                      margin: '8px 0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '0.65rem',
                          opacity: 0.4,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        Invite Code
                      </div>
                      <div
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 700,
                          letterSpacing: '2px',
                          color: '#10b981',
                        }}
                      >
                        {g.stokvel_code}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-copy-code"
                      onClick={() => handleCopyCode(g.stokvel_code)}
                      style={{
                        background: 'rgba(128,128,128,0.1)',
                        border: 'none',
                        opacity: 0.5,
                        padding: '6px 10px',
                        borderRadius: 8,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedCode === g.stokvel_code ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}

                {/* A finished stokvel says so once, plainly. `end_date` used to
                    be read for the red "(ENDED)" label and nothing else, so a
                    12-month club that closed in December carried on pushing
                    "your contribution of R1,000 is due this month" at its
                    members in January and every month after. The reminder is
                    now gated on this; the figures stay on screen because the
                    final period still has to be reconciled. */}
                {isExpired && (
                  <div
                    style={{
                      background: 'rgba(128,128,128,0.06)',
                      borderRadius: 10,
                      padding: 10,
                      margin: '8px 0',
                      fontSize: '0.8rem',
                      lineHeight: 1.5,
                      opacity: 0.8,
                    }}
                  >
                    This stokvel ended on {g.end_date}. Nobody is reminded to pay
                    into it any more. What is below is its closing record — still
                    editable, so a final payment can be settled and any mistake
                    corrected.
                  </div>
                )}

                {/* A read that failed says so, here, next to the figures it
                    would otherwise have silently zeroed. */}
                {(membersError || contribsError) && (
                  <div
                    style={{
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: 10,
                      padding: 10,
                      margin: '8px 0',
                      fontSize: '0.8rem',
                      lineHeight: 1.5,
                      color: '#ef4444',
                    }}
                  >
                    {contribsError && (
                      <div>
                        Could not load this stokvel&rsquo;s contributions:{' '}
                        {contribsError}
                      </div>
                    )}
                    {membersError && (
                      <div>
                        Could not load this stokvel&rsquo;s members: {membersError}
                      </div>
                    )}
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                      {contribsKnown || membersKnown
                        ? 'The figures below are from the last load that worked, so ' +
                          'they may be out of date. Nothing has been lost.'
                        : 'Nothing has been lost — we simply could not read it. ' +
                          'Reload before recording or confirming any payment.'}
                    </div>
                  </div>
                )}

                {/* Every money figure goes through formatCurrency. A bare
                    toLocaleString() defaults minimumFractionDigits to 0, so
                    R12,340.50 rendered as "R12 340,5" on the card while the
                    History modal showed "R12 340,50" for the same money, and a
                    member reconciling against a bank statement could not tell
                    which cents figure the app meant. */}
                <div className="stokvel-stats">
                  <div>
                    <div className="stokvel-stat-label">Monthly/Person</div>
                    <div className="stokvel-stat-value">
                      {formatCurrency(Number(g.monthly_amount), currency)}
                    </div>
                  </div>
                  <div>
                    <div className="stokvel-stat-label">Members</div>
                    <div className="stokvel-stat-value">
                      {membersKnown ? approvedMembers.length : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="stokvel-stat-label">This Month</div>
                    <div className="stokvel-stat-value">
                      {contribsKnown ? formatCurrency(thisMonthTotal, currency) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="stokvel-stat-label">All Time</div>
                    <div className="stokvel-stat-value">
                      {contribsKnown ? formatCurrency(totalContrib, currency) : '—'}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.7rem',
                    opacity: 0.4,
                    marginBottom: 4,
                  }}
                >
                  <span>This month</span>
                  {/* An empty bar at 0% is a claim that nobody has paid.
                      Withhold it rather than assert it from figures we do not
                      have. */}
                  <span>
                    {progressKnown
                      ? monthPct.toFixed(0) + '%'
                      : 'not loaded'}
                  </span>
                </div>
                {progressKnown && (
                  <>
                    <div className="stokvel-progress">
                      <div
                        className="stokvel-progress-bar"
                        style={{ width: `${monthPct.toFixed(0)}%` }}
                      />
                    </div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.4, marginTop: 4 }}>
                      {formatCurrency(thisMonthTotal, currency)} of{' '}
                      {formatCurrency(monthTarget, currency)} in for {currentMonth}
                    </div>
                  </>
                )}

                {/* Next payout.
                    No longer gated on `nextRecipient` being truthy: an
                    unresolvable rotation must say so, not vanish. */}
                {g.frequency === 'monthly' && (() => {
                  const isMe =
                    !!nextRecipient && !!user && nextRecipient.user_id === user.id;
                  // Both numbers, side by side. The theoretical pot and the cash
                  // actually in it used to sit inches apart on this card with
                  // nothing linking them — "This Month R3,000" directly above
                  // "Next payout R5,000" — and it was the R5,000 that got
                  // recorded as paid.
                  const potTarget = cents(Number(g.monthly_amount) * approvedMembers.length);
                  // null = the contributions read has not landed or failed. A
                  // "Paid in so far R0.00" under a live Mark Paid Out button is
                  // the worst possible thing to be wrong about on this card.
                  const collected = contribsKnown ? thisMonthTotal : null;
                  const shortfall =
                    collected === null || !membersKnown ? null : cents(potTarget - collected);
                  return (
                    <div
                      style={{
                        background: isMe
                          ? 'rgba(16,185,129,0.12)'
                          : 'rgba(128,128,128,0.06)',
                        borderRadius: 10,
                        padding: 10,
                        margin: '8px 0',
                        fontSize: '0.85rem',
                      }}
                    >
                      {nextRecipient ? (
                        <>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div>
                              <span className="stokvel-goal">Next payout:</span>{' '}
                              <strong style={{ color: isMe ? '#10b981' : 'inherit' }}>
                                {nextRecipient.display_name}
                                {isMe ? ' (You!)' : ''}
                              </strong>
                            </div>
                            {isOwner && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  type="button"
                                  className="btn-advance-payout"
                                  disabled={payoutOpening === g.id}
                                  onClick={() => openPayout(g, nextRecipient)}
                                  style={{
                                    background: '#10b981',
                                    color: '#fff',
                                    border: 'none',
                                    padding: '6px 12px',
                                    borderRadius: 8,
                                    fontSize: '0.7rem',
                                    cursor: payoutOpening === g.id ? 'default' : 'pointer',
                                    opacity: payoutOpening === g.id ? 0.6 : 1,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {payoutOpening === g.id ? 'Checking…' : 'Mark Paid Out'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-skip-payout"
                                  onClick={() => handleSkipTurn(g, nextRecipient)}
                                  style={{
                                    background: 'rgba(128,128,128,0.12)',
                                    border: 'none',
                                    padding: '6px 12px',
                                    borderRadius: 8,
                                    fontSize: '0.7rem',
                                    cursor: 'pointer',
                                    opacity: 0.7,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  Skip turn
                                </button>
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              display: 'flex',
                              gap: 12,
                              flexWrap: 'wrap',
                              fontSize: '0.8rem',
                            }}
                          >
                            <span style={{ opacity: 0.7 }}>
                              Full pot{' '}
                              <strong>
                                {membersKnown
                                  ? formatCurrency(potTarget, currency)
                                  : 'not loaded'}
                              </strong>
                            </span>
                            <span
                              style={{
                                color:
                                  shortfall === null
                                    ? '#ef4444'
                                    : shortfall > 0
                                      ? '#f59e0b'
                                      : '#10b981',
                              }}
                            >
                              Paid in so far{' '}
                              <strong>
                                {collected === null
                                  ? 'not loaded'
                                  : formatCurrency(collected, currency)}
                              </strong>
                            </span>
                          </div>
                          {shortfall === null && isOwner && (
                            <div
                              style={{ marginTop: 4, fontSize: '0.75rem', color: '#ef4444' }}
                            >
                              Reload before recording a payout — we could not read
                              what has actually been paid in this month.
                            </div>
                          )}
                          {shortfall !== null && shortfall > 0 && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: '0.75rem',
                                color: '#f59e0b',
                              }}
                            >
                              {formatCurrency(shortfall, currency)} of this month&rsquo;s
                              pot has not been paid in yet.
                            </div>
                          )}
                          {payoutSkipped > 0 && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: '0.75rem',
                                color: '#f59e0b',
                              }}
                            >
                              {payoutSkipped}{' '}
                              {payoutSkipped === 1 ? 'earlier turn' : 'earlier turns'} in
                              the rotation {payoutSkipped === 1 ? 'belongs' : 'belong'} to
                              people who have left this stokvel and{' '}
                              {payoutSkipped === 1 ? 'was' : 'were'} skipped.
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ color: '#f59e0b' }}>
                          {/* The members read failing produces exactly the same
                              inputs as everyone having left — approvedMembers
                              is [], so nextRotationSlot returns null. Saying
                              "there is nobody to pay out to" in that case is a
                              confident claim about the club's state built on a
                              read that never arrived, and it invites an owner
                              to Rebuild a rotation that was never broken.
                              Every other figure in this block is already gated
                              on membersKnown; this was the one that was not. */}
                          {!membersKnown ? (
                            <>
                              <strong>The member list could not be loaded.</strong>
                              <div style={{ marginTop: 4, fontSize: '0.8rem' }}>
                                So we cannot work out whose turn it is. This does not
                                mean anything is wrong with the rotation — try again
                                once your connection is back.
                              </div>
                            </>
                          ) : (
                            <>
                              <strong>The payout rotation needs attention.</strong>
                              <div style={{ marginTop: 4, fontSize: '0.8rem' }}>
                                {payoutOrder.length === 0
                                  ? 'Nobody has a turn set up yet, so no payout can be recorded.'
                                  : 'Every turn in the rotation belongs to someone who is no ' +
                                    'longer a member of this stokvel, so there is nobody to ' +
                                    'pay out to.'}
                                {isOwner
                                  ? ' Rebuild it below to put the current members back in order.'
                                  : ' The admin needs to rebuild it before the next payout can be recorded.'}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {notInRotation.length > 0 && (
                        <div
                          style={{ marginTop: 6, fontSize: '0.75rem', color: '#f59e0b' }}
                        >
                          {notInRotation.map((m) => m.display_name).join(', ')}{' '}
                          {notInRotation.length === 1 ? 'is a member' : 'are members'} but{' '}
                          {notInRotation.length === 1 ? 'has' : 'have'} no turn in the
                          rotation, so their payout will never come up.
                        </div>
                      )}
                      {isOwner && rotationNeedsRepair && (
                        <button
                          type="button"
                          className="btn-repair-rotation"
                          onClick={() => handleRepairRotation(g)}
                          style={{
                            marginTop: 8,
                            background: 'rgba(245,158,11,0.15)',
                            color: '#f59e0b',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: 8,
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Rebuild rotation
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Members list with what each has paid against what they owe.
                    This used to be a bare green tick or red cross driven by
                    "does a row exist", so R50 against a R500 obligation looked
                    identical to R500 and took the member off the treasurer's
                    chase list. It also drew a red cross for everybody whenever
                    the contributions read failed — a member being told, as
                    fact, that they had not paid. */}
                <div style={{ margin: '8px 0' }}>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      opacity: 0.4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    }}
                  >
                    Members
                  </div>
                  {!membersKnown && (
                    <div style={{ fontSize: '0.85rem', color: '#ef4444', padding: '4px 0' }}>
                      The member list could not be loaded.
                    </div>
                  )}
                  {approvedMembers.map((m) => {
                    const paid = contribsKnown ? cents(paidByUser[m.user_id] ?? 0) : null;
                    const state = paidState(paid, owedEach);
                    const marker =
                      state === 'full'
                        ? { glyph: '✓', color: '#10b981' }
                        : state === 'partial'
                          ? { glyph: '◐', color: '#f59e0b' }
                          : state === 'none'
                            ? { glyph: '✗', color: '#ef4444' }
                            : { glyph: '?', color: 'rgba(128,128,128,0.7)' };
                    const isMe = user ? m.user_id === user.id : false;
                    // The admin's own membership is the one that cannot go
                    // while the group exists — every owner-only policy is
                    // `owner_id = auth.uid()`, so a stokvel with no admin can
                    // never approve anyone, record a payout or be corrected
                    // again. Tested on owner_id rather than `role`, which is a
                    // nullable text column nothing enforces.
                    const isTheAdmin = m.user_id === g.owner_id;
                    const busy = memberBusy === m.id;
                    // Owner can un-approve or remove anyone else; anyone can
                    // remove themselves. Both were already permitted by
                    // `stokvel_members` RLS and neither had a control, which is
                    // why an approval could never be taken back.
                    const canManage = isOwner && !isTheAdmin;
                    const canLeave = isMe && !isTheAdmin;
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 0',
                          fontSize: '0.85rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ color: marker.color, fontSize: '1rem' }}>
                          {marker.glyph}
                        </span>
                        <span
                          style={{
                            color: isMe ? 'var(--accent)' : 'inherit',
                            fontWeight: isMe ? 600 : 400,
                          }}
                        >
                          {m.display_name}
                          {isMe ? ' (You)' : ''}
                        </span>
                        {/* Say the numbers. A partial payer used to be
                            indistinguishable from someone who had paid in
                            full, so the missing balance was never chased. */}
                        <span style={{ fontSize: '0.7rem', opacity: 0.55 }}>
                          {state === 'unknown'
                            ? 'not loaded'
                            : state === 'partial' && paid !== null
                              ? formatCurrency(paid, currency) +
                                ' of ' +
                                formatCurrency(owedEach, currency)
                              : state === 'none'
                                ? formatCurrency(owedEach, currency) + ' due'
                                : paid !== null && paid > owedEach
                                  ? formatCurrency(paid, currency) + ' paid'
                                  : 'paid'}
                        </span>
                        {state === 'partial' && paid !== null && (
                          <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>
                            {formatCurrency(cents(owedEach - paid), currency)} short
                          </span>
                        )}
                        {/* Was `m.role === 'owner'`. `role` is a nullable text
                            column nothing enforces and nothing keeps in step
                            with ownership, so it could label the wrong person
                            as the one who approves members and hands out the
                            pot — while the controls beside it are driven by
                            owner_id. One test, everywhere. */}
                        {isTheAdmin && (
                          <span
                            style={{ fontSize: '0.65rem', opacity: 0.3 }}
                          >
                            admin
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        {(canManage || canLeave) && (
                          <span style={{ display: 'flex', gap: 4 }}>
                            {canManage && (
                              <button
                                type="button"
                                className="btn-unapprove-member"
                                disabled={busy}
                                onClick={() => handleUnapproveMember(g, m)}
                                style={{
                                  background: 'rgba(245,158,11,0.15)',
                                  color: '#f59e0b',
                                  border: 'none',
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: '0.7rem',
                                  cursor: busy ? 'default' : 'pointer',
                                  opacity: busy ? 0.5 : 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Un-approve
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="btn-remove-member"
                                disabled={busy}
                                onClick={() => handleRemoveMember(g, m, 'remove')}
                                style={{
                                  background: 'rgba(239,68,68,0.15)',
                                  color: '#ef4444',
                                  border: 'none',
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: '0.7rem',
                                  cursor: busy ? 'default' : 'pointer',
                                  opacity: busy ? 0.5 : 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Remove
                              </button>
                            )}
                            {canLeave && (
                              <button
                                type="button"
                                className="btn-leave-stokvel"
                                disabled={busy}
                                onClick={() => handleRemoveMember(g, m, 'leave')}
                                style={{
                                  background: 'rgba(239,68,68,0.15)',
                                  color: '#ef4444',
                                  border: 'none',
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: '0.7rem',
                                  cursor: busy ? 'default' : 'pointer',
                                  opacity: busy ? 0.5 : 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Leave
                              </button>
                            )}
                          </span>
                        )}
                        {/* Say why the admin has no Leave button instead of
                            showing one that cannot work: removing the admin's
                            membership would leave a live group nobody can
                            administer, and the delete would half-succeed
                            because ownership is not the membership row. */}
                        {isMe && isTheAdmin && (
                          <span style={{ fontSize: '0.65rem', opacity: 0.4 }}>
                            you run this — use Delete to end it
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pending requests (owner only) */}
                {isOwner && pendingMembers.length > 0 && (
                  <div
                    style={{
                      margin: '8px 0',
                      padding: 10,
                      background: 'rgba(245,158,11,0.08)',
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: '#f59e0b',
                        fontWeight: 600,
                        marginBottom: 6,
                      }}
                    >
                      PENDING REQUESTS
                    </div>
                    {pendingMembers.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                        }}
                      >
                        <span style={{ fontSize: '0.85rem' }}>{m.display_name}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {/* Disabled while ANY approve/reject on the page is
                              in flight, not just this row's: two Approves for
                              different members inside one round-trip is exactly
                              what drops a member out of payout_order. */}
                          <button
                            type="button"
                            className="btn-approve-member"
                            disabled={memberBusy !== null || rotationBusy}
                            onClick={() => handleApproveMember(m.id, g.id, m.user_id)}
                            style={{
                              background: '#10b981',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: '0.75rem',
                              cursor:
                                memberBusy !== null || rotationBusy ? 'not-allowed' : 'pointer',
                              opacity: memberBusy !== null || rotationBusy ? 0.55 : 1,
                            }}
                          >
                            {memberBusy === m.id ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="btn-reject-member"
                            disabled={memberBusy !== null || rotationBusy}
                            onClick={() => handleRejectMember(m.id, g.name)}
                            style={{
                              background: 'rgba(239,68,68,0.15)',
                              color: '#ef4444',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: '0.75rem',
                              cursor:
                                memberBusy !== null || rotationBusy ? 'not-allowed' : 'pointer',
                              opacity: memberBusy !== null || rotationBusy ? 0.55 : 1,
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bank reference */}
                {g.bank_reference && (
                  <div
                    style={{
                      background: 'rgba(59,130,246,0.08)',
                      border: '1px solid rgba(59,130,246,0.2)',
                      borderRadius: 10,
                      padding: 10,
                      margin: '8px 0',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.65rem',
                        opacity: 0.4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      EFT Payment Details
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: '#60a5fa',
                        fontWeight: 500,
                        marginTop: 4,
                      }}
                    >
                      {g.bank_reference}
                    </div>
                    <div
                      style={{
                        fontSize: '0.7rem',
                        opacity: 0.3,
                        marginTop: 2,
                      }}
                    >
                      Use reference: <strong>{g.stokvel_code}</strong>
                    </div>
                  </div>
                )}

                {/* Admin: confirm payments.
                    Gated on the contributions read having actually landed. A
                    failed read used to repopulate this list with every member
                    — including everyone who had already paid — and each tap
                    wrote a real duplicate contribution nothing in the app could
                    undo. "We do not know who has paid" must not render as "no
                    one has paid". */}
                {isOwner &&
                  contribsKnown &&
                  membersKnown &&
                  (() => {
                    // Partial payers belong here too. Filtering on "has any row
                    // at all" removed a member who had sent R50 of R500 from the
                    // chase list entirely, so the outstanding R450 was never
                    // asked for by anybody.
                    const owing = approvedMembers
                      .map((m) => ({
                        m,
                        paid: cents(paidByUser[m.user_id] ?? 0),
                      }))
                      .filter(
                        (r) =>
                          owedEach > 0 &&
                          r.paid < owedEach &&
                          (user ? r.m.user_id !== user.id : true),
                      );
                    if (owing.length === 0) return null;
                    return (
                      <div style={{ margin: '8px 0' }}>
                        <div
                          style={{
                            fontSize: '0.7rem',
                            opacity: 0.4,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            marginBottom: 6,
                          }}
                        >
                          Confirm Payments
                        </div>
                        {owing.map(({ m, paid }) => (
                          <div
                            key={m.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              padding: '4px 0',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ fontSize: '0.85rem' }}>
                              {m.display_name}
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  opacity: 0.55,
                                  marginLeft: 6,
                                }}
                              >
                                {paid > 0
                                  ? formatCurrency(paid, currency) +
                                    ' of ' +
                                    formatCurrency(owedEach, currency) +
                                    ' in'
                                  : 'nothing in yet'}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="btn-confirm-paid"
                              disabled={confirmBusy === m.id}
                              onClick={() => handleConfirmPaid(g, m)}
                              style={{
                                background: '#10b981',
                                color: '#fff',
                                border: 'none',
                                padding: '4px 12px',
                                borderRadius: 6,
                                fontSize: '0.75rem',
                                cursor: confirmBusy === m.id ? 'default' : 'pointer',
                                opacity: confirmBusy === m.id ? 0.6 : 1,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {confirmBusy === m.id
                                ? 'Checking…'
                                : 'Confirm ' +
                                  formatCurrency(cents(owedEach - paid), currency) +
                                  ' paid'}
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                {/* Actions.
                    Contribute and History carried no membership check at all,
                    which is how an unapproved joiner was able to read the whole
                    ledger and write real money into it. They need no explicit
                    gate here now only because everything below the
                    `iAmPendingHere` early return above is unreachable unless
                    this user owns the group or is an approved member of it —
                    if you add a control here, that early return is the gate it
                    relies on. */}
                {/* Already settled for the period, so the primary call to
                    action goes away. The old card offered "+ Contribute" to
                    everyone unconditionally, including a member the treasurer
                    had already ticked off the bank statement with Confirm Paid
                    — and because Confirm Paid deliberately cannot write to
                    that member's personal budget, the member opens the app,
                    sees the expense missing, and taps Contribute for money
                    that is already in the ledger.

                    The muted "record another" is kept rather than removed
                    outright: a member who genuinely pays twice in a month, or
                    who is catching up a previous month, still has to be able
                    to record it, and taking the only route away would just
                    push that into an unfixable gap. It is no longer the
                    obvious thing to press, and handleContribute reads the
                    period from the database and states what is already on
                    record before it writes anything. */}
                <div className="stokvel-actions">
                  {myState === 'full' ? (
                    <button
                      type="button"
                      className="btn-contrib"
                      onClick={() => openContribute(g, myPaidThisMonth, myPaidCount)}
                      style={{ background: 'rgba(128,128,128,0.1)', opacity: 0.7 }}
                    >
                      Paid ✓ — record another
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-contrib"
                      onClick={() => openContribute(g, myPaidThisMonth, myPaidCount)}
                    >
                      {myState === 'partial' ? '+ Pay the rest' : '+ Contribute'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-view-stokvel"
                    onClick={() => setDetailTarget(g.id)}
                    style={{
                      background: 'rgba(128,128,128,0.1)',
                      opacity: 0.7,
                    }}
                  >
                    History
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn-delete-stokvel"
                      onClick={() => handleDeleteStokvel(g.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Groups this user has asked to join but is not in yet. These are
              not in `groups` and cannot be — the database returns nothing
              about a group you are not approved for — so they are rendered
              from the RPC's name + amount and nothing else. Skip any that a
              group card already covered so a single stokvel never draws twice. */}
          {pendingMemberships
            .filter((p) => !groups.some((g) => g.id === p.stokvel_id))
            .map((p) => (
              <PendingStokvelCard
                key={p.stokvel_id}
                name={p.group_name}
                monthlyAmount={p.monthly_amount}
                currency={currency}
                joinedAt={p.joined_at}
              />
            ))}
        </div>

        {/* "No stokvels yet" would be a lie to someone whose join request is
            sitting in an admin's pending list, and it is the message that
            makes people re-enter the code or assume they were removed. */}
        {groups.length === 0 &&
          pendingMemberships.length === 0 &&
          !loading &&
          !pendingError &&
          !groupsError && (
            <p id="stokvelEmpty" className="empty-msg">
              No stokvels yet. Create one or join with an invite code.
            </p>
          )}
      </section>

      {/* Create Modal */}
      {createOpen && (
        <div
          className="modal-overlay"
          id="stokvelModal"
          {...createDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-stokvel-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="create-stokvel-title">Create Stokvel</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setCreateOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form id="stokvelForm" onSubmit={handleCreate}>
              <div className="field">
                <label>Stokvel Name</label>
                <input
                  type="text"
                  className="input"
                  required
                  placeholder="e.g. Family Savings Club"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Monthly Contribution (per person)</label>
                {/* min="0" let a stokvel be created with a R0 obligation, which
                    is the figure every "paid of owed" line on the card is
                    measured against and the multiplier behind the month target
                    and the pot. handleCreate rejects it too; this stops the
                    browser submitting it in the first place. */}
                <input
                  type="number"
                  className="input"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={cAmount}
                  onChange={(e) => setCAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Payout Frequency</label>
                <select
                  className="input"
                  value={cFrequency}
                  onChange={(e) =>
                    setCFrequency(e.target.value as 'monthly' | 'yearly')
                  }
                >
                  <option value="monthly">Monthly (rotating payout)</option>
                  <option value="yearly">Yearly (lump sum split)</option>
                </select>
              </div>
              <div className="field">
                <label>Goal / Purpose (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. December groceries"
                  value={cGoal}
                  onChange={(e) => setCGoal(e.target.value)}
                />
              </div>
              <div
                className="field"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label>Start Date</label>
                  <input
                    type="date"
                    className="input"
                    value={cStart}
                    onChange={(e) => setCStart(e.target.value)}
                  />
                </div>
                <div>
                  <label>End Date (optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={cEnd}
                    onChange={(e) => setCEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Your Bank Account (for EFT reference)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. FNB 62812345678 (Ezechias)"
                  value={cBankRef}
                  onChange={(e) => setCBankRef(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary" disabled={cBusy}>
                {cBusy ? 'Creating…' : 'Create Stokvel'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {joinOpen && (
        <div
          className="modal-overlay"
          id="stokvelJoinModal"
          {...joinDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-stokvel-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setJoinOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="join-stokvel-title">Join a Stokvel</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setJoinOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="field">
              <label>Enter Invite Code</label>
              <input
                type="text"
                id="stokvelJoinCode"
                className="input"
                placeholder="e.g. ABCD1234"
                style={{ textTransform: 'uppercase' }}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
            </div>
            <p
              className="auth-error"
              style={{ color: '#ef4444', fontSize: '0.8rem', minHeight: 20 }}
            >
              {joinError}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={handleJoin}
              disabled={joinBusy}
            >
              {joinBusy ? 'Joining…' : 'Join Stokvel'}
            </button>
          </div>
        </div>
      )}

      {/* Contribution Modal */}
      {contribTarget && (
        <div
          className="modal-overlay"
          id="stokvelContribModal"
          {...contribDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-contribution-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setContribTarget(null);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="record-contribution-title">Record Contribution</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setContribTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {/* What is already on record for this member this period, so the
                duplicate is visible BEFORE the amount is typed rather than
                only in the confirm dialog afterwards. Both this figure and the
                one handleContribute checks come from the same place the money
                does; this one is the card's copy, and the write re-reads it. */}
            {contribTarget.paidSoFar !== null && contribTarget.paidSoFar > 0 && (
              <div
                style={{
                  background:
                    contribTarget.paidSoFar >= contribTarget.amount
                      ? 'rgba(245,158,11,0.08)'
                      : 'rgba(128,128,128,0.06)',
                  border:
                    contribTarget.paidSoFar >= contribTarget.amount
                      ? '1px solid rgba(245,158,11,0.2)'
                      : 'none',
                  borderRadius: 10,
                  padding: 10,
                  margin: '8px 0',
                  fontSize: '0.85rem',
                  lineHeight: 1.6,
                }}
              >
                <div>
                  You already have{' '}
                  <strong>
                    {formatCurrency(contribTarget.paidSoFar, currency)}
                  </strong>{' '}
                  recorded in {contribTarget.groupName} for {currentMonth}
                  {contribTarget.paidCount > 1
                    ? ` across ${contribTarget.paidCount} contributions`
                    : ''}
                  , against {formatCurrency(contribTarget.amount, currency)} owed.
                </div>
                {contribTarget.paidSoFar >= contribTarget.amount ? (
                  <div style={{ marginTop: 6, color: '#f59e0b' }}>
                    This month is already settled. If the stokvel admin
                    confirmed your payment from the bank statement, the money is
                    counted — recording it again would put the same cash in the
                    pot twice.
                  </div>
                ) : (
                  <div style={{ marginTop: 6, opacity: 0.7 }}>
                    The amount below is what is still outstanding.
                  </div>
                )}
              </div>
            )}
            <form id="stokvelContribForm" onSubmit={handleContribute}>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  className="input"
                  step="0.01"
                  min="0"
                  required
                  value={contribAmount}
                  onChange={(e) => setContribAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  className="input"
                  required
                  value={contribDate}
                  onChange={(e) => setContribDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Note (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. January contribution"
                  value={contribNote}
                  onChange={(e) => setContribNote(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary" disabled={contribBusy}>
                {contribBusy ? 'Recording…' : 'Record'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Payout Modal.
          Replaces a one-line confirm() that quoted an uneditable, unrounded
          monthly_amount x headcount and wrote exactly that into the permanent
          ledger. Every figure below was read from the database when the form
          opened, not taken from the card. */}
      {payoutDraft && (
        <div
          className="modal-overlay"
          id="stokvelPayoutModal"
          {...payoutDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-payout-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !payoutBusy) setPayoutDraft(null);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="record-payout-title">Record Payout</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setPayoutDraft(null)}
                disabled={payoutBusy}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div
              style={{
                background: 'rgba(128,128,128,0.06)',
                borderRadius: 10,
                padding: 10,
                margin: '8px 0',
                fontSize: '0.85rem',
                lineHeight: 1.6,
              }}
            >
              <div>
                Paying <strong>{payoutDraft.recipientName}</strong> for{' '}
                <strong>{payoutDraft.month}</strong> in {payoutDraft.groupName}.
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.7 }}>
                  Full pot{' '}
                  <strong>{formatCurrency(payoutDraft.potTarget, currency)}</strong>
                </span>
                <span
                  style={{
                    color:
                      payoutDraft.collected < payoutDraft.potTarget
                        ? '#f59e0b'
                        : '#10b981',
                  }}
                >
                  Paid in this month{' '}
                  <strong>{formatCurrency(payoutDraft.collected, currency)}</strong>
                </span>
              </div>
              {payoutDraft.collected < payoutDraft.potTarget && (
                <div style={{ marginTop: 6, color: '#f59e0b', fontSize: '0.8rem' }}>
                  The pot is{' '}
                  {formatCurrency(
                    Math.round((payoutDraft.potTarget - payoutDraft.collected) * 100) /
                      100,
                    currency,
                  )}{' '}
                  short of the full{' '}
                  {formatCurrency(payoutDraft.monthlyAmount, currency)} &times;{' '}
                  {payoutDraft.approvedIds.length} members.
                </div>
              )}
            </div>
            <form id="stokvelPayoutForm" onSubmit={handleRecordPayout}>
              <div className="field">
                <label>Amount actually handed over</label>
                <input
                  type="number"
                  className="input"
                  step="0.01"
                  min="0"
                  required
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                />
                <div style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: 4 }}>
                  Defaults to what has actually been paid in. Record the real
                  amount {payoutDraft.recipientName} received — this is the
                  figure the group&rsquo;s permanent record will show, and it
                  cannot be edited afterwards.
                </div>
              </div>
              <p
                className="auth-error"
                style={{ color: '#ef4444', fontSize: '0.8rem', minHeight: 20 }}
              >
                {payoutError}
              </p>
              <button type="submit" className="btn-primary" disabled={payoutBusy}>
                {payoutBusy ? 'Recording…' : 'Record Payout'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailTarget && (() => {
        const g = groups.find((x) => x.id === detailTarget);
        if (!g) return null;
        // Same undefined-means-unknown rule as the card. "No contributions
        // yet" in front of a member who has been paying for six months is the
        // single most alarming thing this modal could say, and it is exactly
        // what `|| []` produced whenever the read failed.
        const contribsKnown = contribsMap[detailTarget] !== undefined;
        const membersKnown = membersMap[detailTarget] !== undefined;
        const contribsError = contribsErrors[detailTarget] || '';
        const membersError = membersErrors[detailTarget] || '';
        const contribs = contribsMap[detailTarget] ?? [];
        const members = membersMap[detailTarget] ?? [];
        const memberMap: Record<string, string> = {};
        for (const m of members) memberMap[m.user_id] = m.display_name;
        // Payouts were written by Mark Paid Out and then shown nowhere, so a
        // recipient had no way to check what the group recorded about their
        // turn, and the owner had no screen that would ever have shown them a
        // duplicate or a payout against the wrong person.
        const payouts = payoutsMap[detailTarget] || [];
        const payoutsError = payoutsErrors[detailTarget] || '';
        const payoutsTotal = payouts.reduce((s, p) => s + Number(p.amount), 0);
        // Who may correct a row here. stokvel_contributions UPDATE and DELETE
        // are both `user_id = auth.uid() OR is_stokvel_owner(stokvel_id)`, so a
        // member may fix their own and the admin may fix any — this is the only
        // screen in the app where a wrong amount can be put right.
        const isOwner = !!user && g.owner_id === user.id;

        return (
          <div
            className="modal-overlay"
            id="stokvelDetailModal"
            {...detailDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stokvelDetailName"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDetailTarget(null);
            }}
          >
            <div className="modal" style={{ maxWidth: 500 }}>
              <div className="modal-header">
                <h2 id="stokvelDetailName">{g.name} — History</h2>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setDetailTarget(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div id="stokvelDetailContent">
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {/* Without the member list, every row below can only be
                      attributed to "Member list unavailable" — say why once at
                      the top rather than leaving the reader to guess whether
                      those people left the club. */}
                  {membersError && (
                    <p
                      className="auth-error"
                      style={{ color: '#ef4444', fontSize: '0.8rem', padding: '4px 0' }}
                    >
                      Could not load this stokvel&rsquo;s members: {membersError}. Names
                      cannot be shown against the rows below.
                    </p>
                  )}
                  <div
                    style={{
                      fontSize: '0.7rem',
                      opacity: 0.4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    }}
                  >
                    Payouts out of the pot
                  </div>
                  {payoutsError ? (
                    /* Never render a failed read as "no payouts recorded" —
                       to a recipient checking their turn those look the same
                       and mean opposite things. */
                    <p
                      className="auth-error"
                      style={{ color: '#ef4444', fontSize: '0.8rem', padding: '4px 0' }}
                    >
                      Could not load this stokvel&rsquo;s payouts: {payoutsError}
                    </p>
                  ) : payouts.length === 0 ? (
                    <p style={{ opacity: 0.4, padding: '4px 0', fontSize: '0.85rem' }}>
                      No payouts recorded yet
                    </p>
                  ) : (
                    <>
                      {payouts.map((p) => {
                        const name = p.recipient_id
                          ? memberMap[p.recipient_id] ??
                            'A member who has since left'
                          : 'Recipient not recorded';
                        const isMe = !!user && p.recipient_id === user.id;
                        return (
                          <div
                            key={p.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 0',
                              borderBottom: '1px solid rgba(128,128,128,0.08)',
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontWeight: isMe ? 600 : 500,
                                  color: isMe ? '#f59e0b' : 'inherit',
                                }}
                              >
                                {name}
                                {isMe ? ' (You)' : ''}
                              </div>
                              <div style={{ fontSize: '0.75rem', opacity: 0.4 }}>
                                Payout for {p.month}
                                {p.paid === true ? '' : ' — not marked as paid'}
                              </div>
                            </div>
                            <div style={{ fontWeight: 600, color: '#f59e0b' }}>
                              {'− ' + formatCurrency(Number(p.amount), currency)}
                            </div>
                          </div>
                        );
                      })}
                      <div
                        style={{
                          fontSize: '0.75rem',
                          opacity: 0.5,
                          padding: '6px 0 2px',
                        }}
                      >
                        {payouts.length}
                        {payouts.length === 1 ? ' payout' : ' payouts'} recorded,
                        totalling {formatCurrency(payoutsTotal, currency)}
                      </div>
                    </>
                  )}

                  <div
                    style={{
                      fontSize: '0.7rem',
                      opacity: 0.4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      margin: '14px 0 6px',
                    }}
                  >
                    Contributions into the pot
                  </div>
                  {!contribsKnown ? (
                    <p
                      className="auth-error"
                      style={{ color: '#ef4444', fontSize: '0.8rem', padding: '4px 0' }}
                    >
                      {contribsError
                        ? 'Could not load this stokvel’s contributions: ' + contribsError
                        : 'This stokvel’s contributions have not loaded.'}{' '}
                      Nothing has been lost — close this and reload before
                      recording anything.
                    </p>
                  ) : contribs.length === 0 ? (
                    <p
                      style={{
                        opacity: 0.4,
                        textAlign: 'center',
                        padding: 20,
                      }}
                    >
                      No contributions yet
                    </p>
                  ) : (
                    contribs.map((c) => {
                      // "Unknown" was misleading in both directions: it was
                      // shown for a payer who has left the stokvel AND for
                      // every row when the member read had failed and
                      // coalesced to []. Tell those two apart.
                      const name = !membersKnown
                        ? 'Member list unavailable'
                        : memberMap[c.user_id] || 'A member who has left this stokvel';
                      const isMe = user ? c.user_id === user.id : false;
                      const canCorrect = isOwner || isMe;
                      return (
                        <div
                          key={c.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 0',
                            borderBottom: '1px solid rgba(128,128,128,0.08)',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontWeight: isMe ? 600 : 500,
                                color: isMe ? '#10b981' : 'inherit',
                              }}
                            >
                              {name}
                              {isMe ? ' (You)' : ''}
                            </div>
                            <div
                              style={{
                                fontSize: '0.75rem',
                                opacity: 0.4,
                              }}
                            >
                              {c.date}
                              {c.note ? ' — ' + c.note : ''}
                            </div>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            {/* toLocaleString with only minimumFractionDigits
                                set lets maximumFractionDigits default to 3, so
                                a float-residue amount rendered a third decimal
                                here. formatCurrency pins both to 2. */}
                            <div style={{ fontWeight: 600, color: '#10b981' }}>
                              {'+ ' + formatCurrency(Number(c.amount), currency)}
                            </div>
                            {canCorrect && (
                              <>
                                <button
                                  type="button"
                                  className="btn-edit-contrib"
                                  onClick={() => openEditContribution(c, g, name)}
                                  style={{
                                    background: 'rgba(128,128,128,0.12)',
                                    border: 'none',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    fontSize: '0.7rem',
                                    cursor: 'pointer',
                                    opacity: 0.7,
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn-delete-contrib"
                                  onClick={() => handleDeleteContribution(c, g, name)}
                                  style={{
                                    background: 'rgba(239,68,68,0.15)',
                                    color: '#ef4444',
                                    border: 'none',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    fontSize: '0.7rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Correct a contribution.
          Rendered AFTER the History modal on purpose: it opens from a row
          inside that modal, and the later overlay in DOM order is the one that
          paints on top and holds focus. */}
      {editContrib && (
        <div
          className="modal-overlay"
          id="stokvelEditContribModal"
          {...editDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-contribution-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !editBusy) setEditContrib(null);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="edit-contribution-title">Correct Contribution</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditContrib(null)}
                disabled={editBusy}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div
              style={{
                background: 'rgba(128,128,128,0.06)',
                borderRadius: 10,
                padding: 10,
                margin: '8px 0',
                fontSize: '0.85rem',
                lineHeight: 1.6,
              }}
            >
              <div>
                {editContrib.isMine ? 'Your contribution' : editContrib.memberName + "'s contribution"}{' '}
                to <strong>{editContrib.groupName}</strong>, recorded as{' '}
                <strong>{formatCurrency(editContrib.openedAmount, currency)}</strong> on{' '}
                <strong>{editContrib.openedDate}</strong>.
              </div>
              <div style={{ marginTop: 6, opacity: 0.7, fontSize: '0.8rem' }}>
                Changing the amount changes this stokvel&rsquo;s totals for every
                member, and the pot the club settles real cash from. You will be
                shown the exact difference before anything is saved.
              </div>
            </div>
            <form id="stokvelEditContribForm" onSubmit={handleSaveContribution}>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  className="input"
                  step="0.01"
                  min="0"
                  required
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  className="input"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Note (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. January contribution"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />
              </div>
              <p
                className="auth-error"
                style={{ color: '#ef4444', fontSize: '0.8rem', minHeight: 20 }}
              >
                {editError}
              </p>
              <button type="submit" className="btn-primary" disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save Correction'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Group settings (owner only). Mirrors the Create form field for field,
          because these are the same columns — they were simply write-once
          until now. */}
      {settingsTarget && (
        <div
          className="modal-overlay"
          id="stokvelSettingsModal"
          {...settingsDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stokvel-settings-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sBusy) setSettingsTarget(null);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="stokvel-settings-title">Stokvel Settings</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSettingsTarget(null)}
                disabled={sBusy}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form id="stokvelSettingsForm" onSubmit={handleSaveSettings}>
              <div className="field">
                <label>Stokvel Name</label>
                <input
                  type="text"
                  className="input"
                  required
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Monthly Contribution (per person)</label>
                {/* Same reason as the create form: zero is not a contribution,
                    and handleSaveSettings refuses it. */}
                <input
                  type="number"
                  className="input"
                  step="0.01"
                  min="0.01"
                  required
                  value={sAmount}
                  onChange={(e) => setSAmount(e.target.value)}
                />
                <div style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: 4 }}>
                  This is the cash every member hands over each month. Changing
                  it changes the monthly target and the full pot from now on;
                  contributions and payouts already recorded stay exactly as
                  they are.
                </div>
              </div>
              <div className="field">
                <label>Payout Frequency</label>
                <select
                  className="input"
                  value={sFrequency}
                  onChange={(e) =>
                    setSFrequency(e.target.value as 'monthly' | 'yearly')
                  }
                >
                  <option value="monthly">Monthly (rotating payout)</option>
                  <option value="yearly">Yearly (lump sum split)</option>
                </select>
                {sFrequency === 'yearly' && settingsTarget.frequency === 'monthly' && (
                  <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: 4 }}>
                    A yearly stokvel has no rotating payout, so Next payout,
                    Mark Paid Out and Skip turn disappear from the card and this
                    stokvel will have no way to record a payout.
                  </div>
                )}
              </div>
              <div className="field">
                <label>Goal / Purpose (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. December groceries"
                  value={sGoal}
                  onChange={(e) => setSGoal(e.target.value)}
                />
              </div>
              <div
                className="field"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label>Start Date</label>
                  <input
                    type="date"
                    className="input"
                    value={sStart}
                    onChange={(e) => setSStart(e.target.value)}
                  />
                </div>
                <div>
                  <label>End Date (optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={sEnd}
                    onChange={(e) => setSEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Your Bank Account (for EFT reference)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. FNB 62812345678 (Ezechias)"
                  value={sBankRef}
                  onChange={(e) => setSBankRef(e.target.value)}
                />
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: 4 }}>
                  Every member reads this line before sending real money. Check
                  it against your bank app character by character.
                </div>
              </div>
              <p
                className="auth-error"
                style={{ color: '#ef4444', fontSize: '0.8rem', minHeight: 20 }}
              >
                {sError}
              </p>
              <button type="submit" className="btn-primary" disabled={sBusy}>
                {sBusy ? 'Saving…' : 'Save Settings'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

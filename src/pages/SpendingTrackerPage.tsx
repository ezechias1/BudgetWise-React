import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ok, reportWriteFailure } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useFamilyIncome } from '@/hooks/useFamilyIncome';
import { pickMemberColor, invalidateFamilyGroupCache } from '@/hooks/useFamilyMembers';
import { shareInvite } from '@/lib/family-invite';
import { FAMILY_CATEGORIES } from '@/lib/categories';

/**
 * Ports #page-family-tracking from dashboard.html (line 1835) and
 * the `loadTrackingState` / `loadFamilySpendingFeed` / `loadLinkedMembers`
 * logic in js/app.js (~line 7350+).
 *
 * Roles:
 *  - If the signed-in user owns a row in `family_groups`, show the parent
 *    view: invite code, family income, linked members, pending approvals,
 *    and the real-time spending feed.
 *  - Otherwise show the member view: join-a-family form, my pending
 *    requests, and sharing preferences.
 *
 * Complex flows (real-time feed subscription, parent approvals, share
 * category picker) are stubbed with working-but-minimal UI + TODOs.
 */

interface FamilyGroup {
  id: string;
  owner_id: string;
  family_name: string;
  family_code: string;
}

/**
 * Name to store on a family_links row. The column is NOT NULL, so this must
 * always return something — hence the final fallback.
 */
function memberDisplayName(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const full = user.user_metadata?.full_name;
  if (typeof full === 'string' && full.trim()) return full.trim();
  if (user.email) return user.email.split('@')[0];
  return 'Member';
}

interface FamilyLink {
  id: string;
  group_id: string;
  user_id: string;
  display_name: string | null;
  color: string | null;
  role: string | null;
  approved: boolean | null;
  sharing_enabled: boolean | null;
  share_all: boolean | null;
  share_categories: string[] | null;
}

interface FamilySpending {
  id: string;
  user_id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
}

/**
 * Master switch for the shared spending feed panel.
 *
 * `family_spending` has never received a single row: no client code, no
 * database trigger and no edge function writes to that table anywhere in the
 * app. The feed was therefore structurally incapable of showing anything — it
 * could only ever render "Spending from linked members will appear here", on
 * the first page a newly-linked family opens, which reads as "sharing is
 * broken" rather than "not built yet".
 *
 * While this is false the panel shows an honest not-available-yet state. The
 * loader, the feed state and the realtime subscription below are deliberately
 * left in place so turning it back on is this one line.
 *
 * Flip to true only once something actually inserts into family_spending —
 * i.e. bank sync (or a share-on-expense trigger) is live and writing rows for
 * approved, sharing-enabled members.
 *
 * Typed as boolean, not the literal `false`, so both branches stay
 * type-checked while the feature is off.
 */
const SPENDING_FEED_ENABLED: boolean = false;

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++)
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}


/**
 * This page is reached from two different nav items: "Spending Tracker" in
 * Family mode and "Partners" in Business mode (App.tsx routes both to it).
 * The underlying model is the same, but the wording was family-only — so a
 * business user was being told to enter the invite code from their
 * "parent/guardian". Copy switches on mode; nothing else does.
 */
function copyFor(isBusiness: boolean) {
  return {
    subtitle: isBusiness
      ? 'Track real spending from linked partners'
      : 'Track real spending from linked family members',
    codeHeading: isBusiness ? 'Your Partner Invite Code' : 'Your Family Invite Code',
    codeHelp: isBusiness
      ? 'Share this code with a partner. They enter it in their app to link their spending to your business dashboard.'
      : 'Share this code with family members. They enter it in their app to link their spending to your family dashboard.',
    incomeHeading: isBusiness ? 'Combined Revenue' : 'Family Income',
    incomeHelp: isBusiness
      ? 'Combined monthly income from all linked partners. Each partner sets their own.'
      : 'Combined income from all family members. Each parent sets their own contribution.',
    membersHeading: isBusiness ? 'Linked Partners' : 'Linked Members',
    feedHeading: isBusiness ? 'Partner Spending Feed' : 'Family Spending Feed',
    // Shown while SPENDING_FEED_ENABLED is false — see the constant above.
    feedUnavailable: isBusiness
      ? 'Shared partner spending will appear here once bank sync is connected. Nothing is being recorded to this feed yet, so there is nothing to wait for — linking partners and combined revenue above are unaffected.'
      : 'Shared family spending will appear here once bank sync is connected. Nothing is being recorded to this feed yet, so there is nothing to wait for — linking members and family income above are unaffected.',
    joinHeading: isBusiness ? 'Join a Business' : 'Join a Family',
    joinHelp: isBusiness
      ? 'Enter the invite code from the account owner to link your spending.'
      : 'Enter the invite code from your parent/guardian to link your spending.',
    createOwn: isBusiness
      ? 'Or create your own partner group'
      : 'Or create your own family group',
    linkedFallback: isBusiness ? 'Business' : 'Family',
    unlink: isBusiness ? 'Unlink from Business' : 'Unlink from Family',
    // Verb phrases completing "Could not …" in write-failure messages.
    createGroupAction: isBusiness
      ? 'create your partner group'
      : 'create your family group',
    newCodeAction: isBusiness
      ? 'generate a new partner invite code'
      : 'generate a new family invite code',
    unlinkAction: isBusiness
      ? 'unlink you from this business'
      : 'unlink you from this family',
    approveAction: isBusiness ? 'approve this partner' : 'approve this member',
    removeAction: isBusiness ? 'remove this partner' : 'remove this member',
  };
}

export default function SpendingTrackerPage() {
  const { user } = useAuth();
  const { mode } = useMode();
  const t = copyFor(mode === 'business');
  const [loading, setLoading] = useState(true);
  const [ownedGroup, setOwnedGroup] = useState<FamilyGroup | null>(null);
  const [myLink, setMyLink] = useState<
    (FamilyLink & { family_groups?: { family_name: string } }) | null
  >(null);

  const [linkedMembers, setLinkedMembers] = useState<FamilyLink[]>([]);
  const [spendingFeed, setSpendingFeed] = useState<FamilySpending[]>([]);

  // Member-view state
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [shareScope, setShareScope] = useState<'all' | 'selected'>('all');
  const [shareCategories, setShareCategories] = useState<string[]>([]);
  // Household income now comes from the shared hook rather than an inline
  // sum here. The old version only ran in the owner branch (so a joined
  // spouse never saw a combined figure) and dropped user_id, making a
  // per-person split impossible.
  const household = useFamilyIncome();
  const familyIncome = household.combined;

  const loadState = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // Owned group first
    const ownedRes = await supabase
      .from('family_groups')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    const owned = ownedRes.data && ownedRes.data.length > 0
      ? (ownedRes.data[0] as FamilyGroup)
      : null;

    if (owned) {
      setOwnedGroup(owned);
      setMyLink(null);

      const [linksRes, feedRes] = await Promise.all([
        supabase
          .from('family_links')
          .select('*')
          .eq('group_id', owned.id)
          .order('joined_at', { ascending: true }),
        // Gated like the realtime channel below. `family_spending` was one of
        // the dead tables dropped from the database, so this fetch 404'd on
        // every load of this page — harmless to the UI, which already says
        // "Not available yet", but a real error in everyone's console.
        SPENDING_FEED_ENABLED
          ? supabase
              .from('family_spending')
              .select('*')
              .eq('group_id', owned.id)
              .order('date', { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as FamilySpending[] }),
      ]);
      let links = (linksRes.data as FamilyLink[]) || [];

      // Self-heal owners orphaned by the display_name bug.
      //
      // The owner auto-link used to fail silently (23502, display_name is
      // NOT NULL), so anyone who created a group before that fix owns a
      // group they aren't a member of. Fixing the insert alone doesn't help
      // them: createGroup only regenerates the code when a group already
      // exists, so they'd never get a link. Without one they have no
      // approved family_links row, which means no group_id on their
      // expenses and no combined income.
      if (!links.some((l) => l.user_id === user.id)) {
        const { data: healed, error: healErr } = await supabase
          .from('family_links')
          .insert({
            group_id: owned.id,
            user_id: user.id,
            display_name: memberDisplayName(user),
            color: pickMemberColor(links.map((l) => l.color)),
            role: 'owner',
            approved: true,
          })
          .select()
          .single();
        // Runs on load with no user action behind it, so this logs rather
        // than alerting — but it must not vanish: if the heal keeps failing
        // the owner silently has no group, and combined income and the
        // shared ledger both stay dormant with no visible cause.
        if (healErr) console.error('[family] owner self-heal failed:', healErr.message);
        if (healed) links = [...links, healed as FamilyLink];
      }

      // Backfill colours for members who don't have one. The migration
      // backfilled rows that existed at the time, but anyone who joined
      // between then and the insert-site fix has a null colour — and a null
      // colour renders as the shared grey fallback, which quietly defeats
      // the whole point of per-person colour coding.
      const uncoloured = links.filter((l) => !l.color);
      if (uncoloured.length > 0) {
        const assigned: string[] = links.map((l) => l.color).filter(Boolean) as string[];
        for (const l of uncoloured) {
          const color = pickMemberColor(assigned);
          assigned.push(color);
          const { error: colorErr } = await supabase
            .from('family_links')
            .update({ color })
            .eq('id', l.id);
          // Previously discarded: a failed backfill left the member on the
          // grey fallback with nothing said. Not alerted — this is a
          // cosmetic self-heal that runs on every load (one alert per
          // uncoloured member would be worse than the bug) and it retries
          // next load. Leaving l.color unset keeps the UI honest about what
          // is actually stored.
          if (colorErr) {
            console.error(
              '[write failed] backfill member colour',
              { link_id: l.id, error: colorErr.message },
            );
            continue;
          }
          l.color = color;
        }
        links = [...links];
      }

      setLinkedMembers(links);
      setSpendingFeed((feedRes.data as FamilySpending[]) || []);

      // (Household income is loaded by useFamilyIncome above — it covers the
      // member branch too, which this block never did.)
    } else {
      setOwnedGroup(null);
      const myLinkRes = await supabase
        .from('family_links')
        .select('*, family_groups(family_name)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: false })
        .limit(1);
      const link = myLinkRes.data && myLinkRes.data.length > 0
        ? (myLinkRes.data[0] as FamilyLink & { family_groups?: { family_name: string } })
        : null;
      setMyLink(link);
      if (link) {
        setSharingEnabled(!!link.sharing_enabled);
        setShareScope(link.share_all === false ? 'selected' : 'all');
        setShareCategories(link.share_categories || []);
      }
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Realtime subscription on family_spending for the parent view.
  // Kept intact but gated: while SPENDING_FEED_ENABLED is false nothing can
  // ever INSERT into family_spending, so this channel would sit open waiting
  // for an event that cannot arrive.
  useEffect(() => {
    if (!SPENDING_FEED_ENABLED || !ownedGroup) return;
    const channel = supabase
      .channel('family-spending-' + ownedGroup.id)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'family_spending',
          filter: 'group_id=eq.' + ownedGroup.id,
        },
        (payload) => {
          setSpendingFeed((prev) => [payload.new as FamilySpending, ...prev]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownedGroup]);

  const generateCode = async () => {
    if (!user) return;
    const code = randomCode();
    if (ownedGroup) {
      // Previously discarded: on failure the UI still swapped in the new
      // code, so the owner shared a code the database had never stored and
      // everyone who typed it was told "Invalid invite code".
      const updated = await ok(
        supabase
          .from('family_groups')
          .update({ family_code: code })
          .eq('id', ownedGroup.id),
        t.newCodeAction,
      );
      if (!updated) return;
      setOwnedGroup({ ...ownedGroup, family_code: code });
    } else {
      // Previously discarded: `const { data } = ...` dropped the error, so a
      // failed insert simply fell through the `if (data)` below — the user
      // pressed "create group", nothing happened, and nothing was said.
      const { data, error: createErr } = await supabase
        .from('family_groups')
        .insert({
          owner_id: user.id,
          family_name: 'My Family',
          family_code: code,
        })
        .select()
        .single();
      if (createErr || !data) {
        reportWriteFailure(t.createGroupAction, createErr?.message);
        return;
      }
      setOwnedGroup(data as FamilyGroup);
      // Auto-link owner.
      //
      // display_name is NOT NULL in the live schema, and omitting it made
      // this insert fail with 23502 every single time. The error was never
      // checked, so group creation looked like it worked while the owner
      // was never actually linked — which in turn left them with no
      // approved family_links row, so useFamilyGroupId found no group and
      // the whole shared-ledger/combined-income path stayed dormant.
      const { error: linkErr } = await supabase.from('family_links').insert({
        group_id: (data as FamilyGroup).id,
        user_id: user.id,
        display_name: memberDisplayName(user),
        color: pickMemberColor([]),
        role: 'owner',
        approved: true,
      });
      invalidateFamilyGroupCache();
      if (linkErr) {
        alert(`Group created, but linking you to it failed: ${linkErr.message}`);
      }
      loadState();
    }
  };

  const copyCode = async () => {
    if (!ownedGroup?.family_code) return;
    try {
      await navigator.clipboard.writeText(ownedGroup.family_code);
      alert('Code copied');
    } catch {
      // noop
    }
  };

  /**
   * Send the invite as a link rather than a bare code.
   *
   * People pass these along on WhatsApp, so this uses the phone's own share
   * sheet where it exists and falls back to the clipboard on desktop. The
   * link carries the code, so the person receiving it never types anything —
   * they sign up and land joined.
   */
  const shareCode = async () => {
    if (!ownedGroup?.family_code) return;
    const outcome = await shareInvite(ownedGroup.family_code, ownedGroup.family_name);
    if (outcome === 'copied') alert('Invite link copied — paste it to them.');
    else if (outcome === 'failed') alert(`Could not share. The code is ${ownedGroup.family_code}.`);
    // 'shared' needs no confirmation (the share sheet is its own feedback),
    // and 'cancelled' means they closed it deliberately.
  };

  const joinFamily = async () => {
    if (!user) return;
    setJoinError('');
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Enter a code');
      return;
    }
    // Resolve the invite code through an RPC, not a direct select.
    //
    // family_groups RLS restricts SELECT to owners and members, so a
    // *prospective* member could never read the row they were trying to
    // join — the direct query returned 200 with an empty array and the UI
    // reported "Invalid invite code" for perfectly valid codes. Joining a
    // family was therefore impossible.
    //
    // find_family_group_by_code is SECURITY DEFINER and returns only id +
    // family_name — deliberately not owner_id, so holding a code doesn't
    // reveal who owns the group before approval.
    const { data: found, error: lookupErr } = await supabase.rpc(
      'find_family_group_by_code',
      { p_code: code },
    );
    const group = (found as { id: string; family_name: string }[] | null)?.[0];
    if (lookupErr) {
      setJoinError(`Could not check that code: ${lookupErr.message}`);
      return;
    }
    if (!group) {
      setJoinError('Invalid invite code');
      return;
    }
    const existing = await supabase
      .from('family_links')
      .select('id')
      .eq('user_id', user.id)
      .eq('group_id', group.id)
      .maybeSingle();
    if (existing.data) {
      setJoinError('Already linked to this family');
      return;
    }
    // Same NOT NULL constraint as the owner link above — without
    // display_name this silently 400'd, so joining a family by code has
    // never actually worked either.
    const { error: joinErr } = await supabase.from('family_links').insert({
      group_id: group.id,
      user_id: user.id,
      display_name: memberDisplayName(user),
      // Colour is picked blind here: a joiner can't read the group's other
      // family_links rows (RLS), so collisions are possible and harmless —
      // the owner can regenerate. Better than everyone sharing one grey.
      color: pickMemberColor([]),
      role: 'member',
      approved: false,
    });
    if (joinErr) {
      setJoinError(`Could not join: ${joinErr.message}`);
      return;
    }
    invalidateFamilyGroupCache();
    setJoinCode('');
    loadState();
  };

  const unlink = async () => {
    if (!user || !myLink) return;
    if (!confirm('Unlink from this family?')) return;
    // Previously discarded: on failure the link row survived but the UI
    // cleared it, so the user was shown the "join a family" form while still
    // sharing their spending with the group they thought they had left.
    const unlinked = await ok(
      supabase
        .from('family_links')
        .delete()
        .eq('id', myLink.id)
        .eq('user_id', user.id),
      t.unlinkAction,
    );
    if (!unlinked) return;
    setMyLink(null);
    loadState();
  };

  const toggleShareCategory = (cat: string) => {
    setShareCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const saveSharing = async () => {
    if (!user || !myLink) return;
    // Previously discarded: "Sharing preferences saved" was shown
    // unconditionally, so someone who turned sharing OFF could be told it was
    // saved while their spending stayed shared.
    const saved = await ok(
      supabase
        .from('family_links')
        .update({
          sharing_enabled: sharingEnabled,
          share_all: shareScope === 'all',
          share_categories: shareScope === 'selected' ? shareCategories : null,
        })
        .eq('id', myLink.id)
        .eq('user_id', user.id),
      'save your sharing preferences',
    );
    if (!saved) return;
    alert('Sharing preferences saved');
  };

  // Approve/remove mutations below operate on a DIFFERENT user's link row —
  // the row's user_id is the member being approved/removed, not the caller.
  // Ownership is enforced by RLS via the parent relationship; tightening
  // via an RPC is tracked as follow-up (AUDIT C4 subset).
  const approveMember = async (link: FamilyLink) => {
    // Previously discarded — the worst of the set. If this update failed
    // (RLS rejecting the cross-user write, say) the row stayed approved =
    // false, but the owner's list moved the member into "approved" anyway.
    // The owner believed they had approved them; the member sat on "Waiting
    // for approval..." forever, and neither side had any reason to retry.
    const approvedOk = await ok(
      supabase.from('family_links').update({ approved: true }).eq('id', link.id),
      t.approveAction,
    );
    if (!approvedOk) return;
    setLinkedMembers((prev) =>
      prev.map((l) => (l.id === link.id ? { ...l, approved: true } : l)),
    );
  };

  const removeLinkedMember = async (link: FamilyLink) => {
    if (!confirm('Remove this member?')) return;
    // Previously discarded: a failed delete still dropped the member from the
    // list, so they looked removed while their link row — and their access —
    // survived until the next reload put them back.
    const removed = await ok(
      supabase.from('family_links').delete().eq('id', link.id),
      t.removeAction,
    );
    if (!removed) return;
    setLinkedMembers((prev) => prev.filter((l) => l.id !== link.id));
  };

  if (loading) {
    return (
      <section className="page active" id="page-family-tracking">
        <div className="page-header">
          <div>
            <h1>Spending Tracker</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
      </section>
    );
  }

  const pending = linkedMembers.filter((l) => !l.approved);
  const approved = linkedMembers.filter((l) => l.approved);

  return (
    <section
      className="page"
      id="page-family-tracking"
      style={{ display: 'block' }}
    >
      <div className="page-header">
        <div>
          <h1>Spending Tracker</h1>
          <p className="page-subtitle">
            {t.subtitle}
          </p>
        </div>
      </div>

      {/* Parent view */}
      {ownedGroup ? (
        <div id="trackingParentView">
          <div
            className="chart-card full-width"
            style={{ marginBottom: 16 }}
          >
            <h3 className="tracking-title" style={{ marginBottom: 12 }}>
              {t.codeHeading}
            </h3>
            <p
              className="tracking-desc"
              style={{ fontSize: '0.82rem', marginBottom: 12 }}
            >
              {t.codeHelp}
            </p>
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div
                id="familyInviteCode"
                className="invite-code-box"
                style={{
                  fontSize: '1.8rem',
                  fontWeight: 800,
                  letterSpacing: 6,
                  padding: '12px 20px',
                  borderRadius: 12,
                  minWidth: 0,
                }}
              >
                {ownedGroup.family_code || '------'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn-primary"
                  onClick={generateCode}
                  style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}
                >
                  Generate Code
                </button>
                <button
                  className="btn-export"
                  onClick={copyCode}
                  style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}
                >
                  Copy
                </button>
                <button
                  className="btn-primary"
                  onClick={shareCode}
                  style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}
                >
                  Send invite
                </button>
              </div>
            </div>
          </div>

          {/* Family income — stub */}
          <div
            className="chart-card full-width"
            style={{ marginBottom: 16 }}
            id="familyIncomeSection"
          >
            <h3 style={{ marginBottom: 8 }}>{t.incomeHeading}</h3>
            <p
              className="tracking-desc"
              style={{ fontSize: '0.78rem', marginBottom: 12 }}
            >
              {t.incomeHelp}
            </p>
            <div id="familyIncomeSummary">
              {familyIncome > 0 ? (
                <>
                  <div
                    style={{
                      fontSize: '1.6rem',
                      fontWeight: 800,
                      color: '#10b981',
                    }}
                  >
                    {familyIncome.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 400,
                        opacity: 0.5,
                        marginLeft: 6,
                      }}
                    >
                      / month (combined)
                    </span>
                  </div>
                  {/* Per-person split — the old inline query dropped user_id,
                      so this breakdown was impossible before. */}
                  {household.hasPartners && (
                    <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
                      {household.members.map((m) => (
                        <div
                          key={m.user_id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            fontSize: '0.85rem',
                          }}
                        >
                          <span style={{ opacity: 0.7 }}>{m.display_name}</span>
                          <span
                            style={{
                              fontWeight: 600,
                              opacity: m.visible ? 1 : 0.45,
                            }}
                          >
                            {m.visible
                              ? m.income.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })
                              : 'Hidden'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {household.partial && (
                    <p
                      style={{
                        fontSize: '0.75rem',
                        color: '#f59e0b',
                        marginTop: 8,
                      }}
                    >
                      At least one member's income couldn't be read, so this
                      total is incomplete.
                    </p>
                  )}
                </>
              ) : (
                <p
                  style={{
                    opacity: 0.35,
                    fontSize: '0.85rem',
                  }}
                >
                  No family income set yet. Members can set their contribution
                  in Account settings.
                </p>
              )}
            </div>
          </div>

          {/* Pending approvals */}
          {pending.length > 0 && (
            <div
              className="chart-card full-width"
              style={{ marginBottom: 16 }}
              id="pendingApprovalsCard"
            >
              <h3 style={{ marginBottom: 4 }}>Pending Approvals</h3>
              <p
                className="tracking-desc"
                style={{ fontSize: '0.78rem', marginBottom: 14 }}
              >
                Requests from kids waiting for your approval.
              </p>
              <div id="pendingApprovalsList">
                {pending.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      padding: 10,
                      background: 'rgba(128,128,128,0.06)',
                      borderRadius: 10,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ flex: 1, fontWeight: 600 }}>
                      {p.display_name || 'New member'}
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => approveMember(p)}
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => removeLinkedMember(p)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        background: 'rgba(239,68,68,0.12)',
                        color: '#ef4444',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked members */}
          <div
            className="chart-card full-width"
            style={{ marginBottom: 16 }}
          >
            <h3 style={{ marginBottom: 4 }}>{t.membersHeading}</h3>
            <p
              className="tracking-desc"
              style={{ fontSize: '0.78rem', marginBottom: 14 }}
            >
              Family members linked to this group. Owner can manage roles and
              approve access.
            </p>
            <div id="linkedMembersList">
              {approved.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <p>
                    No members linked yet. Share your invite code to get
                    started.
                  </p>
                </div>
              ) : (
                approved.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      padding: 12,
                      background: 'rgba(128,128,128,0.06)',
                      borderRadius: 10,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {l.display_name || 'Member'}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          opacity: 0.5,
                        }}
                      >
                        {l.role || 'member'}
                      </div>
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => removeLinkedMember(l)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        background: 'rgba(239,68,68,0.12)',
                        color: '#ef4444',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Spending feed */}
          <div className="chart-card full-width">
            <h3 style={{ marginBottom: 12 }}>{t.feedHeading}</h3>
            {/* Live feed — realtime via Supabase channel.
                Off while SPENDING_FEED_ENABLED is false: nothing writes
                family_spending, so the old empty state was a promise the app
                could not keep. See the constant at the top of this file. */}
            <div id="familySpendingFeed">
              {!SPENDING_FEED_ENABLED ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <p style={{ fontWeight: 600, marginBottom: 6 }}>
                    Not available yet
                  </p>
                  <p style={{ fontSize: '0.82rem', opacity: 0.6 }}>
                    {t.feedUnavailable}
                  </p>
                </div>
              ) : spendingFeed.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <p>Spending from linked members will appear here.</p>
                </div>
              ) : (
                spendingFeed.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: 10,
                      borderBottom: '1px solid rgba(128,128,128,0.08)',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        {s.description || s.category}
                      </div>
                      <div
                        style={{
                          fontSize: '0.72rem',
                          opacity: 0.5,
                        }}
                      >
                        {s.category} • {s.date}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700 }}>
                      {Number(s.amount).toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Member view */
        <div id="trackingMemberView">
          <div
            className="chart-card full-width"
            style={{ marginBottom: 16 }}
          >
            <h3 className="tracking-title" style={{ marginBottom: 12 }}>
              {t.joinHeading}
            </h3>
            <p
              className="tracking-desc"
              style={{ fontSize: '0.82rem', marginBottom: 12 }}
            >
              {t.joinHelp}
            </p>
            {!myLink ? (
              <div id="joinSection">
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    maxWidth: '100%',
                    overflow: 'hidden',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Enter invite code"
                    maxLength={8}
                    className="quick-input"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: '1.1rem',
                      letterSpacing: 3,
                      textTransform: 'uppercase',
                      textAlign: 'center',
                    }}
                  />
                  <button
                    className="btn-primary"
                    onClick={joinFamily}
                    style={{ padding: '12px 24px', flexShrink: 0 }}
                  >
                    Join
                  </button>
                </div>
                <p className="auth-error" style={{ minHeight: 0 }}>
                  {joinError}
                </p>
                <button
                  className="btn-primary"
                  onClick={generateCode}
                  style={{
                    marginTop: 12,
                    width: '100%',
                    padding: 10,
                    fontSize: '0.82rem',
                    background: 'rgba(139,92,246,0.15)',
                    color: '#8b5cf6',
                  }}
                >
                  {t.createOwn}
                </button>
              </div>
            ) : (
              <div id="linkedStatus">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 14,
                    background: 'rgba(16,185,129,0.08)',
                    borderRadius: 12,
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: '1.3rem' }}>✅</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      Linked to {myLink.family_groups?.family_name || t.linkedFallback}
                    </div>
                    <div
                      className="tracking-desc"
                      style={{ fontSize: '0.78rem' }}
                    >
                      {myLink.approved
                        ? 'Linked and approved'
                        : 'Waiting for approval...'}
                    </div>
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={unlink}
                  style={{
                    padding: 10,
                    fontSize: '0.82rem',
                    background: 'rgba(239,68,68,0.12)',
                    color: '#ef4444',
                    width: '100%',
                  }}
                >
                  {t.unlink}
                </button>
              </div>
            )}
          </div>

          <div
            className="chart-card full-width"
            style={{ marginBottom: 16 }}
          >
            <h3 style={{ marginBottom: 4 }}>My Requests</h3>
            <p
              className="tracking-desc"
              style={{ fontSize: '0.78rem', marginBottom: 14 }}
            >
              Your submissions waiting for parent approval.
            </p>
            <div id="myPendingList">
              {myLink && !myLink.approved ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 12,
                    background: 'rgba(245,158,11,0.08)',
                    borderRadius: 10,
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>⏳</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Join request pending
                    </div>
                    <div
                      style={{
                        fontSize: '0.72rem',
                        opacity: 0.5,
                      }}
                    >
                      Waiting for parent to approve your link
                    </div>
                  </div>
                </div>
              ) : (
                <p
                  style={{
                    opacity: 0.35,
                    fontSize: '0.85rem',
                  }}
                >
                  No pending requests
                </p>
              )}
            </div>
          </div>

          {myLink && (
            <div className="chart-card full-width" id="sharingPrefsCard">
              <h3 style={{ marginBottom: 12 }}>Sharing Preferences</h3>
              <p
                className="tracking-desc"
                style={{ fontSize: '0.82rem', marginBottom: 16 }}
              >
                Choose what spending data to share with your family.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    padding: 12,
                    background: 'rgba(128,128,128,0.06)',
                    borderRadius: 10,
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sharingEnabled}
                    onChange={(e) => setSharingEnabled(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: '#10b981' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                      Enable Spending Sharing
                    </div>
                    <div
                      className="tracking-desc"
                      style={{ fontSize: '0.75rem' }}
                    >
                      When on, your expenses are visible to your family admin
                    </div>
                  </div>
                </label>
              </div>
              {sharingEnabled && (
                <div id="shareOptions">
                  <div style={{ marginBottom: 14 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        padding: 10,
                        background: 'rgba(128,128,128,0.06)',
                        borderRadius: 10,
                        marginBottom: 6,
                      }}
                    >
                      <input
                        type="radio"
                        name="shareScope"
                        value="all"
                        checked={shareScope === 'all'}
                        onChange={() => setShareScope('all')}
                        style={{ accentColor: '#10b981' }}
                      />
                      <div>
                        <div
                          style={{ fontWeight: 600, fontSize: '0.85rem' }}
                        >
                          Share All Spending
                        </div>
                        <div
                          className="tracking-desc"
                          style={{ fontSize: '0.72rem' }}
                        >
                          Every expense you log will be visible
                        </div>
                      </div>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        padding: 10,
                        background: 'rgba(128,128,128,0.06)',
                        borderRadius: 10,
                      }}
                    >
                      <input
                        type="radio"
                        name="shareScope"
                        value="selected"
                        checked={shareScope === 'selected'}
                        onChange={() => setShareScope('selected')}
                        style={{ accentColor: '#10b981' }}
                      />
                      <div>
                        <div
                          style={{ fontWeight: 600, fontSize: '0.85rem' }}
                        >
                          Share Specific Categories Only
                        </div>
                        <div
                          className="tracking-desc"
                          style={{ fontSize: '0.72rem' }}
                        >
                          Pick which categories to share
                        </div>
                      </div>
                    </label>
                  </div>
                  {shareScope === 'selected' && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginBottom: 12,
                      }}
                    >
                      {FAMILY_CATEGORIES.map((cat) => (
                        <label
                          key={cat.value}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 10px',
                            background: shareCategories.includes(cat.value)
                              ? 'rgba(16,185,129,0.15)'
                              : 'rgba(128,128,128,0.06)',
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: '0.78rem',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={shareCategories.includes(cat.value)}
                            onChange={() => toggleShareCategory(cat.value)}
                            style={{
                              width: 14,
                              height: 14,
                              accentColor: '#10b981',
                            }}
                          />
                          {cat.label}
                        </label>
                      ))}
                    </div>
                  )}
                  <button
                    className="btn-primary"
                    onClick={saveSharing}
                    style={{ marginTop: 12, width: '100%' }}
                  >
                    Save Preferences
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

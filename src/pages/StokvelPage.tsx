import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useExpenses } from '@/hooks/useExpenses';
import { getCurrencySymbol, monthKey, todayIso } from '@/lib/format';

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

  const sym = getCurrencySymbol(currency);

  const [groups, setGroups] = useState<StokvelGroup[]>([]);
  const [membersMap, setMembersMap] = useState<Record<string, StokvelMember[]>>({});
  const [contribsMap, setContribsMap] = useState<Record<string, StokvelContribution[]>>({});
  const [loading, setLoading] = useState(true);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [contribTarget, setContribTarget] = useState<{ id: string; amount: number } | null>(null);
  const [detailTarget, setDetailTarget] = useState<string | null>(null);

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

  // Copy code feedback
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Load everything — mirrors loadStokvelData() (app.js line 8995).
  // Uses Promise.all over member + contribution fetches per-group so the
  // requests run in parallel instead of a waterfall.
  const loadStokvelData = useCallback(async () => {
    if (!user) {
      setGroups([]);
      setMembersMap({});
      setContribsMap({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: groupsData } = await supabase
        .from('stokvel_groups')
        .select('*')
        .order('created_at', { ascending: false });
      const gs = (groupsData ?? []) as StokvelGroup[];
      setGroups(gs);

      const results = await Promise.all(
        gs.map(async (g) => {
          const [members, contribs] = await Promise.all([
            supabase.from('stokvel_members').select('*').eq('stokvel_id', g.id),
            supabase
              .from('stokvel_contributions')
              .select('*')
              .eq('stokvel_id', g.id)
              .order('date', { ascending: false }),
          ]);
          return {
            id: g.id,
            members: (members.data ?? []) as StokvelMember[],
            contribs: (contribs.data ?? []) as StokvelContribution[],
          };
        }),
      );

      const mMap: Record<string, StokvelMember[]> = {};
      const cMap: Record<string, StokvelContribution[]> = {};
      for (const r of results) {
        mMap[r.id] = r.members;
        cMap[r.id] = r.contribs;
      }
      setMembersMap(mMap);
      setContribsMap(cMap);
    } catch (err) {
      console.warn('Stokvel load error:', err);
      setGroups([]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadStokvelData();
  }, [loadStokvelData]);

  // Stokvel contribution reminders — web Notification API
  // Mirrors checkStokvelReminders() from app.js line 9291
  useEffect(() => {
    if (groups.length === 0 || !user) return;

    const lastReminder = localStorage.getItem('budgetwise-stokvel-reminder');
    const today = todayIso();
    if (lastReminder === today) return; // Only remind once per day

    // Check if any group has a contribution due this month
    const now = new Date();
    const currentMonth = monthKey(now);

    for (const g of groups) {
      const myContribs = (contribsMap[g.id] || []).filter(
        (c) => c.user_id === user.id,
      );
      const paidThisMonth = myContribs.some(
        (c) => monthKey(new Date(c.date)) === currentMonth,
      );
      if (!paidThisMonth && g.monthly_amount > 0) {
        // Show notification via ServiceWorker (mobile-safe)
        const showReminder = () => {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
              reg.showNotification('Stokvel Reminder', {
                body: `Your ${g.name} contribution of ${sym}${g.monthly_amount.toFixed(2)} is due this month.`,
                icon: '/icons/icon-192.png',
                tag: `bw-stokvel-${g.id}`,
              });
            });
          }
        };
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            showReminder();
          } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') showReminder();
            });
          }
        } catch { /* Notification API unavailable on this device */ }
        localStorage.setItem('budgetwise-stokvel-reminder', today);
        break; // One reminder per day is enough
      }
    }
  }, [groups, contribsMap, user, sym]);

  // ============================================================
  // Handlers
  // ============================================================
  const openCreate = () => {
    const now = new Date();
    const start = now.toISOString().split('T')[0];
    const endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    setCName('');
    setCAmount('');
    setCFrequency('monthly');
    setCGoal('');
    setCStart(start);
    setCEnd(endDate.toISOString().split('T')[0]);
    setCBankRef('');
    setCreateOpen(true);
  };

  const handleCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!user) return;
    setCBusy(true);
    try {
      const code = generateStokvelCode();
      const result = await supabase
        .from('stokvel_groups')
        .insert({
          owner_id: user.id,
          name: cName,
          monthly_amount: parseFloat(cAmount),
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

      if (result.data) {
        await supabase.from('stokvel_members').insert({
          stokvel_id: result.data.id,
          user_id: user.id,
          display_name: user.email?.split('@')[0] ?? 'Owner',
          role: 'owner',
          approved: true,
        });
        setCreateOpen(false);
        await loadStokvelData();
      }
    } catch (err) {
      console.error('Create stokvel error:', err);
      alert('Error creating stokvel');
    }
    setCBusy(false);
  };

  const openJoin = () => {
    setJoinCode('');
    setJoinError('');
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
      const group = await supabase
        .from('stokvel_groups')
        .select('*')
        .eq('stokvel_code', code)
        .maybeSingle();
      if (!group.data) {
        setJoinError('Invalid code. Check with the stokvel admin.');
        setJoinBusy(false);
        return;
      }
      if (group.data.owner_id === user.id) {
        setJoinError('You already own this stokvel!');
        setJoinBusy(false);
        return;
      }
      const existing = await supabase
        .from('stokvel_members')
        .select('id')
        .eq('stokvel_id', group.data.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing.data) {
        setJoinError('You are already in this stokvel.');
        setJoinBusy(false);
        return;
      }
      await supabase.from('stokvel_members').insert({
        stokvel_id: group.data.id,
        user_id: user.id,
        display_name: user.email?.split('@')[0] ?? 'Member',
        role: 'member',
        approved: false,
      });
      setJoinOpen(false);
      await loadStokvelData();
    } catch (err) {
      console.error('Join stokvel error:', err);
      setJoinError('Error joining stokvel');
    }
    setJoinBusy(false);
  };

  const openContribute = (g: StokvelGroup) => {
    setContribTarget({ id: g.id, amount: g.monthly_amount });
    setContribAmount(String(g.monthly_amount));
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
      const groupName = group ? group.name : 'Stokvel';

      await supabase.from('stokvel_contributions').insert({
        stokvel_id: contribTarget.id,
        user_id: user.id,
        amount: amt,
        date: contribDate,
        note: contribNote,
      });

      // Also write an expenses row so it shows in totals/pie (app.js line 8971)
      await supabase.from('expenses').insert({
        user_id: user.id,
        category: 'Stokvel',
        description: groupName + (contribNote ? ' — ' + contribNote : ''),
        amount: amt,
        date: contribDate,
        recurring: 'no',
        account_mode: 'personal',
      });

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
    // NOTE: stokvel_members is scoped by id only — the row's user_id is the
    // member being approved, not the caller. RLS must enforce that only the
    // group owner can update. Tightening via RPC is tracked as follow-up.
    await supabase.from('stokvel_members').update({ approved: true }).eq('id', memberId);
    // Add to payout order — app.js line 9201
    const g = groups.find((gr) => gr.id === stokvelId);
    if (g) {
      const order = g.payout_order || [];
      if (order.indexOf(uid) === -1) {
        order.push(uid);
        await supabase
          .from('stokvel_groups')
          .update({ payout_order: order })
          .eq('id', g.id)
          .eq('user_id', user.id);
      }
    }
    await loadStokvelData();
  };

  const handleRejectMember = async (memberId: string) => {
    // See handleApproveMember note — stokvel_members ownership is via the
    // parent group, enforced by RLS. Not scoping by user_id here.
    await supabase.from('stokvel_members').delete().eq('id', memberId);
    await loadStokvelData();
  };

  const handleDeleteStokvel = async (id: string) => {
    if (!user) return;
    if (!confirm('Delete this stokvel and all its data? This cannot be undone.')) return;
    await supabase
      .from('stokvel_groups')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    await loadStokvelData();
  };

  const handleAdvancePayout = async (g: StokvelGroup, recipient: string, amount: number) => {
    if (!user) return;
    if (!confirm('Confirm payout of ' + sym + amount + ' to ' + recipient + '?')) return;
    try {
      const order = g.payout_order || [];
      const curIdx = g.current_payout_index || 0;
      const nextIdx = ((curIdx) + 1) % Math.max(order.length, 1);
      const month = monthKey();
      await supabase.from('stokvel_payouts').insert({
        stokvel_id: g.id,
        recipient_id: order[curIdx],
        amount,
        month,
        paid: true,
      });
      await supabase
        .from('stokvel_groups')
        .update({ current_payout_index: nextIdx })
        .eq('id', g.id)
        .eq('user_id', user.id);
      await loadStokvelData();
    } catch (err) {
      console.error('Payout error:', err);
      alert('Error recording payout');
    }
  };

  const handleConfirmPaid = async (
    stokvelId: string,
    uid: string,
    name: string,
    amount: number,
  ) => {
    try {
      await supabase.from('stokvel_contributions').insert({
        stokvel_id: stokvelId,
        user_id: uid,
        amount,
        date: todayIso(),
        note: 'Confirmed by admin for ' + name,
      });
      await loadStokvelData();
    } catch (err) {
      console.error('Confirm error:', err);
      alert('Error confirming payment');
    }
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
              style={{ background: 'rgba(255,255,255,0.08)' }}
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

        {/* Stokvel Groups */}
        <div id="stokvelGroups" className="stokvel-grid">
          {groups.map((g) => {
            const members = membersMap[g.id] || [];
            const contribs = contribsMap[g.id] || [];
            const approvedMembers = members.filter((m) => m.approved);
            const pendingMembers = members.filter((m) => !m.approved);
            const isOwner = user ? g.owner_id === user.id : false;
            const totalContrib = contribs.reduce((s, c) => s + Number(c.amount), 0);

            const thisMonthContribs = contribs.filter(
              (c) => c.date && c.date.substring(0, 7) === currentMonth,
            );
            const thisMonthTotal = thisMonthContribs.reduce(
              (s, c) => s + Number(c.amount),
              0,
            );
            const monthTarget = g.monthly_amount * approvedMembers.length;
            const monthPct =
              monthTarget > 0 ? Math.min(100, (thisMonthTotal / monthTarget) * 100) : 0;

            const paidUserIds: Record<string, boolean> = {};
            for (const c of thisMonthContribs) paidUserIds[c.user_id] = true;

            const payoutOrder = g.payout_order || [];
            const curPayoutIdx = g.current_payout_index || 0;
            let nextRecipient: StokvelMember | undefined;
            if (payoutOrder.length > 0 && curPayoutIdx < payoutOrder.length) {
              const recipientId = payoutOrder[curPayoutIdx];
              nextRecipient = approvedMembers.find((m) => m.user_id === recipientId);
            }

            const isExpired = g.end_date && new Date(g.end_date) < new Date();

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
                  )}
                </div>

                {(g.start_date || g.end_date) && (
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: isExpired ? '#ef4444' : 'rgba(255,255,255,0.4)',
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
                          color: 'rgba(255,255,255,0.4)',
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
                        background: 'rgba(255,255,255,0.06)',
                        border: 'none',
                        color: 'rgba(255,255,255,0.5)',
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

                <div className="stokvel-stats">
                  <div>
                    <div className="stokvel-stat-label">Monthly/Person</div>
                    <div className="stokvel-stat-value">
                      {sym + Number(g.monthly_amount).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="stokvel-stat-label">Members</div>
                    <div className="stokvel-stat-value">{approvedMembers.length}</div>
                  </div>
                  <div>
                    <div className="stokvel-stat-label">This Month</div>
                    <div className="stokvel-stat-value">
                      {sym + thisMonthTotal.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="stokvel-stat-label">All Time</div>
                    <div className="stokvel-stat-value">
                      {sym + totalContrib.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.7rem',
                    color: 'rgba(255,255,255,0.4)',
                    marginBottom: 4,
                  }}
                >
                  <span>This month</span>
                  <span>{monthPct.toFixed(0)}%</span>
                </div>
                <div className="stokvel-progress">
                  <div
                    className="stokvel-progress-bar"
                    style={{ width: `${monthPct.toFixed(0)}%` }}
                  />
                </div>

                {g.frequency === 'monthly' && nextRecipient && (() => {
                  const isMe = user ? nextRecipient.user_id === user.id : false;
                  const payoutAmount = g.monthly_amount * approvedMembers.length;
                  return (
                    <div
                      style={{
                        background: isMe ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
                        borderRadius: 10,
                        padding: 10,
                        margin: '8px 0',
                        fontSize: '0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <span className="stokvel-goal">Next payout:</span>{' '}
                        <strong style={{ color: isMe ? '#10b981' : 'inherit' }}>
                          {nextRecipient.display_name}
                          {isMe ? ' (You!)' : ''}
                        </strong>
                        {' — '}
                        {sym + payoutAmount.toLocaleString()}
                      </div>
                      {isOwner && (
                        <button
                          type="button"
                          className="btn-advance-payout"
                          onClick={() =>
                            handleAdvancePayout(
                              g,
                              nextRecipient!.display_name,
                              payoutAmount,
                            )
                          }
                          style={{
                            background: '#10b981',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: 8,
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Mark Paid Out
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Members list with paid/unpaid */}
                <div style={{ margin: '8px 0' }}>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: 'rgba(255,255,255,0.4)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    }}
                  >
                    Members
                  </div>
                  {approvedMembers.map((m) => {
                    const paid = paidUserIds[m.user_id];
                    const isMe = user ? m.user_id === user.id : false;
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 0',
                          fontSize: '0.85rem',
                        }}
                      >
                        <span
                          style={{
                            color: paid ? '#10b981' : '#ef4444',
                            fontSize: '1rem',
                          }}
                        >
                          {paid ? '✓' : '✗'}
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
                        {m.role === 'owner' && (
                          <span
                            style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}
                          >
                            admin
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
                          <button
                            type="button"
                            className="btn-approve-member"
                            onClick={() => handleApproveMember(m.id, g.id, m.user_id)}
                            style={{
                              background: '#10b981',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-reject-member"
                            onClick={() => handleRejectMember(m.id)}
                            style={{
                              background: 'rgba(239,68,68,0.15)',
                              color: '#ef4444',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: '0.75rem',
                              cursor: 'pointer',
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
                        color: 'rgba(255,255,255,0.4)',
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
                        color: 'rgba(255,255,255,0.3)',
                        marginTop: 2,
                      }}
                    >
                      Use reference: <strong>{g.stokvel_code}</strong>
                    </div>
                  </div>
                )}

                {/* Admin: confirm payments */}
                {isOwner &&
                  (() => {
                    const unpaidMembers = approvedMembers.filter(
                      (m) =>
                        !paidUserIds[m.user_id] && (user ? m.user_id !== user.id : true),
                    );
                    if (unpaidMembers.length === 0) return null;
                    return (
                      <div style={{ margin: '8px 0' }}>
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: 'rgba(255,255,255,0.4)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            marginBottom: 6,
                          }}
                        >
                          Confirm Payments
                        </div>
                        {unpaidMembers.map((m) => (
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
                            <button
                              type="button"
                              className="btn-confirm-paid"
                              onClick={() =>
                                handleConfirmPaid(
                                  g.id,
                                  m.user_id,
                                  m.display_name,
                                  g.monthly_amount,
                                )
                              }
                              style={{
                                background: '#10b981',
                                color: '#fff',
                                border: 'none',
                                padding: '4px 12px',
                                borderRadius: 6,
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              Confirm Paid
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                {/* Actions */}
                <div className="stokvel-actions">
                  <button
                    type="button"
                    className="btn-contrib"
                    onClick={() => openContribute(g)}
                  >
                    + Contribute
                  </button>
                  <button
                    type="button"
                    className="btn-view-stokvel"
                    onClick={() => setDetailTarget(g.id)}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.7)',
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
        </div>

        {groups.length === 0 && !loading && (
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
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2>Create Stokvel</h2>
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
                <input
                  type="number"
                  className="input"
                  step="0.01"
                  min="0"
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
          onClick={(e) => {
            if (e.target === e.currentTarget) setJoinOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2>Join a Stokvel</h2>
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
          onClick={(e) => {
            if (e.target === e.currentTarget) setContribTarget(null);
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2>Record Contribution</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setContribTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
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

      {/* Detail Modal */}
      {detailTarget && (() => {
        const g = groups.find((x) => x.id === detailTarget);
        if (!g) return null;
        const contribs = contribsMap[detailTarget] || [];
        const members = membersMap[detailTarget] || [];
        const memberMap: Record<string, string> = {};
        for (const m of members) memberMap[m.user_id] = m.display_name;

        return (
          <div
            className="modal-overlay"
            id="stokvelDetailModal"
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
                  {contribs.length === 0 ? (
                    <p
                      style={{
                        color: 'rgba(255,255,255,0.4)',
                        textAlign: 'center',
                        padding: 20,
                      }}
                    >
                      No contributions yet
                    </p>
                  ) : (
                    contribs.map((c) => {
                      const name = memberMap[c.user_id] || 'Unknown';
                      const isMe = user ? c.user_id === user.id : false;
                      return (
                        <div
                          key={c.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
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
                                color: 'rgba(255,255,255,0.4)',
                              }}
                            >
                              {c.date}
                              {c.note ? ' — ' + c.note : ''}
                            </div>
                          </div>
                          <div style={{ fontWeight: 600, color: '#10b981' }}>
                            {sym +
                              Number(c.amount).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                              })}
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
    </>
  );
}

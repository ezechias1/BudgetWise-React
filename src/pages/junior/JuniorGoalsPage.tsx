import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidLedger } from '@/hooks/useKidLedger';
import { enqueueApprovalNudge } from '@/lib/junior-notifications';
import { formatCurrency } from '@/lib/format';

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  status: 'pending' | 'active' | 'declined';
}

/**
 * Kid-facing goals page. Kids propose their own goal (a parent approves it
 * on the Family Goals page before it counts), manually move money they've
 * earned toward an active goal, or ask a parent for a specific amount —
 * mirrors the existing (also non-atomic) parent-side contribute() flow in
 * FamilyGoalsPage.tsx rather than inventing new transactional rigor.
 */
export default function JuniorGoalsPage() {
  const { member, loading: profileLoading, error: profileError } = useKidProfile();
  const {
    owed_cents,
    paid_cents,
    error: ledgerError,
    refresh: refreshLedger,
  } = useKidLedger(member?.id ?? null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [contributed, setContributed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currency, setCurrency] = useState('ZAR');

  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeName, setProposeName] = useState('');
  const [proposeTarget, setProposeTarget] = useState('');
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);

  const [addMoneyGoalId, setAddMoneyGoalId] = useState<string | null>(null);
  const [addMoneyAmount, setAddMoneyAmount] = useState('');
  const [addMoneyError, setAddMoneyError] = useState<string | null>(null);
  const [addingMoney, setAddingMoney] = useState(false);

  const [askGoalId, setAskGoalId] = useState<string | null>(null);
  const [askAmount, setAskAmount] = useState('');
  const [askReason, setAskReason] = useState('');
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askSent, setAskSent] = useState(false);

  const [requests, setRequests] = useState<
    Array<{ id: string; requested_amount_cents: number; approved_amount_cents: number | null; status: string; reason: string | null }>
  >([]);

  const load = useCallback(async () => {
    if (!member) return;
    setLoading(true);
    const [goalsRes, contribRes, reqRes] = await Promise.all([
      supabase
        .from('family_goals')
        .select('id, name, target, saved, status')
        .eq('member_id', member.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('family_goal_contributions')
        .select('amount')
        .eq('member_id', member.id),
      supabase
        .from('kid_money_requests')
        .select('id, requested_amount_cents, approved_amount_cents, status, reason')
        .eq('member_id', member.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    // All three used to be read as .data only, so a failed request was written
    // back as [] / 0 over real values: the kid was told "No goals yet" over
    // goals that exist, and a failed contributions read reset `contributed` to
    // 0, handing them their whole lifetime earnings to allocate a second time.
    // Keep whatever we last loaded and say so instead of overwriting it.
    const readError = goalsRes.error ?? contribRes.error ?? reqRes.error;
    if (readError) {
      setLoadError(readError.message);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setGoals((goalsRes.data as Goal[]) ?? []);
    setContributed(
      ((contribRes.data as { amount: number }[]) ?? []).reduce((sum, c) => sum + c.amount, 0)
    );
    setRequests(reqRes.data ?? []);
    setLoading(false);
  }, [member]);

  useEffect(() => {
    load();
  }, [load]);

  // A kid's session cannot read the parent's user_settings row (RLS is
  // auth.uid() = user_id), so the family's currency comes from a
  // security-definer RPC. This page used to hardcode R for all eleven amounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_kid_currency');
      if (cancelled || error || !data) return;
      setCurrency(data as string);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatMoney = (amount: number) => formatCurrency(amount, currency);

  // Gate ORDER matters. This was one combined condition with `loading` tested
  // alongside `!member`, and load() returns early on `if (!member) return;`
  // without clearing `loading` — so a failed kid-profile read pinned the page
  // on a bare "Loading…" forever and the error banner below (plus its Try
  // again) could never be reached. Check profileLoading, then !member, then
  // this page's own load.
  if (profileLoading) return <p>Loading…</p>;
  if (!member)
    return (
      <div style={{ background: 'white', borderRadius: 16, padding: 20, color: '#1a1a2e' }}>
        <p style={{ margin: 0 }}>
          {profileError
            ? "We couldn't load your profile just now. Check your connection and try again."
            : 'Something went wrong — no profile found.'}
        </p>
        {/* useKidProfile exposes no refetch, so a reload is the only retry we
            can offer from here without reaching into the hook. */}
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 12 }}
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  if (loading) return <p>Loading…</p>;

  const activeGoals = goals.filter((g) => g.status === 'active');
  const pendingGoals = goals.filter((g) => g.status === 'pending');

  // Lifetime earned (owed + already settled), minus whatever's already been
  // put into any goal — the ceiling on how much a kid can move today.
  const lifetimeEarnedRands = (owed_cents + paid_cents) / 100;
  // Fail closed while a read is broken: `contributed` is the only thing that
  // brings this number down, so a failed contributions read would otherwise
  // raise the ceiling to full lifetime earnings and let the kid allocate money
  // they have already put into a goal.
  //
  // `ledgerError` counts too, in the other direction. useKidLedger keeps
  // owed_cents and paid_cents at 0 when its read fails, so the ceiling silently
  // became R0.00 and "Add money" refused with "You've only got R0.00 left" over
  // a real balance — a confident wrong number on the one screen where a child
  // acts on it. Both failures now mean "we don't know", not "you have nothing".
  const balanceUnknown = ledgerError !== null || loadError !== null;
  const availableToAllocate = balanceUnknown
    ? 0
    : Math.max(lifetimeEarnedRands - contributed, 0);

  const handlePropose = async (e: FormEvent) => {
    e.preventDefault();
    setProposeError(null);
    const target = parseFloat(proposeTarget);
    if (!proposeName.trim() || !Number.isFinite(target) || target <= 0) {
      setProposeError('Give it a name and a target amount above 0.');
      return;
    }
    setProposing(true);
    const { error } = await supabase.from('family_goals').insert({
      user_id: member.user_id,
      member_id: member.id,
      name: proposeName.trim(),
      target,
      saved: 0,
      status: 'pending',
    });
    setProposing(false);
    if (error) {
      setProposeError(error.message);
      return;
    }
    setProposeName('');
    setProposeTarget('');
    setProposeOpen(false);
    void enqueueApprovalNudge(
      member.user_id,
      member.name,
      'goal_proposal',
      `${proposeName.trim()} (${formatMoney(target)})`,
      '/dashboard/family-goals',
    );
    await load();
  };

  const handleAddMoney = async (e: FormEvent) => {
    e.preventDefault();
    if (!addMoneyGoalId) return;
    setAddMoneyError(null);
    const amount = parseFloat(addMoneyAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAddMoneyError('Enter an amount above 0.');
      return;
    }
    if (balanceUnknown) {
      // Must come before the amount check below, or a broken read reports the
      // failure as "You've only got R0.00 left" — a number, not a problem, and
      // the child has no reason to doubt it.
      setAddMoneyError("We couldn't check how much you have left. Tap Try again first.");
      return;
    }
    if (amount > availableToAllocate) {
      setAddMoneyError(`You've only got ${formatMoney(availableToAllocate)} left to put toward goals.`);
      return;
    }
    setAddingMoney(true);
    const goal = goals.find((g) => g.id === addMoneyGoalId);
    // Two-step and not atomic. The contribution insert used to discard its
    // error, so a failure left the goal showing the money with no record of
    // which kid put it in — the same bug fixed in the parent's contribute()
    // in FamilyGoalsPage.tsx. On failure we put the total back.
    const previousSaved = goal?.saved ?? 0;
    // .select() matters here: an UPDATE that RLS blocks returns 200 with zero
    // rows and no error, so without it a kid would be told their money went
    // in while the goal never changed — and the contribution insert below
    // would then be rolled back against a total that was never raised.
    const { data: raised, error: updateError } = await supabase
      .from('family_goals')
      .update({ saved: previousSaved + amount })
      .eq('id', addMoneyGoalId)
      .select('id');
    if (updateError || !raised || raised.length === 0) {
      setAddingMoney(false);
      setAddMoneyError(
        updateError?.message ??
          "That didn't save — your account can't change this goal yet. Ask a parent.",
      );
      return;
    }
    const { error: contribError } = await supabase
      .from('family_goal_contributions')
      .insert({
        // No user_id: the column doesn't exist on this table, and sending it
        // made every contribution 400. Ownership is already established —
        // the kid policy checks member_id, the parent policy reads user_id
        // off the parent goal row.
        goal_id: addMoneyGoalId,
        member_id: member.id,
        amount,
      });
    if (contribError) {
      const { data: restored, error: rollbackError } = await supabase
        .from('family_goals')
        .update({ saved: previousSaved })
        .eq('id', addMoneyGoalId)
        .select('id');
      const rollbackFailed =
        !!rollbackError || !restored || restored.length === 0;
      setAddingMoney(false);
      setAddMoneyError(
        rollbackFailed
          ? `That didn't save, and the goal total is now ${formatMoney(amount)} too high. Ask a parent to fix it.`
          : "That didn't save. Please try again.",
      );
      return;
    }
    setAddingMoney(false);
    setAddMoneyAmount('');
    setAddMoneyGoalId(null);
    await Promise.all([load(), refreshLedger()]);
  };

  const handleAsk = async (e: FormEvent) => {
    e.preventDefault();
    setAskError(null);
    const amount = parseFloat(askAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAskError('Enter an amount above 0.');
      return;
    }
    setAsking(true);
    const { error } = await supabase.from('kid_money_requests').insert({
      user_id: member.user_id,
      member_id: member.id,
      goal_id: askGoalId,
      requested_amount_cents: Math.round(amount * 100),
      reason: askReason.trim() || null,
    });
    setAsking(false);
    if (error) {
      setAskError(error.message);
      return;
    }
    setAskAmount('');
    setAskReason('');
    setAskGoalId(null);
    setAskSent(true);
    setTimeout(() => setAskSent(false), 3000);
    void enqueueApprovalNudge(
      member.user_id,
      member.name,
      'money_request',
      `Asking for ${formatMoney(amount)}`,
      '/dashboard/junior',
    );
    await load();
  };

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 16 }}>
        <h1>Your goals</h1>
        <p>Save up for something you want, or ask your parents for help.</p>
      </section>

      <div style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 16, color: '#1a1a2e' }}>
        <p style={{ margin: 0, opacity: 0.7, fontSize: '0.85rem' }}>Available to put toward goals</p>
        <p style={{ margin: '4px 0 0', fontSize: '1.6rem', fontWeight: 700, color: '#10b981' }}>
          {/* A dash, not R0.00: while a read is broken we genuinely don't know
              the number, and a confident zero is its own lie. */}
          {/* A dash, not a confident 0.00 — same reason as the owed tile on the
              home screen. This covers a failed ledger read as well as a failed
              goals read; both leave the number unknowable, and only one of them
              used to show it. */}
          {balanceUnknown ? '—' : formatMoney(availableToAllocate)}
        </p>
      </div>

      {/* Covers a failed LEDGER read too, not only a failed goals read. Without
          that the money tile showed a bare "—" with nothing on screen to say
          why, and Try again refreshed the goals but never the ledger. */}
      {(loadError || ledgerError) && (
        <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {loadError
              ? "We couldn't load your goals just now, so this might not be everything."
              : "We couldn't check how much money you have just now."}
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 10 }}
            onClick={() => {
              void load();
              void refreshLedger();
            }}
          >
            Try again
          </button>
        </div>
      )}

      {askSent && (
        <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: 12, padding: 12, marginBottom: 16, fontWeight: 600 }}>
          Sent! Your parents will decide soon.
        </div>
      )}

      {/* Gated on !loadError: "No goals yet" over a failed read is what made
          kids propose a duplicate for their parent to approve. */}
      {!loadError && activeGoals.length === 0 && pendingGoals.length === 0 && !proposeOpen && (
        <p style={{ opacity: 0.6, marginBottom: 16 }}>No goals yet — propose one below.</p>
      )}

      {activeGoals.map((g) => {
        const remaining = Math.max(g.target - g.saved, 0);
        const pct = g.target > 0 ? Math.min((g.saved / g.target) * 100, 100) : 0;
        return (
          <div key={g.id} style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 12, color: '#1a1a2e' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{g.name}</strong>
              <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>{formatMoney(remaining)} to go</span>
            </div>
            <div style={{ height: 8, background: '#eee', borderRadius: 4, margin: '10px 0', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', transition: 'width 200ms' }} />
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.8rem', opacity: 0.6 }}>
              {formatMoney(g.saved)} of {formatMoney(g.target)}
            </p>

            {addMoneyGoalId === g.id ? (
              <form onSubmit={handleAddMoney} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  value={addMoneyAmount}
                  onChange={(e) => setAddMoneyAmount(e.target.value)}
                  placeholder="Amount"
                  style={{ flex: 1, minWidth: 100, padding: 10, borderRadius: 10, border: '1px solid #e5e7eb' }}
                />
                <button type="submit" className="btn-primary" disabled={addingMoney}>
                  {addingMoney ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={() => { setAddMoneyGoalId(null); setAddMoneyError(null); }}>
                  Cancel
                </button>
              </form>
            ) : askGoalId === g.id ? (
              <form onSubmit={handleAsk} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  value={askAmount}
                  onChange={(e) => setAskAmount(e.target.value)}
                  placeholder="How much?"
                  style={{ padding: 10, borderRadius: 10, border: '1px solid #e5e7eb' }}
                />
                <input
                  type="text"
                  value={askReason}
                  onChange={(e) => setAskReason(e.target.value)}
                  placeholder="Why? (optional)"
                  style={{ padding: 10, borderRadius: 10, border: '1px solid #e5e7eb' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn-primary" disabled={asking}>
                    {asking ? 'Sending…' : 'Ask parents'}
                  </button>
                  <button type="button" onClick={() => { setAskGoalId(null); setAskError(null); }}>
                    Cancel
                  </button>
                </div>
                {askError && <p style={{ color: '#dc2626', margin: 0 }}>{askError}</p>}
              </form>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" onClick={() => setAddMoneyGoalId(g.id)}>
                  Add money
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAskGoalId(g.id)}>
                  Ask parents
                </button>
              </div>
            )}
            {addMoneyGoalId === g.id && addMoneyError && (
              <p style={{ color: '#dc2626', margin: '8px 0 0' }}>{addMoneyError}</p>
            )}
          </div>
        );
      })}

      {pendingGoals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, margin: '0 0 8px' }}>
            Waiting for approval
          </p>
          {pendingGoals.map((g) => (
            <div key={g.id} style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 8, color: '#1a1a2e', opacity: 0.7 }}>
              <strong>{g.name}</strong> — {formatMoney(g.target)}
              <span style={{ marginLeft: 8, fontSize: '0.75rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 999 }}>
                Pending
              </span>
            </div>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, margin: '0 0 8px' }}>
            Your requests
          </p>
          {requests.map((r) => (
            <div key={r.id} style={{ background: 'white', borderRadius: 16, padding: '10px 16px', marginBottom: 8, color: '#1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {formatMoney(r.requested_amount_cents / 100)}
                {r.reason && <span style={{ opacity: 0.6 }}> — {r.reason}</span>}
              </span>
              {r.status === 'pending' && (
                <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 999 }}>Pending</span>
              )}
              {r.status === 'approved' && (
                <span style={{ fontSize: '0.75rem', background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 999 }}>
                  Approved {formatMoney((r.approved_amount_cents ?? 0) / 100)}
                </span>
              )}
              {r.status === 'declined' && (
                <span style={{ fontSize: '0.75rem', background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 999 }}>Declined</span>
              )}
            </div>
          ))}
        </div>
      )}

      {proposeOpen ? (
        <form onSubmit={handlePropose} style={{ background: 'white', borderRadius: 16, padding: 16, color: '#1a1a2e' }}>
          <p style={{ margin: '0 0 10px', fontWeight: 600 }}>Propose a new goal</p>
          <input
            type="text"
            autoFocus
            value={proposeName}
            onChange={(e) => setProposeName(e.target.value)}
            placeholder="e.g. New bike"
            style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 8, boxSizing: 'border-box' }}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={proposeTarget}
            onChange={(e) => setProposeTarget(e.target.value)}
            placeholder="Target amount"
            style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 8, boxSizing: 'border-box' }}
          />
          {proposeError && <p style={{ color: '#dc2626', margin: '0 0 8px' }}>{proposeError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={proposing}>
              {proposing ? 'Sending…' : 'Send to parents'}
            </button>
            <button type="button" onClick={() => setProposeOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setProposeOpen(true)} style={{ width: '100%' }}>
          + Propose a new goal
        </button>
      )}

      <p style={{ marginTop: 20 }}>
        <Link to="/junior/jars">Back to jars →</Link>
      </p>
    </>
  );
}

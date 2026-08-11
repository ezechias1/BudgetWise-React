import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidLedger } from '@/hooks/useKidLedger';
import { enqueueApprovalNudge } from '@/lib/junior-notifications';

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  status: 'pending' | 'active' | 'declined';
}

function formatRands(amount: number): string {
  return `R${amount.toFixed(2)}`;
}

/**
 * Kid-facing goals page. Kids propose their own goal (a parent approves it
 * on the Family Goals page before it counts), manually move money they've
 * earned toward an active goal, or ask a parent for a specific amount —
 * mirrors the existing (also non-atomic) parent-side contribute() flow in
 * FamilyGoalsPage.tsx rather than inventing new transactional rigor.
 */
export default function JuniorGoalsPage() {
  const { member, loading: profileLoading } = useKidProfile();
  const { owed_cents, paid_cents, refresh: refreshLedger } = useKidLedger(member?.id ?? null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [contributed, setContributed] = useState(0);
  const [loading, setLoading] = useState(true);

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

  if (profileLoading || loading || !member) return <p>Loading…</p>;

  const activeGoals = goals.filter((g) => g.status === 'active');
  const pendingGoals = goals.filter((g) => g.status === 'pending');

  // Lifetime earned (owed + already settled), minus whatever's already been
  // put into any goal — the ceiling on how much a kid can move today.
  const lifetimeEarnedRands = (owed_cents + paid_cents) / 100;
  const availableToAllocate = Math.max(lifetimeEarnedRands - contributed, 0);

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
      `${proposeName.trim()} (${formatRands(target)})`,
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
    if (amount > availableToAllocate) {
      setAddMoneyError(`You've only got ${formatRands(availableToAllocate)} left to put toward goals.`);
      return;
    }
    setAddingMoney(true);
    const goal = goals.find((g) => g.id === addMoneyGoalId);
    // Same two-step pattern as the parent's own contribute() in
    // FamilyGoalsPage.tsx — not atomic, matches the existing level of rigor.
    const { error: updateError } = await supabase
      .from('family_goals')
      .update({ saved: (goal?.saved ?? 0) + amount })
      .eq('id', addMoneyGoalId);
    if (!updateError) {
      await supabase.from('family_goal_contributions').insert({
        goal_id: addMoneyGoalId,
        member_id: member.id,
        user_id: member.user_id,
        amount,
      });
    }
    setAddingMoney(false);
    if (updateError) {
      setAddMoneyError(updateError.message);
      return;
    }
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
      `Asking for ${formatRands(amount)}`,
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
          {formatRands(availableToAllocate)}
        </p>
      </div>

      {askSent && (
        <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: 12, padding: 12, marginBottom: 16, fontWeight: 600 }}>
          Sent! Your parents will decide soon.
        </div>
      )}

      {activeGoals.length === 0 && pendingGoals.length === 0 && !proposeOpen && (
        <p style={{ opacity: 0.6, marginBottom: 16 }}>No goals yet — propose one below.</p>
      )}

      {activeGoals.map((g) => {
        const remaining = Math.max(g.target - g.saved, 0);
        const pct = g.target > 0 ? Math.min((g.saved / g.target) * 100, 100) : 0;
        return (
          <div key={g.id} style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 12, color: '#1a1a2e' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{g.name}</strong>
              <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>{formatRands(remaining)} to go</span>
            </div>
            <div style={{ height: 8, background: '#eee', borderRadius: 4, margin: '10px 0', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', transition: 'width 200ms' }} />
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.8rem', opacity: 0.6 }}>
              {formatRands(g.saved)} of {formatRands(g.target)}
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
              <strong>{g.name}</strong> — {formatRands(g.target)}
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
                {formatRands(r.requested_amount_cents / 100)}
                {r.reason && <span style={{ opacity: 0.6 }}> — {r.reason}</span>}
              </span>
              {r.status === 'pending' && (
                <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 999 }}>Pending</span>
              )}
              {r.status === 'approved' && (
                <span style={{ fontSize: '0.75rem', background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 999 }}>
                  Approved {formatRands((r.approved_amount_cents ?? 0) / 100)}
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

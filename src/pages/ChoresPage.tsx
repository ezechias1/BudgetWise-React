import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

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
}

function symbolFor(currency: string): string {
  const sym: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
    KES: 'KSh', GHS: 'GH\u20B5', INR: '\u20B9', BRL: 'R$', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$',
  };
  return sym[currency] || currency + ' ';
}

export default function ChoresPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reward, setReward] = useState('');
  const [frequency, setFrequency] = useState('once');

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
    setMembers((mRes.data as FamilyMember[]) || []);
    setChores((cRes.data as Chore[]) || []);
    if (sRes.data?.currency) setCurrency(sRes.data.currency);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const chore = {
      user_id: user.id,
      name: name.trim(),
      assignee: assignee || null,
      reward: parseFloat(reward) || 0,
      frequency,
      completed: false,
      pending_approval: false,
    };
    const { data } = await supabase
      .from('family_chores')
      .insert(chore)
      .select()
      .single();
    if (data) setChores((prev) => [...prev, data as Chore]);
    setName('');
    setAssignee('');
    setReward('');
    setFrequency('once');
    setShowModal(false);
  };

  /** Child marks chore done → goes to pending_approval. */
  const markDone = async (chore: Chore) => {
    await supabase
      .from('family_chores')
      .update({ pending_approval: true })
      .eq('id', chore.id);
    setChores((prev) =>
      prev.map((c) =>
        c.id === chore.id ? { ...c, pending_approval: true } : c,
      ),
    );
  };

  /** Parent approves → completed + reward credited. */
  const approveChore = async (chore: Chore) => {
    await supabase
      .from('family_chores')
      .update({ completed: true, pending_approval: false })
      .eq('id', chore.id);
    setChores((prev) =>
      prev.map((c) =>
        c.id === chore.id
          ? { ...c, completed: true, pending_approval: false }
          : c,
      ),
    );
    // Credit assignee
    if (chore.assignee) {
      const member = members.find((m) => m.id === chore.assignee);
      if (member) {
        const earned = (member.earned || 0) + chore.reward;
        const allowance = (member.allowance || 0) + chore.reward;
        await supabase
          .from('family_members')
          .update({ earned, allowance })
          .eq('id', member.id);
        setMembers((prev) =>
          prev.map((p) =>
            p.id === member.id ? { ...p, earned, allowance } : p,
          ),
        );
      }
    }
  };

  /** Parent rejects → back to not done. */
  const rejectChore = async (chore: Chore) => {
    await supabase
      .from('family_chores')
      .update({ pending_approval: false, completed: false })
      .eq('id', chore.id);
    setChores((prev) =>
      prev.map((c) =>
        c.id === chore.id
          ? { ...c, pending_approval: false, completed: false }
          : c,
      ),
    );
  };

  /** Direct toggle for quick complete (parent shortcut). */
  const toggleComplete = async (chore: Chore) => {
    if (chore.completed) {
      // Un-complete
      await supabase
        .from('family_chores')
        .update({ completed: false, pending_approval: false })
        .eq('id', chore.id);
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

  const deleteChore = async (id: string) => {
    await supabase.from('family_chores').delete().eq('id', id);
    setChores((prev) => prev.filter((c) => c.id !== id));
  };

  const sym = symbolFor(currency);

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
      <div className="chores-list" id="choresList">
        {chores.length === 0 ? (
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
                        style={{
                          color: '#10b981',
                          fontWeight: 700,
                          fontSize: '1rem',
                        }}
                      >
                        ✓
                      </button>
                      <button
                        title="Reject"
                        onClick={() => rejectChore(ch)}
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
                  <button title="Delete" onClick={() => deleteChore(ch.id)}>
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" id="choreModal">
          <div className="modal">
            <div className="modal-header">
              <h2>Add Chore</h2>
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
              >
                Add Chore
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

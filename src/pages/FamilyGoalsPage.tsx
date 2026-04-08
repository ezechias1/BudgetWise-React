import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Ports #page-family-goals from dashboard.html (line 1815) and
 * `renderFamilyGoals()` in js/app.js (line 1600).
 *
 * Shared savings goals for the household. Contribute flow uses a prompt
 * picker (matches vanilla). Writes to `family_goals` and
 * `family_goal_contributions`.
 */

interface FamilyMember {
  id: string;
  name: string;
  color: string;
}

interface FamilyGoal {
  id: string;
  user_id: string;
  name: string;
  target: number;
  saved: number;
  deadline: string | null;
  contributions: Record<string, number>;
}

function symbolFor(currency: string): string {
  const sym: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
    KES: 'KSh', GHS: 'GH\u20B5', INR: '\u20B9', BRL: 'R$', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$',
  };
  return sym[currency] || currency + ' ';
}

function fmt(n: number, sym: string): string {
  return (
    sym +
    Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function FamilyGoalsPage() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<FamilyGoal[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const [gRes, mRes, sRes] = await Promise.all([
      supabase
        .from('family_goals')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at'),
      supabase
        .from('family_members')
        .select('id, name, color')
        .eq('user_id', user.id)
        .order('created_at'),
      supabase
        .from('user_settings')
        .select('currency')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    const baseGoals = (gRes.data as FamilyGoal[]) || [];
    // Fetch contributions
    if (baseGoals.length > 0) {
      const goalIds = baseGoals.map((g) => g.id);
      const contribRes = await supabase
        .from('family_goal_contributions')
        .select('*')
        .in('goal_id', goalIds);
      const contribs = (contribRes.data as Array<{
        goal_id: string;
        member_id: string;
        amount: number;
      }>) || [];
      baseGoals.forEach((g) => {
        g.contributions = {};
        contribs.forEach((c) => {
          if (c.goal_id === g.id) {
            g.contributions[c.member_id] =
              (g.contributions[c.member_id] || 0) + Number(c.amount);
          }
        });
      });
    }
    setGoals(baseGoals);
    setMembers((mRes.data as FamilyMember[]) || []);
    if (sRes.data?.currency) setCurrency(sRes.data.currency);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const goal = {
      user_id: user.id,
      name: name.trim(),
      target: parseFloat(target),
      saved: 0,
      deadline: deadline || null,
    };
    const { data } = await supabase
      .from('family_goals')
      .insert(goal)
      .select()
      .single();
    if (data) {
      setGoals((prev) => [
        ...prev,
        { ...(data as FamilyGoal), contributions: {} },
      ]);
    }
    setName('');
    setTarget('');
    setDeadline('');
    setShowModal(false);
  };

  const contribute = async (goal: FamilyGoal) => {
    if (members.length === 0) {
      alert('Add family members first!');
      return;
    }
    const memberNames = members.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
    const choice = prompt(`Who is contributing?\n${memberNames}\n\nEnter number:`);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx < 0 || idx >= members.length) {
      alert('Invalid choice');
      return;
    }
    const amount = prompt('How much to contribute?');
    if (!amount || isNaN(parseFloat(amount))) return;
    const amt = parseFloat(amount);
    const member = members[idx];
    const nextSaved = goal.saved + amt;
    await supabase
      .from('family_goals')
      .update({ saved: nextSaved })
      .eq('id', goal.id);
    await supabase.from('family_goal_contributions').insert({
      goal_id: goal.id,
      member_id: member.id,
      amount: amt,
      user_id: user?.id,
    });
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== goal.id) return g;
        const contributions = { ...(g.contributions || {}) };
        contributions[member.id] = (contributions[member.id] || 0) + amt;
        return { ...g, saved: nextSaved, contributions };
      }),
    );
  };

  const deleteGoal = async (id: string) => {
    if (!confirm('Delete this family goal?')) return;
    await supabase.from('family_goals').delete().eq('id', id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const sym = symbolFor(currency);

  return (
    <section className="page active" id="page-family-goals">
      <div className="page-header">
        <div>
          <h1>Family Goals</h1>
          <p className="page-subtitle">Save together as a family</p>
        </div>
        <button
          className="btn-primary"
          id="addFamilyGoalBtn"
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
          New Goal
        </button>
      </div>
      <div className="family-goals-grid" id="familyGoalsGrid">
        {goals.length === 0 ? (
          <div className="empty-state" id="emptyFamilyGoals">
            <svg
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.3 }}
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            <p>
              No family goals yet. Start saving together for something
              special!
            </p>
          </div>
        ) : (
          goals.map((g) => {
            const pct =
              g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
            const deadlineStr = g.deadline
              ? new Date(g.deadline).toLocaleDateString('default', {
                  month: 'short',
                  year: 'numeric',
                })
              : '';
            const contribEntries = Object.entries(g.contributions || {});
            return (
              <div className="family-goal-card" key={g.id}>
                <div className="family-goal-header">
                  <div className="family-goal-name">{g.name}</div>
                  {deadlineStr && (
                    <div className="family-goal-deadline">{deadlineStr}</div>
                  )}
                </div>
                <div className="family-goal-progress">
                  <div className="family-goal-bar-track">
                    <div
                      className="family-goal-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="family-goal-amounts">
                    <span className="family-goal-saved">
                      {fmt(g.saved, sym)}
                    </span>
                    <span className="family-goal-target">
                      {fmt(g.target, sym)}
                    </span>
                  </div>
                </div>
                {contribEntries.length > 0 && (
                  <div className="family-goal-contributors">
                    <h5>Contributors</h5>
                    {contribEntries.map(([memId, amt]) => {
                      const member = members.find((m) => m.id === memId);
                      if (!member) return null;
                      return (
                        <div className="contributor-row" key={memId}>
                          <div
                            className="contributor-dot"
                            style={{ background: member.color }}
                          />
                          <span className="contributor-name">
                            {member.name}
                          </span>
                          <span className="contributor-amount">
                            {fmt(amt, sym)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="family-goal-actions">
                  <button
                    className="btn-contribute"
                    onClick={() => contribute(g)}
                  >
                    Contribute
                  </button>
                  <button
                    className="btn-goal-delete"
                    onClick={() => deleteGoal(g.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" id="familyGoalModal">
          <div className="modal">
            <div className="modal-header">
              <h2>New Family Goal</h2>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Goal Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Family Vacation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Target Amount</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  placeholder="5000.00"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Target Date</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%' }}
              >
                Create Goal
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

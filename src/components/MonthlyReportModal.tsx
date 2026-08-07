import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface FamilyMember {
  id: string;
  name: string;
  color: string;
  allowance: number;
  spent: number;
  earned: number;
}

interface Chore {
  id: string;
  assignee: string | null;
  completed: boolean;
  reward: number;
}

interface FamilyGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currency: string;
}

function sym(currency: string): string {
  const s: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
  };
  return s[currency] || currency + ' ';
}

/**
 * Monthly Family Report modal — shows a breakdown of the month:
 * per-member spending, completed chores, goal progress, top categories.
 */
export function MonthlyReportModal({ open, onClose, currency }: Props) {
  const { user } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [goals, setGoals] = useState<FamilyGoal[]>([]);
  const [expenses, setExpenses] = useState<Array<{ category: string; amount: number }>>([]);
  const [loading, setLoading] = useState(true);

  const s = sym(currency);
  const now = new Date();
  const monthLabel = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [mRes, cRes, gRes, eRes] = await Promise.all([
      supabase.from('family_members').select('*').eq('user_id', user.id),
      supabase.from('family_chores').select('*').eq('user_id', user.id),
      supabase.from('family_goals').select('*').eq('user_id', user.id),
      supabase
        .from('expenses')
        .select('category, amount')
        .eq('user_id', user.id)
        .eq('account_mode', 'family')
        .gte('date', monthKey + '-01')
        .lt('date', monthKey + '-32'),
    ]);
    setMembers((mRes.data as FamilyMember[]) || []);
    setChores((cRes.data as Chore[]) || []);
    setGoals((gRes.data as FamilyGoal[]) || []);
    setExpenses((eRes.data as Array<{ category: string; amount: number }>) || []);
    setLoading(false);
  }, [user, monthKey]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalAllowances = members.reduce((sum, m) => sum + (m.allowance || 0), 0);
  const completedChores = chores.filter((c) => c.completed).length;
  const totalChores = chores.length;
  const totalEarned = chores
    .filter((c) => c.completed)
    .reduce((sum, c) => sum + (c.reward || 0), 0);

  // Top categories
  const catMap = new Map<string, number>();
  expenses.forEach((e) => {
    catMap.set(e.category, (catMap.get(e.category) || 0) + Number(e.amount));
  });
  const topCategories = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Family Report — {monthLabel}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <p style={{ padding: 24, textAlign: 'center', opacity: 0.4 }}>
            Loading...
          </p>
        ) : (
          <div style={{ padding: '0 20px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div style={{ padding: 12, background: 'rgba(128,128,128,0.06)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{s}{totalSpent.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.45 }}>Total Spent</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(128,128,128,0.06)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{s}{totalAllowances.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.45 }}>Weekly Allowances</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(128,128,128,0.06)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{completedChores}/{totalChores}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.45 }}>Chores Done</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(128,128,128,0.06)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{s}{totalEarned.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.45 }}>Earned from Chores</div>
              </div>
            </div>

            {/* Per-member breakdown */}
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: 8 }}>Per Member</h3>
            {members.length === 0 ? (
              <p style={{ fontSize: '0.82rem', opacity: 0.35 }}>No members added</p>
            ) : (
              members.map((m) => {
                const memberChores = chores.filter((c) => c.assignee === m.id && c.completed).length;
                const pct = m.allowance > 0 ? Math.min(100, ((m.spent || 0) / m.allowance) * 100) : 0;
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.65rem', color: '#fff', flexShrink: 0 }}>
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{m.name}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.4 }}>
                        {s}{(m.spent || 0).toFixed(2)} spent · {memberChores} chores done
                      </div>
                    </div>
                    <div style={{ width: 50, height: 5, borderRadius: 3, background: 'rgba(128,128,128,0.1)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? '#ef4444' : m.color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })
            )}

            {/* Top spending categories */}
            {topCategories.length > 0 && (
              <>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, margin: '16px 0 8px' }}>Top Categories</h3>
                {topCategories.map(([cat, amount]) => (
                  <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.82rem', borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
                    <span>{cat}</span>
                    <span style={{ fontWeight: 600 }}>{s}{Number(amount).toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}

            {/* Family goals progress */}
            {goals.length > 0 && (
              <>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, margin: '16px 0 8px' }}>Goal Progress</h3>
                {goals.map((g) => {
                  const pct = g.target > 0 ? Math.min(100, ((g.saved || 0) / g.target) * 100) : 0;
                  return (
                    <div key={g.id} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 3 }}>
                        <span style={{ fontWeight: 600 }}>{g.name}</span>
                        <span>{s}{(g.saved || 0).toFixed(2)} / {s}{g.target.toFixed(2)}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'rgba(128,128,128,0.1)' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#8b5cf6', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { WishListModal } from '@/components/WishListModal';

/**
 * Ports #page-allowances from dashboard.html (line 1750) and
 * `renderAllowances()` in js/app.js (line 1455).
 *
 * Shows a progress card for each member with a weekly allowance > 0.
 * Log-spend / reset buttons update `family_members.spent`.
 * Savings leaderboard, family overview bars, and tip banner are stubbed.
 */

interface FamilyMember {
  id: string;
  user_id: string;
  name: string;
  role: string;
  color: string;
  allowance: number;
  spent: number;
  earned: number;
}

function symbolFor(currency: string): string {
  const sym: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
    KES: 'KSh', GHS: 'GH\u20B5', INR: '\u20B9', BRL: 'R$', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$',
  };
  return sym[currency] || currency + ' ';
}

export default function AllowancesPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [tipDismissed, setTipDismissed] = useState(false);
  const [wishListOpen, setWishListOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [mRes, sRes] = await Promise.all([
      supabase
        .from('family_members')
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
    if (sRes.data?.currency) setCurrency(sRes.data.currency);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const logSpend = async (m: FamilyMember) => {
    const amount = prompt('How much was spent?');
    if (!amount || isNaN(parseFloat(amount))) return;
    const next = (m.spent || 0) + parseFloat(amount);
    await supabase
      .from('family_members')
      .update({ spent: next })
      .eq('id', m.id);
    setMembers((prev) =>
      prev.map((p) => (p.id === m.id ? { ...p, spent: next } : p)),
    );
  };

  const resetAllowance = async (m: FamilyMember) => {
    if (!confirm('Reset this allowance to 0 spent?')) return;
    await supabase
      .from('family_members')
      .update({ spent: 0, earned: 0 })
      .eq('id', m.id);
    setMembers((prev) =>
      prev.map((p) => (p.id === m.id ? { ...p, spent: 0, earned: 0 } : p)),
    );
  };

  const sym = symbolFor(currency);
  const withAllowance = members.filter((m) => m.allowance > 0);
  const leaderboard = [...members].sort(
    (a, b) =>
      Math.max(0, b.allowance - (b.spent || 0)) -
      Math.max(0, a.allowance - (a.spent || 0)),
  );

  return (
    <section className="page active" id="page-allowances">
      <div className="page-header">
        <div>
          <h1>Allowances</h1>
          <p className="page-subtitle">Track spending money for each member</p>
        </div>
      </div>

      {!tipDismissed && (
        <div className="tip-banner" id="familyTipBanner">
          <span className="tip-banner-icon">💡</span>
          <span className="tip-banner-text">
            Reward saving — not just spending — to build lasting habits.
          </span>
          <button
            className="tip-dismiss"
            onClick={() => setTipDismissed(true)}
          >
            ×
          </button>
        </div>
      )}

      {/* TODO: parent allowance warnings */}
      <div id="allowanceWarnings"></div>

      <div className="allowance-cards" id="allowanceCards">
        {withAllowance.length === 0 ? (
          <div className="empty-state" id="emptyAllowances">
            <svg
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.3 }}
            >
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            <p>Add family members first, then set up their allowances.</p>
          </div>
        ) : (
          withAllowance.map((m) => {
            const remaining = Math.max(0, m.allowance - (m.spent || 0));
            const pct =
              m.allowance > 0
                ? Math.min(100, ((m.spent || 0) / m.allowance) * 100)
                : 0;
            const barColor =
              pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : m.color;
            return (
              <div className="allowance-card" key={m.id}>
                <div className="allowance-header">
                  <div className="allowance-header-left">
                    <div
                      className="allowance-mini-avatar"
                      style={{ background: m.color }}
                    >
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="allowance-name">{m.name}</div>
                      <div className="allowance-amount">
                        {sym}
                        {Number(m.allowance).toFixed(2)}/week
                      </div>
                    </div>
                  </div>
                </div>
                <div className="allowance-progress">
                  <div className="allowance-bar-track">
                    <div
                      className="allowance-bar-fill"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                  <div className="allowance-bar-labels">
                    <span className="allowance-spent">
                      {sym}
                      {Number(m.spent || 0).toFixed(2)} spent
                    </span>
                    <span>
                      {sym}
                      {remaining.toFixed(2)} left
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-primary btn-log-spend"
                    onClick={() => logSpend(m)}
                    style={{ flex: 1, padding: 8, fontSize: '0.8rem' }}
                  >
                    Log Spending
                  </button>
                  <button
                    className="btn-primary btn-reset-allowance"
                    onClick={() => resetAllowance(m)}
                    style={{
                      flex: 1,
                      padding: 8,
                      fontSize: '0.8rem',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.6)',
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* TODO: real "Who Spent What This Week" chart — stub with basic bars */}
      <div
        className="chart-card full-width family-overview-card"
        id="familyOverviewCard"
        style={{ marginTop: 16 }}
      >
        <div className="family-overview-title">Who Spent What This Week</div>
        <div id="familyOverviewBars">
          {withAllowance.length === 0 ? (
            <p
              style={{
                color: 'rgba(255,255,255,0.35)',
                fontSize: '0.85rem',
              }}
            >
              No spending yet this week.
            </p>
          ) : (
            withAllowance.map((m) => (
              <div key={m.id} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.78rem',
                    marginBottom: 4,
                  }}
                >
                  <span>{m.name}</span>
                  <span>
                    {sym}
                    {Number(m.spent || 0).toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 3,
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      background: m.color,
                      borderRadius: 3,
                      width: `${m.allowance > 0 ? Math.min(100, ((m.spent || 0) / m.allowance) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="chart-card full-width" style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 12 }}>Savings Leaderboard</h3>
        <div className="leaderboard" id="savingsLeaderboard">
          {leaderboard.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>
              <p>Add members to see the leaderboard</p>
            </div>
          ) : (
            leaderboard.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  padding: 10,
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 10,
                  marginBottom: 6,
                }}
              >
                <div style={{ fontWeight: 700, opacity: 0.6, width: 20 }}>
                  {i + 1}
                </div>
                <div
                  className="allowance-mini-avatar"
                  style={{ background: m.color }}
                >
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontWeight: 700 }}>
                  {sym}
                  {Math.max(0, m.allowance - (m.spent || 0)).toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          className="btn-primary"
          onClick={() => setWishListOpen(true)}
          style={{
            flex: 1,
            padding: 10,
            fontSize: '0.82rem',
            background: 'rgba(245,158,11,0.15)',
            color: '#f59e0b',
          }}
        >
          🌟 Wish List
        </button>
        <button
          className="btn-primary"
          onClick={() => alert('Monthly Report coming soon')}
          style={{
            flex: 1,
            padding: 10,
            fontSize: '0.82rem',
            background: 'rgba(99,102,241,0.15)',
            color: '#6366f1',
          }}
        >
          📊 Monthly Report
        </button>
      </div>

      <WishListModal
        open={wishListOpen}
        onClose={() => setWishListOpen(false)}
        currency={currency}
      />
    </section>
  );
}

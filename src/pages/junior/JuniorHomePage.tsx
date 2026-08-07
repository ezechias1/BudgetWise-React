import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidLedger } from '@/hooks/useKidLedger';
import { useKidMissions } from '@/hooks/useKidMissions';

interface Streak {
  current_streak: number;
}

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
}

function formatRands(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

export default function JuniorHomePage() {
  const { member, loading: profileLoading } = useKidProfile();
  const { owed_cents, loading: ledgerLoading } = useKidLedger(member?.id ?? null);
  const { missions, progressByMission, loading: missionsLoading } = useKidMissions(member?.id ?? null);
  const [streak, setStreak] = useState<number>(0);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [sideLoading, setSideLoading] = useState(true);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      const [sRes, gRes] = await Promise.all([
        supabase
          .from('kid_streaks')
          .select('current_streak')
          .eq('member_id', member.id)
          .maybeSingle(),
        supabase
          .from('family_goals')
          .select('id, name, target, saved')
          .order('created_at')
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setStreak((sRes.data as Streak | null)?.current_streak ?? 0);
      setGoal((gRes.data as Goal | null) ?? null);
      setSideLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [member]);

  if (profileLoading || ledgerLoading || sideLoading || missionsLoading) return <p>Loading…</p>;
  if (!member) return <p>Something went wrong — no profile found.</p>;

  const remaining = goal ? Math.max(goal.target - goal.saved, 0) : 0;
  const pct = goal && goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;

  // First mission with no progress row, or with status != 'completed'.
  const nextMission =
    missions.find((m) => {
      const p = progressByMission[m.id];
      return !p || p.status !== 'completed';
    }) ?? null;
  const completedCount = Object.values(progressByMission).filter((p) => p.status === 'completed').length;
  const totalMissions = missions.length;

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 16 }}>
        <h1>Hi {member.name}!</h1>
        <p>Learn something new about money today.</p>
      </section>

      {/* Today's-mission hero — primary CTA. Educational layer first;
          money tiles below are secondary. */}
      <Link
        to={nextMission ? `/junior/mission/${nextMission.id}` : '/junior/missions'}
        style={{
          display: 'block',
          background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
          color: 'white',
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
          textDecoration: 'none',
          boxShadow: '0 4px 12px rgba(239,68,68,0.25)',
        }}
      >
        <p style={{ margin: 0, opacity: 0.9, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {nextMission ? "Today's mission" : 'All done!'}
        </p>
        <h2 style={{ margin: '6px 0 12px', fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          {nextMission ? (
            nextMission.title
          ) : (
            <>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              You finished every lesson
            </>
          )}
        </h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <small style={{ opacity: 0.85 }}>
            {completedCount} of {totalMissions} done
          </small>
          <span
            style={{
              background: 'rgba(128,128,128,0.2)',
              padding: '8px 16px',
              borderRadius: 999,
              fontWeight: 700,
            }}
          >
            {nextMission ? 'Start →' : 'See all →'}
          </span>
        </div>
      </Link>

      <div className="junior-grid-tiles">
        <div
          className="junior-hero-span"
          style={{
            background: 'white',
            borderRadius: 16,
            padding: 20,
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          }}
        >
          <p style={{ margin: 0, opacity: 0.7 }}>Your parents owe you</p>
          <p style={{ fontSize: '2.4rem', fontWeight: 700, margin: '4px 0 0', color: '#10b981' }}>
            {formatRands(owed_cents)}
          </p>
        </div>

        <div
          style={{
            background: 'white',
            borderRadius: 16,
            padding: 20,
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          }}
        >
          <p style={{ margin: 0, opacity: 0.7 }}>Streak</p>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, margin: '4px 0 0' }}>
            {streak} {streak === 1 ? 'day' : 'days'}
          </p>
        </div>

        <div
          style={{
            background: 'white',
            borderRadius: 16,
            padding: 20,
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          }}
        >
          <p style={{ margin: 0, opacity: 0.7 }}>Goal</p>
          {goal ? (
            <>
              <p style={{ fontSize: '1rem', fontWeight: 600, margin: '4px 0 2px' }}>{goal.name}</p>
              <small>R{remaining.toFixed(2)} to go</small>
              <div
                style={{
                  height: 6,
                  background: '#eee',
                  borderRadius: 3,
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: '#10b981',
                    transition: 'width 200ms',
                  }}
                />
              </div>
            </>
          ) : (
            <p style={{ fontSize: '0.95rem', margin: '4px 0 0', opacity: 0.7 }}>No goal yet</p>
          )}
        </div>
      </div>
    </>
  );
}

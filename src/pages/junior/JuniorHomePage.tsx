import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidLedger } from '@/hooks/useKidLedger';

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

  if (profileLoading || ledgerLoading || sideLoading) return <p>Loading…</p>;
  if (!member) return <p>Something went wrong — no profile found.</p>;

  const remaining = goal ? Math.max(goal.target - goal.saved, 0) : 0;
  const pct = goal && goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>Hi {member.name}!</h1>
        <p>Here&apos;s what&apos;s happening with your money.</p>
      </section>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div
          style={{
            gridColumn: '1 / -1',
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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidLedger } from '@/hooks/useKidLedger';
import { useKidMissions } from '@/hooks/useKidMissions';
import { formatCurrency } from '@/lib/format';

interface Streak {
  current_streak: number;
}

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
}

export default function JuniorHomePage() {
  const { member, loading: profileLoading, error: profileError } = useKidProfile();
  const {
    owed_cents,
    loading: ledgerLoading,
    error: ledgerError,
    refresh: refreshLedger,
  } = useKidLedger(member?.id ?? null);
  const {
    missions,
    progressByMission,
    loading: missionsLoading,
    error: missionsError,
    refresh: refreshMissions,
  } = useKidMissions(member?.id ?? null);
  const [streak, setStreak] = useState<number>(0);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [sideLoading, setSideLoading] = useState(true);
  const [sideError, setSideError] = useState<string | null>(null);
  // Bumped by the Try again button so the streak/goal effect below re-runs
  // without losing its cancellation guard.
  const [retryTick, setRetryTick] = useState(0);
  const [currency, setCurrency] = useState('ZAR');

  // The amounts on this page used to be hardcoded to R, which is wrong for the
  // eleven other currencies the family can pick. A kid's session cannot read
  // the parent's user_settings row (RLS is auth.uid() = user_id), so the code
  // comes from a security-definer RPC; ZAR stays the fallback.
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

  useEffect(() => {
    // No setSideLoading(false) here on purpose. Clearing it made the page paint
    // a confidently-wrong dashboard for one frame on EVERY normal load: when
    // the profile resolves, profileLoading:false and member arrive in the same
    // commit while useKidLedger(null)/useKidMissions(null) have already set
    // loading:false, so with the flag cleared every gate was false and React
    // committed the full page (owed 0, streak 0, no goal, "All done! You
    // finished every lesson / 0 of 0 done") before these effects could run.
    // sideLoading staying true is what covers that frame; the profile-failure
    // case is handled by gate ORDER below instead.
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
          .eq('member_id', member.id)
          .eq('status', 'active')
          .order('created_at')
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      // Both errors used to be dropped, so a failed read painted "0 days" and
      // "No goal yet — tap to add one" over a real streak and a real goal.
      // Keep whatever we already had and flag it instead of overwriting.
      const sideErr = sRes.error ?? gRes.error;
      if (sideErr) {
        setSideError(sideErr.message);
        setSideLoading(false);
        return;
      }
      setSideError(null);
      setStreak((sRes.data as Streak | null)?.current_streak ?? 0);
      setGoal((gRes.data as Goal | null) ?? null);
      setSideLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [member, retryTick]);

  const handleRetry = () => {
    setRetryTick((t) => t + 1);
    void refreshLedger();
    void refreshMissions();
  };

  // Gate ORDER matters. These were one combined condition with sideLoading
  // tested before !member, which made the no-profile branch dead code and hung
  // a failed profile read on a bare "Loading…" forever. Checking profileLoading
  // first, then !member, then the dependent loads reaches the error branch for
  // exactly that failure without mutating sideLoading (see the effect above).
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
  if (ledgerLoading || sideLoading || missionsLoading) return <p>Loading…</p>;

  const remaining = goal ? Math.max(goal.target - goal.saved, 0) : 0;
  const pct = goal && goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;

  // useKidMissions returns `missions: null` (not []) for every failure path, so
  // null and a genuinely empty bracket are distinguishable. Treat either signal
  // as "we don't know" — the counts below must never be derived from a failure.
  const missionsFailed = missionsError !== null || missions === null;
  const missionList = missions ?? [];

  // First mission with no progress row, or with status != 'completed'.
  const nextMission =
    missionList.find((m) => {
      const p = progressByMission[m.id];
      return !p || p.status !== 'completed';
    }) ?? null;
  // Count only missions in the kid's current age bracket. progressByMission
  // carries every row they've ever completed, including missions from younger
  // brackets that `missions` (age-filtered server-side) no longer contains —
  // which is how this rendered nonsense like "7 of 5 done".
  const totalMissions = missionList.length;
  const completedCount = missionList.filter(
    (m) => progressByMission[m.id]?.status === 'completed',
  ).length;

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 16 }}>
        <h1>Hi {member.name}!</h1>
        <p>Learn something new about money today.</p>
      </section>

      {/* useKidMissions and useKidLedger both fail CLOSED — an empty list and a
          zero balance — so an ignored error is painted as fact. Say so once,
          with a retry, instead of letting the tiles below lie quietly. */}
      {(missionsFailed || ledgerError || sideError) && (
        <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            Some of your info didn&apos;t load just now, so this might not be everything.
          </p>
          <button type="button" className="btn-primary" style={{ marginTop: 10 }} onClick={handleRetry}>
            Try again
          </button>
        </div>
      )}

      {/* Today's-mission hero — primary CTA. Educational layer first;
          money tiles below are secondary. When the missions read failed the
          list is empty, and the normal hero would congratulate the kid with
          "All done! You finished every lesson / 0 of 0 done" — the exact
          opposite of the truth — so that branch is replaced, not decorated. */}
      {missionsFailed ? (
        <div
          style={{
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            color: 'white',
            borderRadius: 16,
            padding: 20,
            marginBottom: 20,
            boxShadow: '0 4px 12px rgba(239,68,68,0.25)',
          }}
        >
          <p style={{ margin: 0, opacity: 0.9, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Missions
          </p>
          <h2 style={{ margin: '6px 0 12px', fontSize: '1.4rem' }}>We couldn&apos;t load your lessons</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <small style={{ opacity: 0.85 }}>Check your connection.</small>
            <button
              type="button"
              onClick={() => void refreshMissions()}
              style={{
                background: 'rgba(128,128,128,0.2)',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 999,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
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
      )}

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
            {/* A dash, not a confident 0.00: useKidLedger returns owed_cents 0
                when its read fails, and this is the one number on the page a
                kid will act on. */}
            {ledgerError ? '—' : formatCurrency(owed_cents / 100, currency)}
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
            {/* Same reason as the balance: a failed kid_streaks read used to
                read out as a genuine "0 days" and wipe out a real streak. */}
            {sideError ? '—' : `${streak} ${streak === 1 ? 'day' : 'days'}`}
          </p>
        </div>

        <Link
          to="/junior/goals"
          style={{
            display: 'block',
            background: 'white',
            borderRadius: 16,
            padding: 20,
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <p style={{ margin: 0, opacity: 0.7 }}>Goal</p>
          {goal ? (
            <>
              <p style={{ fontSize: '1rem', fontWeight: 600, margin: '4px 0 2px' }}>{goal.name}</p>
              <small>{formatCurrency(remaining, currency)} to go</small>
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
          ) : sideError ? (
            /* "No goal yet" over a goal that exists is what sends a kid off to
               propose a duplicate for a parent to approve. */
            <p style={{ fontSize: '0.95rem', margin: '4px 0 0', opacity: 0.7 }}>Couldn&apos;t load your goal</p>
          ) : (
            <p style={{ fontSize: '0.95rem', margin: '4px 0 0', opacity: 0.7 }}>No goal yet — tap to add one</p>
          )}
        </Link>
      </div>
    </>
  );
}

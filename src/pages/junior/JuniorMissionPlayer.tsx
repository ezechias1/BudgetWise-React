import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { type KidMission } from '@/hooks/useKidMissions';
import { useParentProForKid } from '@/hooks/useParentProForKid';
import { JuniorUpgradeModal } from '@/components/JuniorUpgradeModal';
import { checkJuniorGate } from '@/lib/access';
import { enqueueApprovalNudge } from '@/lib/junior-notifications';

interface HookStep { type: 'hook'; title: string; body: string; }
interface ConceptStep { type: 'concept'; title: string; body: string; }
interface QuizStep { type: 'quiz'; question: string; options: string[]; answer: number; }
interface TieInStep { type: 'tie_in'; body: string; }
interface DoneStep { type: 'done'; body: string; }
type MissionStep = HookStep | ConceptStep | QuizStep | TieInStep | DoneStep;

// What the celebration screen is allowed to say about money. Set only from
// what we actually read back after saving — never assumed. `tone` is just the
// colour: 'good' = money is waiting for them, 'info' = nothing new is owed.
interface RewardNote { tone: 'good' | 'info'; text: string; }

export default function JuniorMissionPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { member } = useKidProfile();
  const { isPro } = useParentProForKid(member?.user_id);
  const [mission, setMission] = useState<KidMission | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Load and save failures used to share one `error`, so a failed completion
  // write was announced as "Couldn't load mission" and tore down the whole
  // player — the child lost all five steps and had no retry. They are separate
  // states now: only a load failure may replace the lesson.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rewardNote, setRewardNote] = useState<RewardNote | null>(null);
  const [missionGateBlocked, setMissionGateBlocked] = useState<{ current: number; limit: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('kid_missions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (err) setLoadError(err.message);
      else setMission(data as KidMission | null);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const completeMission = useCallback(async (quizScore: number | null) => {
    if (!member || !mission) return;
    setSubmitting(true);
    setSaveError(null);

    // Two things have to be known BEFORE we write. First the freemium gate:
    // count existing completed missions for this kid; if over the free limit
    // and the parent isn't Pro, show the upgrade modal and bail before writing
    // progress (the mission has NOT been completed yet, so re-entering after
    // upgrade is fine). Second, whether THIS mission was already completed —
    // once the upsert lands we can no longer tell, and a replay pays nothing
    // (see the reward note below), so the wording depends on it.
    const [gateRes, priorRes] = await Promise.all([
      supabase
        .from('kid_mission_progress')
        .select('mission_id', { count: 'exact', head: true })
        .eq('member_id', member.id)
        .eq('status', 'completed'),
      supabase
        .from('kid_mission_progress')
        .select('status')
        .eq('member_id', member.id)
        .eq('mission_id', mission.id)
        .maybeSingle(),
    ]);
    const completedCount = gateRes.count ?? 0;
    // null = the read failed, so we genuinely don't know. Treating a failed
    // read as "first time" would make us claim they just earned something.
    const wasReplay = priorRes.error ? null : priorRes.data?.status === 'completed';
    const gate = checkJuniorGate(isPro, 'missions', completedCount);
    if (gate) {
      setMissionGateBlocked({ current: gate.current, limit: gate.limit });
      setSubmitting(false);
      return;
    }

    const completedAt = new Date().toISOString();
    // Upsert progress row. The DB trigger writes the kid_ledger reward.
    const { error: err } = await supabase
      .from('kid_mission_progress')
      .upsert(
        {
          member_id: member.id,
          mission_id: mission.id,
          status: 'completed',
          completed_at: completedAt,
          quiz_score: quizScore,
        },
        { onConflict: 'member_id,mission_id' },
      );
    if (err) {
      setSubmitting(false);
      setSaveError(err.message);
      return;
    }

    // Work out what actually happened to the money before promising anything.
    // Payouts are written by DB triggers, never here (a kid cannot write
    // kid_ledger — RLS is parent-only): one fires on the transition into
    // 'completed', the other backfills every already-completed kid when the
    // parent sets or raises the reward. Both are guarded so a mission is paid
    // at most once, which means a replay adds nothing however it is worded.
    //
    // The ledger read must filter on status. It used to match any row, so a
    // reward the parent had ALREADY handed over (status 'paid' — this exists in
    // live data) still printed "your parents owe you", telling the child they
    // were owed money they had already been given.
    const [rewardRes, ledgerRes] = await Promise.all([
      supabase
        .from('kid_mission_rewards')
        .select('reward_amount_cents')
        .eq('user_id', member.user_id)
        .eq('mission_id', mission.id)
        .maybeSingle(),
      supabase
        .from('kid_ledger')
        .select('status')
        .eq('member_id', member.id)
        .eq('source_type', 'lesson')
        .eq('source_id', mission.id),
    ]);
    const ledgerRows = (ledgerRes.data as { status: string }[] | null) ?? [];
    const owed = ledgerRows.some((r) => r.status === 'owed');
    const alreadyPaid = ledgerRows.some((r) => r.status === 'paid');
    if (rewardRes.error || ledgerRes.error) {
      // Reads failed: say nothing about money rather than guess. Claiming
      // either "paid" or "not paid" here would be inventing an answer.
      setRewardNote(null);
    } else if (owed) {
      setRewardNote({
        tone: 'good',
        text:
          wasReplay === true
            ? 'You finished this one before, and that reward is still on the list your parents owe you. Playing it again does not add more.'
            : 'Your reward for this mission is on the list your parents owe you.',
      });
    } else if (alreadyPaid) {
      setRewardNote({
        tone: 'info',
        text: 'You already earned this mission’s reward and your parents have paid it. Playing it again is just for practice — it does not pay twice.',
      });
    } else if ((rewardRes.data?.reward_amount_cents ?? 0) > 0) {
      // Reward is set but no ledger row came back. With both triggers in place
      // this should not happen; rather than invent a story about the money,
      // say nothing and let the jars/owed screens be the source of truth.
      setRewardNote(null);
    } else {
      setRewardNote({
        tone: 'info',
        text: 'There is no reward set for this mission yet, so this one does not pay. Ask your parent to set up mission rewards — when they do, missions you have already finished get paid too.',
      });
    }
    setSubmitting(false);

    // Enqueue approval nudge for the parent. Fire-and-forget.
    void enqueueApprovalNudge(
      member.user_id,
      member.name,
      'mission',
      mission.title,
      '/dashboard/junior',
    );
    // Proceed to the done step
    setStepIdx((i) => i + 1);
  }, [member, mission, isPro]);

  if (loadError) return <p style={{ color: '#dc2626' }}>Couldn&apos;t load mission: {loadError}</p>;
  if (!mission) return <p>Loading…</p>;

  const steps = (mission.body.steps ?? []) as unknown as MissionStep[];
  const step = steps[stepIdx];
  if (!step) return <p>Mission empty.</p>;

  const advance = async () => {
    if (step.type === 'tie_in') {
      // Before showing 'done', write completion to DB so trigger fires the ledger
      await completeMission(quizPick === (steps.find((s): s is QuizStep => s.type === 'quiz')?.answer ?? -1) ? 100 : 0);
      return;
    }
    setStepIdx((i) => i + 1);
  };

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>{mission.title}</h1>
        <p>Step {stepIdx + 1} of {steps.length}</p>
      </section>

      <div style={{ background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
        {step.type === 'hook' && (
          <>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </>
        )}
        {step.type === 'concept' && (
          <>
            <h3>{step.title}</h3>
            <p style={{ fontSize: '1.1rem' }}>{step.body}</p>
          </>
        )}
        {step.type === 'quiz' && (
          <>
            <h3>{step.question}</h3>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {step.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setQuizPick(i)}
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: quizPick === i ? '2px solid #10b981' : '1px solid #ddd',
                    background: quizPick === i ? 'rgba(16,185,129,0.1)' : 'white',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
            {quizPick != null && (
              <p style={{ marginTop: 12, color: quizPick === step.answer ? '#10b981' : '#dc2626' }}>
                {quizPick === step.answer ? 'Correct!' : 'Not quite — think about which one grows.'}
              </p>
            )}
          </>
        )}
        {step.type === 'tie_in' && <p style={{ fontSize: '1.1rem', fontStyle: 'italic' }}>{step.body}</p>}
        {step.type === 'done' && (
          <div className="junior-celebrate" style={{ textAlign: 'center', padding: '8px 0' }}>
            <div className="junior-celebrate-burst" aria-hidden>
              {/* A few colored circles that bounce in for confetti feel */}
              {['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'].map((c, i) => (
                <span
                  key={i}
                  className="junior-celebrate-dot"
                  style={{
                    background: c,
                    animationDelay: `${i * 60}ms`,
                    top: `${[18, 8, 22, 10, 26, 14][i]}%`,
                    left: `${[12, 28, 44, 60, 76, 88][i]}%`,
                  }}
                />
              ))}
              <div className="junior-celebrate-check" aria-hidden>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" fill="#10b981" stroke="none" />
                  <polyline points="8 12 11 15 16 9" />
                </svg>
              </div>
            </div>
            <h2 className="junior-celebrate-wow">WOW!!</h2>
            <p className="junior-celebrate-welldone">Well done, {member?.name ?? 'champ'}!</p>
            <p style={{ color: '#4b5563', marginTop: 6 }}>{step.body}</p>
            {rewardNote && (
              <p style={{ marginTop: 10, fontWeight: 600, color: rewardNote.tone === 'good' ? '#059669' : '#4b5563' }}>
                {rewardNote.text}
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate('/junior/missions')}
              className="btn-primary"
              style={{ marginTop: 20 }}
            >
              Back to missions
            </button>
          </div>
        )}
      </div>

      {saveError && (
        <p style={{ color: '#dc2626', marginTop: 16 }}>
          Couldn&apos;t save that you finished: {saveError}
          <br />
          Your lesson is still here — tap Try again to save it.
        </p>
      )}

      {step.type !== 'done' && (
        <button
          type="button"
          onClick={advance}
          disabled={submitting || (step.type === 'quiz' && quizPick == null)}
          className="btn-primary"
          style={{ marginTop: 16, width: '100%' }}
        >
          {submitting ? 'Saving…' : step.type === 'tie_in' ? (saveError ? 'Try again' : 'Finish') : 'Next'}
        </button>
      )}

      {missionGateBlocked && (
        <JuniorUpgradeModal
          reason="missions"
          current={missionGateBlocked.current}
          limit={missionGateBlocked.limit}
          onClose={() => {
            setMissionGateBlocked(null);
            navigate('/junior/missions');
          }}
        />
      )}
    </>
  );
}

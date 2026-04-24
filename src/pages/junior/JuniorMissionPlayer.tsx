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

export default function JuniorMissionPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { member } = useKidProfile();
  const { isPro } = useParentProForKid(member?.user_id);
  const [mission, setMission] = useState<KidMission | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (err) setError(err.message);
      else setMission(data as KidMission | null);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const completeMission = useCallback(async (quizScore: number | null) => {
    if (!member || !mission) return;
    setSubmitting(true);
    setError(null);

    // Freemium gate: count existing completed missions for this kid. If over
    // the free limit and parent isn't Pro, show the upgrade modal and bail
    // before writing progress. The mission has NOT been completed yet so
    // re-entering after upgrade is fine.
    const { count } = await supabase
      .from('kid_mission_progress')
      .select('mission_id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .eq('status', 'completed');
    const completedCount = count ?? 0;
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
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
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

  if (error) return <p style={{ color: '#dc2626' }}>Couldn&apos;t load mission: {error}</p>;
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

      {step.type !== 'done' && (
        <button
          type="button"
          onClick={advance}
          disabled={submitting || (step.type === 'quiz' && quizPick == null)}
          className="btn-primary"
          style={{ marginTop: 16, width: '100%' }}
        >
          {submitting ? 'Saving…' : step.type === 'tie_in' ? 'Finish' : 'Next'}
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

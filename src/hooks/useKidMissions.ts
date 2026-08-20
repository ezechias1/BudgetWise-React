import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ageFromDob } from '@/lib/junior-age';

export interface KidMission {
  id: string;
  slug: string;
  unit: string;
  title: string;
  ord: number;
  age_min: number;
  age_max: number;
  body: { steps: Array<{ type: string; [key: string]: unknown }> };
}

export interface KidMissionProgress {
  id: string;
  mission_id: string;
  status: 'locked' | 'available' | 'completed';
  completed_at: string | null;
  quiz_score: number | null;
}

interface State {
  /**
   * `null` means "we could not work out what to show" — a read failed, so this
   * is NOT an empty mission list. It is nullable on purpose: every failure path
   * below returns early, and when `missions` was typed `KidMission[]` a caller
   * that destructured only { missions, progressByMission, loading } rendered a
   * silent, explanation-less blank screen on any error. Under `strict` the null
   * makes that impossible to compile, so the failure has to be dealt with.
   *
   * Callers want roughly:
   *   const { missions, progressByMission, loading, error, refresh } = useKidMissions(id);
   *   if (loading) return <p>Loading missions…</p>;
   *   if (error || !missions) return <RetryMessage msg={error} onRetry={refresh} />;
   */
  missions: KidMission[] | null;
  progressByMission: Record<string, KidMissionProgress>;
  loading: boolean;
  error: string | null;
}

export function useKidMissions(memberId: string | null) {
  const [state, setState] = useState<State>({
    missions: null,
    progressByMission: {},
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!memberId) {
      // No member is a real, successful "nothing to show" — not a failure —
      // so this one stays an empty array.
      setState({ missions: [], progressByMission: {}, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    // Look up the kid's DOB first so we can age-filter missions server-side.
    const { data: member, error: dobErr } = await supabase
      .from('family_members')
      .select('date_of_birth')
      .eq('id', memberId)
      .maybeSingle();
    // dobErr was previously ignored, and a failed read is indistinguishable
    // from "no DOB recorded" — which skips the filter below and hands a
    // ten-year-old every bracket, Adult lite included, while their done-count
    // silently rebases against all 32 missions. Fail closed: a read failure
    // must never widen what the child is shown.
    if (dobErr) {
      setState({ missions: null, progressByMission: {}, loading: false, error: dobErr.message });
      return;
    }
    const age = ageFromDob(member?.date_of_birth as string | null | undefined);

    let missionsQuery = supabase.from('kid_missions').select('*').order('ord');
    // Defensive: if DOB is null (pre-Phase-6 kid, backfill pending), show
    // everything rather than hide all missions. Once the parent completes
    // the backfill banner flow, the filter kicks in.
    if (age !== null) {
      missionsQuery = missionsQuery.lte('age_min', age).gte('age_max', age);
    }

    const [mRes, pRes] = await Promise.all([
      missionsQuery,
      supabase
        .from('kid_mission_progress')
        .select('id, mission_id, status, completed_at, quiz_score')
        .eq('member_id', memberId),
    ]);
    // pRes.error was previously ignored: a failed progress read collapsed to
    // an empty array and the hook reported a fully successful load, so every
    // completed mission rendered as not-done. Handle both queries' errors
    // symmetrically so a failure can't masquerade as "nothing completed yet".
    if (mRes.error || pRes.error) {
      setState({
        missions: null,
        progressByMission: {},
        loading: false,
        error: (mRes.error ?? pRes.error)!.message,
      });
      return;
    }
    const missions = (mRes.data as KidMission[]) ?? [];
    const rows = (pRes.data as KidMissionProgress[]) ?? [];
    const progressByMission: Record<string, KidMissionProgress> = {};
    for (const r of rows) progressByMission[r.mission_id] = r;
    setState({ missions, progressByMission, loading: false, error: null });
  }, [memberId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

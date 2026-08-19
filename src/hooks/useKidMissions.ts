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
  missions: KidMission[];
  progressByMission: Record<string, KidMissionProgress>;
  loading: boolean;
  error: string | null;
}

export function useKidMissions(memberId: string | null) {
  const [state, setState] = useState<State>({
    missions: [],
    progressByMission: {},
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!memberId) {
      setState({ missions: [], progressByMission: {}, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    // Look up the kid's DOB first so we can age-filter missions server-side.
    const { data: member } = await supabase
      .from('family_members')
      .select('date_of_birth')
      .eq('id', memberId)
      .maybeSingle();
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
      setState((s) => ({
        ...s,
        loading: false,
        error: (mRes.error ?? pRes.error)!.message,
      }));
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

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface KidMission {
  id: string;
  slug: string;
  unit: string;
  title: string;
  ord: number;
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
    const [mRes, pRes] = await Promise.all([
      supabase.from('kid_missions').select('*').order('ord'),
      supabase
        .from('kid_mission_progress')
        .select('id, mission_id, status, completed_at, quiz_score')
        .eq('member_id', memberId),
    ]);
    if (mRes.error) {
      setState((s) => ({ ...s, loading: false, error: mRes.error!.message }));
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

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ok } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Mission { id: string; title: string; unit: string; }
interface Reward { mission_id: string; reward_amount_cents: number; }

interface Props { onClose: () => void; }

export function MissionRewardsModal({ onClose }: Props) {
  const { user } = useAuth();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [rewards, setRewards] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useDialogA11y();

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    const [mRes, rRes] = await Promise.all([
      supabase.from('kid_missions').select('id, title, unit').order('ord'),
      supabase.from('kid_mission_rewards').select('mission_id, reward_amount_cents').eq('user_id', user.id),
    ]);
    // Both errors were previously discarded. A failed rewards read collapsed to
    // an empty map, so every configured amount rendered blank — indistinguishable
    // from first-time setup — and Save then upserted 0 over amounts we had never
    // read, after which the payout trigger paid the kid nothing. Never show (or
    // save) a form built from a read that failed.
    if (mRes.error || rRes.error) {
      setLoadError((mRes.error ?? rRes.error)!.message);
      setLoading(false);
      return;
    }
    setMissions((mRes.data as Mission[]) ?? []);
    const rewardMap: Record<string, string> = {};
    for (const r of (rRes.data as Reward[]) ?? []) {
      rewardMap[r.mission_id] = (r.reward_amount_cents / 100).toFixed(2);
    }
    setRewards(rewardMap);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!user || loadError) return;
    setSaving(true);
    const rows = missions
      .map((m) => ({
        user_id: user.id,
        mission_id: m.id,
        reward_amount_cents: Math.round(parseFloat(rewards[m.id] || '0') * 100),
      }))
      .filter((r) => r.reward_amount_cents >= 0);
    // Previously discarded: a failed upsert still closed the modal, so the
    // parent believed the reward amounts were saved while the kid's missions
    // kept paying the old (or zero) amount. Keep the modal open on failure so
    // the entered values aren't lost.
    const saved = await ok(
      supabase
        .from('kid_mission_rewards')
        .upsert(rows, { onConflict: 'user_id,mission_id' }),
      'save the mission rewards',
    );
    setSaving(false);
    if (!saved) return;
    onClose();
  };

  const byUnit: Record<string, Mission[]> = {};
  for (const m of missions) {
    if (!byUnit[m.unit]) byUnit[m.unit] = [];
    byUnit[m.unit].push(m);
  }

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mission-rewards-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h2 id="mission-rewards-title">Mission rewards</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p>Set how much each mission earns when your kid finishes it. Leave at 0 if you don&apos;t want it to pay.</p>
        {/*
          Saving used to look like it only affected future completions, so a
          parent who set a reward late assumed the missions their kid had
          already finished were lost money. They aren't: the database now pays
          every child who already completed the mission when the reward is
          saved. Say so, and say it only pays once so nobody expects a top-up
          from raising an amount later.
        */}
        <p style={{ fontSize: '0.85rem', color: '#4b5563' }}>
          Setting a reward also pays for missions your kid has already finished — each mission pays out once.
        </p>
        {loading ? (
          <p>Loading…</p>
        ) : loadError ? (
          <div>
            <p style={{ color: '#dc2626' }}>
              Couldn&apos;t load the rewards you already set: {loadError}
            </p>
            <p>Nothing has been changed. Try again before editing, so you don&apos;t overwrite them.</p>
            <button type="button" className="btn-secondary" onClick={load}>Try again</button>
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {Object.entries(byUnit).map(([unit, uMissions]) => (
              <div key={unit} style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>{unit}</h4>
                {uMissions.map((m) => (
                  <div
                    key={m.id}
                    className="field"
                    style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, alignItems: 'center', margin: '6px 0' }}
                  >
                    <label htmlFor={`r-${m.id}`} style={{ margin: 0 }}>{m.title}</label>
                    <input
                      id={`r-${m.id}`}
                      type="number"
                      min={0}
                      step="0.5"
                      placeholder="0.00"
                      value={rewards[m.id] ?? ''}
                      onChange={(e) => setRewards((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving || loading || !!loadError}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save rewards'}
          </button>
        </div>
      </div>
    </div>
  );
}

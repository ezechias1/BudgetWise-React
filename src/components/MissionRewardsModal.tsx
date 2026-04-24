import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Mission { id: string; title: string; unit: string; }
interface Reward { mission_id: string; reward_amount_cents: number; }

interface Props { onClose: () => void; }

export function MissionRewardsModal({ onClose }: Props) {
  const { user } = useAuth();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [rewards, setRewards] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [mRes, rRes] = await Promise.all([
      supabase.from('kid_missions').select('id, title, unit').order('ord'),
      supabase.from('kid_mission_rewards').select('mission_id, reward_amount_cents').eq('user_id', user.id),
    ]);
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
    if (!user) return;
    setSaving(true);
    const rows = missions
      .map((m) => ({
        user_id: user.id,
        mission_id: m.id,
        reward_amount_cents: Math.round(parseFloat(rewards[m.id] || '0') * 100),
      }))
      .filter((r) => r.reward_amount_cents >= 0);
    await supabase
      .from('kid_mission_rewards')
      .upsert(rows, { onConflict: 'user_id,mission_id' });
    setSaving(false);
    onClose();
  };

  const byUnit: Record<string, Mission[]> = {};
  for (const m of missions) {
    if (!byUnit[m.unit]) byUnit[m.unit] = [];
    byUnit[m.unit].push(m);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h2>Mission rewards</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p>Set how much each mission earns when your kid finishes it. Leave at 0 if you don&apos;t want it to pay.</p>
        {loading ? (
          <p>Loading…</p>
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
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save rewards'}
          </button>
        </div>
      </div>
    </div>
  );
}

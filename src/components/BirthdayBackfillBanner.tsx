import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { ageFromDob } from '@/lib/junior-age';

interface KidMissingDob {
  id: string;
  name: string;
  color: string;
}

/**
 * Existing Junior kids (created before Phase 6) have `age` populated but
 * `date_of_birth` is null. Age drifts; DOB doesn't. This banner nudges the
 * parent to add each missing DOB so useKidMissions can filter by bracket.
 *
 * Hides itself once every kid has a DOB.
 */
export function BirthdayBackfillBanner() {
  const { user } = useAuth();
  const [kids, setKids] = useState<KidMissingDob[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('family_members')
      .select('id, name, color, auth_user_id, date_of_birth')
      .eq('user_id', user.id)
      .eq('role', 'child')
      .not('auth_user_id', 'is', null)
      .is('date_of_birth', null);
    setKids((data as KidMissingDob[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDob = async (kidId: string) => {
    const dob = drafts[kidId];
    if (!dob) return;
    const age = ageFromDob(dob);
    if (age === null || age < 7 || age > 17) {
      setError(`${kids.find((k) => k.id === kidId)?.name}: BudgetWise Junior is for ages 7–17.`);
      return;
    }
    setSaving(kidId);
    setError(null);
    const { error: err } = await supabase
      .from('family_members')
      .update({ date_of_birth: dob, age })
      .eq('id', kidId);
    setSaving(null);
    if (err) {
      setError(`Couldn't save: ${err.message}`);
      return;
    }
    setKids((prev) => prev.filter((k) => k.id !== kidId));
    setDrafts((prev) => {
      const { [kidId]: _dropped, ...rest } = prev;
      return rest;
    });
  };

  if (loading || kids.length === 0) return null;

  return (
    <div
      className="card"
      style={{
        padding: 20,
        marginBottom: 16,
        background: '#fef3c7',
        border: '1px solid #fde68a',
      }}
    >
      <h3 style={{ margin: '0 0 4px' }}>Add birthdays to unlock age-appropriate missions</h3>
      <p style={{ margin: '0 0 16px', opacity: 0.85, fontSize: '0.9rem' }}>
        Junior now tailors lessons to each kid&apos;s age bracket. Add a date of birth
        so {kids.length === 1 ? kids[0].name : 'each kid'} sees the right content.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        {kids.map((k) => (
          <li
            key={k.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: k.color,
                color: 'white',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {k.name.charAt(0).toUpperCase()}
            </div>
            <strong style={{ minWidth: 80 }}>{k.name}</strong>
            <input
              type="date"
              aria-label={`Date of birth for ${k.name}`}
              value={drafts[k.id] ?? ''}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [k.id]: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db' }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!drafts[k.id] || saving === k.id}
              onClick={() => saveDob(k.id)}
              style={{ padding: '6px 14px' }}
            >
              {saving === k.id ? 'Saving…' : 'Save'}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p style={{ color: '#dc2626', marginTop: 12, marginBottom: 0, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}

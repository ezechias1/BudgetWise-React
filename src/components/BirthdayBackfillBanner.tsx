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
      role="region"
      aria-label="Birthday backfill"
      style={{
        padding: '20px 24px',
        marginBottom: 16,
        background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
        borderRadius: 16,
        border: '1px solid rgba(251, 191, 36, 0.4)',
        boxShadow: '0 2px 12px rgba(251, 191, 36, 0.15)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: '#92400e',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px', color: '#78350f', fontSize: '1rem' }}>
            Add birthdays to unlock age-appropriate missions
          </h3>
          <p style={{ margin: 0, color: '#92400e', fontSize: '0.88rem', lineHeight: 1.45 }}>
            Junior now tailors lessons to each kid&apos;s age bracket. Add a date of birth
            so {kids.length === 1 ? kids[0].name : 'each kid'} sees the right content.
          </p>
        </div>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {kids.map((k) => (
          <li
            key={k.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'rgba(255, 255, 255, 0.7)',
              padding: '10px 14px',
              borderRadius: 12,
              flexWrap: 'wrap',
            }}
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
            <strong style={{ flex: '1 1 80px', color: '#78350f' }}>{k.name}</strong>
            <input
              type="date"
              aria-label={`Date of birth for ${k.name}`}
              value={drafts[k.id] ?? ''}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [k.id]: e.target.value }))}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #e5e7eb',
                background: 'white',
                fontSize: '0.9rem',
                color: '#1f2937',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!drafts[k.id] || saving === k.id}
              onClick={() => saveDob(k.id)}
              style={{ padding: '8px 18px', fontSize: '0.9rem' }}
            >
              {saving === k.id ? 'Saving…' : 'Save'}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p style={{ color: '#b91c1c', marginTop: 12, marginBottom: 0, fontWeight: 600, fontSize: '0.88rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}

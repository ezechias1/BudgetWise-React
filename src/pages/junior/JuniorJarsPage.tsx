import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { reportWriteFailure } from '@/lib/db';
import { useKidProfile } from '@/hooks/useKidProfile';

export default function JuniorJarsPage() {
  const { member, loading: profileLoading } = useKidProfile();
  const [save, setSave] = useState(50);
  const [spend, setSpend] = useState(30);
  const [give, setGive] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (member?.jar_split) {
      setSave(member.jar_split.save);
      setSpend(member.jar_split.spend);
      setGive(member.jar_split.give);
    }
  }, [member]);

  const total = save + spend + give;
  const canSave = total === 100 && !submitting;

  const handleSave = async () => {
    if (!member || !canSave) return;
    setSubmitting(true);
    // Previously discarded its error, so a kid's jar split could appear
    // saved while the database kept the old values.
    const { error: jarError } = await supabase
      .from('family_members')
      .update({ jar_split: { save, spend, give } })
      .eq('id', member.id);
    setSubmitting(false);
    if (jarError) {
      // Don't show the "Saved!" tick for something that wasn't saved — a kid
      // would set their jars, see it confirm, and find the old split later.
      reportWriteFailure('save your jars', jarError.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (profileLoading || !member) return <p>Loading…</p>;

  const barW = (n: number) => `${(n / 100) * 100}%`;

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>Your jars</h1>
        <p>When your parents pay you, your money splits into these three jars.</p>
      </section>

      <div className="junior-jars-card" style={{ background: 'white', borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div className="junior-jars-row">
          <JarGlass value={save} color="#10b981" label="Save" />
          <JarGlass value={spend} color="#3b82f6" label="Spend" />
          <JarGlass value={give} color="#8b5cf6" label="Give" />
        </div>

        <div
          className={`junior-jars-bar ${total === 100 ? 'is-full' : ''}`}
          style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}
        >
          <div style={{ width: barW(save), background: '#10b981', transition: 'width 400ms cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
          <div style={{ width: barW(spend), background: '#3b82f6', transition: 'width 400ms cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
          <div style={{ width: barW(give), background: '#8b5cf6', transition: 'width 400ms cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontSize: '0.85rem', color: '#1a1a2e' }}>
          {([
            { name: 'Save',  val: save,  color: '#10b981' },
            { name: 'Spend', val: spend, color: '#3b82f6' },
            { name: 'Give',  val: give,  color: '#8b5cf6' },
          ]).map((j) => (
            <div key={j.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: j.color, display: 'inline-block' }} />
              <strong>{j.name}</strong>
              <span style={{ opacity: 0.7 }}>{j.val}%</span>
            </div>
          ))}
        </div>

        {(['save', 'spend', 'give'] as const).map((jar, idx) => {
          const val = jar === 'save' ? save : jar === 'spend' ? spend : give;
          const set = jar === 'save' ? setSave : jar === 'spend' ? setSpend : setGive;
          return (
            <div key={jar} className="field junior-jars-field" style={{ animationDelay: `${420 + idx * 60}ms` }}>
              <label style={{ color: '#1a1a2e', fontWeight: 600 }}>
                {jar.charAt(0).toUpperCase() + jar.slice(1)}: {val}%
              </label>
              <input type="range" min={0} max={100} value={val} onChange={(e) => set(Number(e.target.value))} />
            </div>
          );
        })}

        <p
          key={`total-${total === 100}`}
          className={`junior-jars-total ${total === 100 ? 'is-ok' : 'is-off'}`}
        >
          Total: {total}% {total !== 100 && '(must be 100)'}
        </p>

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className={`btn-primary junior-jars-save ${canSave && !saved ? 'can-save' : ''}`}
          style={{ marginTop: 12, width: '100%' }}
        >
          {saved ? <span className="junior-jars-saved-badge">Saved!</span> : submitting ? 'Saving…' : 'Save my split'}
        </button>
      </div>
    </>
  );
}

function JarGlass({ value, color, label }: { value: number; color: string; label: string }) {
  const scale = Math.max(value, 0) / 100;
  const clipId = `jar-clip-${label}`;
  return (
    <div className="junior-jar">
      <svg viewBox="0 0 48 60" width="64" height="80" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect x="8" y="12" width="32" height="40" rx="5" />
          </clipPath>
        </defs>
        {/* Lid */}
        <rect x="12" y="2" width="24" height="5" rx="2" fill="#fbbf24" />
        <rect x="10" y="7" width="28" height="4" rx="1.5" fill="#f59e0b" />
        {/* Jar body */}
        <rect x="8" y="12" width="32" height="40" rx="5" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
        {/* Fill — scales from the bottom */}
        <g
          clipPath={`url(#${clipId})`}
          style={{
            transform: `scaleY(${scale})`,
            transformOrigin: '24px 52px',
            transition: 'transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <rect x="8" y="12" width="32" height="40" fill={color} opacity="0.85" />
          {/* Coin sheen ripple across the fill surface */}
          <rect x="8" y="12" width="32" height="3" fill="white" opacity="0.35" />
        </g>
        {/* Glass highlight */}
        <rect x="13" y="16" width="3" height="28" rx="1.5" fill="white" opacity="0.55" />
        {/* Floating coin that bobs above the jar */}
        <circle className="junior-jar-coin" cx="36" cy="10" r="3" fill="#fbbf24" stroke="#f59e0b" strokeWidth="0.6" />
      </svg>
      <div className="junior-jar-label">{label}</div>
      <div className="junior-jar-pct">{value}%</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
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
    await supabase
      .from('family_members')
      .update({ jar_split: { save, spend, give } })
      .eq('id', member.id);
    setSubmitting(false);
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

      <div style={{ background: 'white', borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ width: barW(save), background: '#10b981' }} />
          <div style={{ width: barW(spend), background: '#3b82f6' }} />
          <div style={{ width: barW(give), background: '#8b5cf6' }} />
        </div>

        {(['save', 'spend', 'give'] as const).map((jar) => {
          const val = jar === 'save' ? save : jar === 'spend' ? spend : give;
          const set = jar === 'save' ? setSave : jar === 'spend' ? setSpend : setGive;
          return (
            <div key={jar} className="field">
              <label>{jar.charAt(0).toUpperCase() + jar.slice(1)}: {val}%</label>
              <input type="range" min={0} max={100} value={val} onChange={(e) => set(Number(e.target.value))} />
            </div>
          );
        })}

        <p style={{ color: total === 100 ? '#10b981' : '#dc2626' }}>
          Total: {total}% {total !== 100 && '(must be 100)'}
        </p>

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="btn-primary"
          style={{ marginTop: 12, width: '100%' }}
        >
          {saved ? 'Saved!' : submitting ? 'Saving…' : 'Save my split'}
        </button>
      </div>
    </>
  );
}

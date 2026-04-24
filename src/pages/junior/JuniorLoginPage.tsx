import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { signInAsKid } from '@/lib/junior-auth';
import { supabase } from '@/lib/supabase';
import { listDeviceKids, rememberDeviceKid } from '@/lib/junior-device-kids';

export default function JuniorLoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const memberId = params.get('as') || '';
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const deviceKids = listDeviceKids();

  // Same body-class toggle JuniorLayout uses. Without this, /junior/login
  // keeps body display:flex which caps #root (and the shell inside it) to
  // content width — exactly the 718px-on-a-1920-viewport bug.
  useEffect(() => {
    document.body.classList.add('junior-active');
    return () => document.body.classList.remove('junior-active');
  }, []);

  const canSubmit = /^\d{4}$/.test(pin) && memberId.length > 0 && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { status } = await signInAsKid(memberId, pin);
    if (status !== 'ok') {
      // AUDIT Imp #4 / #5: branch on rate-limit, and after a couple of
      // failures hint that the link itself might be dead.
      setAttempts((n) => n + 1);
      if (status === 'rate_limited') {
        setError('Too many tries — wait a minute and try again.');
      } else if (attempts + 1 >= 3) {
        setError('Still not working? Ask your parent for a fresh link.');
      } else {
        setError('Wrong PIN. Try again.');
      }
      setPin('');
      setSubmitting(false);
      return;
    }
    const { data: member } = await supabase
      .from('family_members')
      .select('name, color')
      .eq('id', memberId)
      .maybeSingle();
    if (member?.name && member?.color) {
      rememberDeviceKid({ memberId, name: member.name, color: member.color });
    }
    navigate('/junior/home', { replace: true });
  };

  if (!memberId) {
    if (deviceKids.length === 0) {
      return (
        <div className="junior-shell">
          <main className="junior-main">
            <section className="junior-hero">
              <h1>No login link yet</h1>
              <p>BudgetWise Junior works inside a parent's Family account.</p>
            </section>
            <div style={{ background: 'white', borderRadius: 16, padding: 20, marginTop: 20, color: '#1f2937' }}>
              <strong style={{ display: 'block', marginBottom: 10 }}>Ask your parent to:</strong>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>Create a BudgetWise account and switch to <b>Family</b> mode</li>
                <li>Go to <b>Members</b> and tap <b>Add Junior Kid</b></li>
                <li>Share the login link and 4-digit PIN they get</li>
              </ol>
              <p style={{ marginTop: 14, fontSize: '0.9rem', opacity: 0.75 }}>
                Parents sign in on the main BudgetWise app, not here.
              </p>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="junior-shell">
        <main className="junior-main">
          <section className="junior-hero">
            <h1>Who's signing in?</h1>
            <p>Tap your name.</p>
          </section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 16, marginTop: 20 }}>
            {deviceKids.map((k) => (
              <button
                key={k.memberId}
                type="button"
                onClick={() => navigate(`/junior/login?as=${k.memberId}`)}
                style={{
                  background: 'white',
                  border: 0,
                  borderRadius: 16,
                  padding: 20,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: k.color,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    fontWeight: 700,
                  }}
                >
                  {k.name.charAt(0).toUpperCase()}
                </div>
                <strong>{k.name}</strong>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="junior-shell">
      <main className="junior-main">
        <section className="junior-hero">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            Enter your PIN
          </h1>
          <p>Type the 4 numbers your parent gave you.</p>
        </section>

        <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
          <input
            type="tel"
            inputMode="numeric"
            autoFocus
            maxLength={4}
            pattern="\d{4}"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label="4-digit PIN"
            style={{
              width: '100%',
              fontSize: '2.5rem',
              letterSpacing: '0.8rem',
              textAlign: 'center',
              padding: '20px',
              border: '2px solid #fde68a',
              borderRadius: 16,
              background: '#fff',
            }}
          />
          {error && (
            <p style={{ color: '#dc2626', marginTop: 12, fontWeight: 600 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: '100%',
              marginTop: 20,
              background: canSubmit ? '#10b981' : '#d1d5db',
              color: 'white',
              border: 0,
              padding: '16px',
              fontSize: '1.1rem',
              fontWeight: 700,
              borderRadius: 16,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Checking…' : "Let's go"}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: '0.85rem', color: '#4b5563', textAlign: 'center', lineHeight: 1.6 }}>
          Kids sign in with the link + PIN their parent gives them.
          Parents need a BudgetWise account in <b>Family</b> mode and must
          add the kid from the Members page.
        </p>
      </main>
    </div>
  );
}

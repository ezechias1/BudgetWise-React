import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { signInAsKid } from '@/lib/junior-auth';
import { supabase } from '@/lib/supabase';
import { listDeviceKids, rememberDeviceKid } from '@/lib/junior-device-kids';
import { useJuniorLang } from '@/i18n/junior';
import { LanguagePicker } from '@/components/junior/LanguagePicker';

export default function JuniorLoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const memberId = params.get('as') || '';
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const deviceKids = listDeviceKids();
  const { t } = useJuniorLang();

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
        setError(t.login_pin_rate_limited);
      } else if (attempts + 1 >= 3) {
        setError(t.login_pin_hint_stale);
      } else {
        setError(t.login_pin_wrong);
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <BackToParentLink navigate={navigate} label={t.nav_back_parent} />
              <LanguagePicker />
            </div>
            <section className="junior-hero">
              <h1>{t.login_no_link_title}</h1>
              <p>{t.login_no_link_intro}</p>
            </section>
            <div style={{ background: 'white', borderRadius: 16, padding: 20, marginTop: 20, color: '#1f2937' }}>
              <strong style={{ display: 'block', marginBottom: 10 }}>{t.login_no_link_ask_parent}</strong>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>{t.login_no_link_step1}</li>
                <li>{t.login_no_link_step2}</li>
                <li>{t.login_no_link_step3}</li>
              </ol>
              <p style={{ marginTop: 14, fontSize: '0.9rem', opacity: 0.75 }}>
                {t.login_no_link_footer}
              </p>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="junior-shell">
        <main className="junior-main">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <BackToParentLink navigate={navigate} label={t.nav_back_parent} />
            <LanguagePicker />
          </div>
          <section className="junior-hero">
            <h1>{t.login_pick_title}</h1>
            <p>{t.login_pick_subtitle}</p>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          {/* Always rendered now — with 0 or 1 remembered kids, the picker
              screen isn't a useful destination, so this falls back to
              parent login instead of leaving the kid stuck here. */}
          <button
            type="button"
            onClick={() =>
              deviceKids.length > 1
                ? navigate('/junior/login', { replace: true })
                : navigate('/?intent=parent', { replace: true })
            }
            style={{
              background: 'transparent',
              border: 0,
              color: '#4b5563',
              padding: '6px 0',
              fontSize: '0.95rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
            aria-label={deviceKids.length > 1 ? t.login_pin_back : t.nav_back_parent}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"></path>
              <path d="M12 19l-7-7 7-7"></path>
            </svg>
            {deviceKids.length > 1 ? t.login_pin_back : t.nav_back_parent}
          </button>
          <LanguagePicker />
        </div>
        <section className="junior-hero">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            {t.login_pin_title}
          </h1>
          <p>{t.login_pin_subtitle}</p>
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
            aria-label={t.login_pin_aria}
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
            {submitting ? t.login_pin_checking : t.login_pin_go}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: '0.85rem', color: '#4b5563', textAlign: 'center', lineHeight: 1.6 }}>
          {t.login_pin_footer}
        </p>
      </main>
    </div>
  );
}

// A way back to parent login from every screen in the Junior login flow —
// previously only the PIN screen (with 2+ remembered kids) had any way
// back at all, leaving a dead end everywhere else.
function BackToParentLink({ navigate, label }: { navigate: (path: string, opts?: { replace: boolean }) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => navigate('/?intent=parent', { replace: true })}
      style={{
        background: 'transparent',
        border: 0,
        color: '#4b5563',
        padding: '6px 0',
        fontSize: '0.95rem',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
      aria-label={label}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5"></path>
        <path d="M12 19l-7-7 7-7"></path>
      </svg>
      {label}
    </button>
  );
}

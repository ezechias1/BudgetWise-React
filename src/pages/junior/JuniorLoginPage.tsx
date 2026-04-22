import { useState, type FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { signInAsKid } from '@/lib/junior-auth';

export default function JuniorLoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const memberId = params.get('as') || '';
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = /^\d{4}$/.test(pin) && memberId.length > 0 && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await signInAsKid(memberId, pin);
    if (err) {
      setError('Wrong PIN. Try again.');
      setPin('');
      setSubmitting(false);
      return;
    }
    navigate('/junior/home', { replace: true });
  };

  if (!memberId) {
    return (
      <div className="junior-shell">
        <main className="junior-main">
          <h1 style={{ color: '#dc2626' }}>Link missing</h1>
          <p>Ask your parent for your login link again.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="junior-shell">
      <main className="junior-main">
        <section className="junior-hero">
          <h1>🔐 Enter your PIN</h1>
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
      </main>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInAsKid } from '@/lib/junior-auth';
import { supabase } from '@/lib/supabase';
import { rememberDeviceKid } from '@/lib/junior-device-kids';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Props {
  memberId: string;
  name: string;
  color: string;
  onClose: () => void;
}

export function SignInAsKidModal({ memberId, name, color, onClose }: Props) {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useDialogA11y();
  const canSubmit = /^\d{4}$/.test(pin) && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // Stash the parent's email BEFORE the auth switch so we can pre-fill
    // it on /auth?intent=parent when they come back. Supabase holds one
    // session at a time — this is the cheapest way to smooth re-login.
    try {
      const { data: { user: parent } } = await supabase.auth.getUser();
      if (parent?.email) {
        localStorage.setItem('budgetwise-parent-email', parent.email);
      }
    } catch {
      // Best effort — don't block kid sign-in on this.
    }
    const { status } = await signInAsKid(memberId, pin);
    if (status !== 'ok') {
      setError(status === 'rate_limited' ? 'Too many tries — wait a minute.' : 'Wrong PIN.');
      setPin('');
      setSubmitting(false);
      return;
    }
    const { data: member } = await supabase
      .from('family_members')
      .select('color')
      .eq('id', memberId)
      .maybeSingle();
    rememberDeviceKid({ memberId, name, color: member?.color ?? color });
    navigate('/junior/home', { replace: true });
  };

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-as-kid-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="sign-in-as-kid-title">Sign in as {name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p style={{ opacity: 0.8 }}>
          Enter {name}&apos;s 4-digit PIN to switch into their Junior view. You&apos;ll
          be signed out of the parent account — sign back in when they&apos;re done.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="kid-switch-pin">PIN</label>
            <input
              id="kid-switch-pin"
              type="tel"
              inputMode="numeric"
              autoFocus
              maxLength={4}
              pattern="\d{4}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ fontSize: '1.6rem', letterSpacing: '0.3em', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          {error && <p style={{ color: '#dc2626', fontWeight: 600 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-primary" style={{ flex: 1 }}>
              {submitting ? 'Switching…' : "Let's go"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

const COLORS = ['#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export function AddKidModal({ onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [age, setAge] = useState<string>('');
  const [color, setColor] = useState(COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canSubmit =
    name.trim().length > 0 && /^\d{4}$/.test(pin) && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not signed in.');
        setSubmitting(false);
        return;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-kid-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            pin,
            color,
            age: age ? Number(age) : null,
          }),
        },
      );

      const payload = await resp.json();
      if (!resp.ok) {
        setError(payload.error || 'Failed to add kid.');
        setSubmitting(false);
        return;
      }

      const url = `${window.location.origin}/junior/login?as=${payload.member_id}`;
      setLoginUrl(url);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!loginUrl) return;
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the input so the user can copy manually
      const input = document.getElementById('kid-login-url-input') as HTMLInputElement | null;
      input?.select();
    }
  };

  if (loginUrl) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>{name} is ready</h2>
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p>Share this link with your child. They&apos;ll enter their PIN on that page.</p>
          <div className="field">
            <label htmlFor="kid-login-url-input">Login link</label>
            <input
              id="kid-login-url-input"
              readOnly
              value={loginUrl}
              onFocus={(e) => e.currentTarget.select()}
              style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </div>
          <button
            type="button"
            onClick={handleCopyLink}
            className="btn-primary"
            style={{ marginTop: 8, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {copied ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy link
              </>
            )}
          </button>
          <div className="field" style={{ marginTop: 16 }}>
            <label>PIN</label>
            <p style={{ margin: 0 }}>
              <code style={{ fontSize: '1.4rem', letterSpacing: '0.4rem', fontWeight: 700 }}>
                {pin}
              </code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ marginTop: 20, width: '100%' }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add a kid</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="kid-name">Name</label>
            <input
              id="kid-name"
              type="text"
              required
              placeholder="e.g. Sarah"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="kid-pin">4-digit PIN</label>
            <input
              id="kid-pin"
              type="tel"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              placeholder="e.g. 4721"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="kid-age">Age (optional)</label>
            <input
              id="kid-age"
              type="number"
              min={4}
              max={18}
              placeholder="Optional"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Avatar colour</label>
            <div className="color-picker-row">
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '3px solid #1f2937' : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  aria-label={`Pick colour ${c}`}
                />
              ))}
            </div>
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontWeight: 600 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {submitting ? 'Adding…' : 'Add kid'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

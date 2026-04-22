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

  if (loginUrl) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>🎉 {name} is ready</h2>
          <p>Share this link with your child. They&apos;ll enter their PIN on that page.</p>
          <input
            readOnly
            value={loginUrl}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: '100%', padding: 10, fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <p style={{ marginTop: 16 }}>
            <strong>PIN:</strong> <code style={{ fontSize: '1.2rem' }}>{pin}</code>
          </p>
          <button onClick={onClose} className="btn-primary" style={{ marginTop: 20 }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add a kid</h2>
        <form onSubmit={handleSubmit}>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <label>4-digit PIN
            <input
              type="tel"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </label>

          <label>Age (optional)
            <input
              type="number"
              min={4}
              max={18}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>

          <label>Avatar colour
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
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
                  }}
                  aria-label={`Pick colour ${c}`}
                />
              ))}
            </div>
          </label>

          {error && (
            <p style={{ color: '#dc2626', fontWeight: 600 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {submitting ? 'Adding…' : 'Add kid'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { enablePush, getPushStatus, type PushStatus } from '@/lib/push-subscription';

const DISMISS_KEY = 'bw-junior-push-prompt-dismissed';

export function PushPromptCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushStatus().then(setStatus);
  }, []);

  if (!status) return null;
  if (!status.supported) return null;
  if (status.subscribed) return null;
  if (status.permission === 'denied') return null;
  if (dismissed) return null;

  async function onEnable() {
    setBusy(true);
    const ok = await enablePush();
    if (ok) {
      setStatus(await getPushStatus());
    } else {
      // Permission denied or upsert failed — hide; AccountPage is the recovery path.
      setDismissed(true);
      localStorage.setItem(DISMISS_KEY, '1');
    }
    setBusy(false);
  }

  function onDismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
  }

  return (
    <div className="card push-prompt-card" style={{ padding: 16, marginBottom: 16 }}>
      <p style={{ margin: '0 0 12px 0' }}>
        Get notified when your kid finishes a chore — even when the app is closed.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={onEnable} disabled={busy}>
          Enable
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDismiss} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}

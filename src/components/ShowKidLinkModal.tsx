import { useState } from 'react';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Props {
  memberId: string;
  kidName: string;
  onClose: () => void;
}

/**
 * Re-display a Junior kid's login URL for an existing member (the Add Kid
 * success view shows the URL once — this is the "I lost the link" recovery
 * path). Does NOT show the PIN (hash only, not retrievable) — parent uses
 * Reset PIN flow if they forgot it.
 */
export function ShowKidLinkModal({ memberId, kidName, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const dialog = useDialogA11y();
  const loginUrl = `${window.location.origin}/junior/login?as=${memberId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById('show-kid-login-url') as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kid-link-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="kid-link-title">{kidName}&apos;s login link</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p>
          Share this link with {kidName}. They&apos;ll enter their PIN on that
          page. If they&apos;ve forgotten their PIN, use the{' '}
          <strong>Reset PIN</strong> action to set a new one.
        </p>
        <div className="field">
          <label htmlFor="show-kid-login-url">Login link</label>
          <input
            id="show-kid-login-url"
            readOnly
            value={loginUrl}
            onFocus={(e) => e.currentTarget.select()}
            style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="btn-primary"
          style={{
            marginTop: 8,
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {copied ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ marginTop: 12, width: '100%' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

/**
 * Sidebar prompt to add BudgetWise to the home screen.
 *
 * Renders NOTHING once the app is installed — that is the whole contract. It is
 * also silent in browsers that cannot install at all (desktop Firefox, Chrome
 * on iOS), because telling someone to tap a button their browser does not have
 * is worse than saying nothing.
 *
 * This is not a growth nag. Push notifications do not reach a browser tab on
 * iOS at all, so a stokvel "your contribution is due tomorrow" reminder or a
 * Junior approval nudge can only arrive on an installed app. Right now 1 of 31
 * accounts has a push subscription, which is the real reason reminders would
 * reach nobody.
 */
export function InstallAppCard() {
  const { state, install } = useInstallPrompt();
  // Session-only. Dismissing hides it until the next visit rather than for
  // good: the reminders it unlocks are the point, and someone who dismissed it
  // once in March should still be offered it in June. It never returns within
  // a session, so it cannot become a thing you keep swatting away.
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  if (state === 'installed' || state === 'unavailable' || dismissed) return null;

  const handleInstall = async () => {
    setBusy(true);
    await install();
    setBusy(false);
  };

  return (
    <div className="install-card">
      <button
        type="button"
        className="install-card-close"
        aria-label="Hide install prompt"
        onClick={() => setDismissed(true)}
      >
        &times;
      </button>

      <div className="install-card-head">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M12 18h.01" />
        </svg>
        <strong>Add to your home screen</strong>
      </div>

      <p className="install-card-copy">
        {state === 'manual'
          ? 'Reminders — like a stokvel payment due tomorrow — can only reach you once BudgetWise is on your home screen.'
          : 'Opens like a normal app, works offline, and lets us send you reminders.'}
      </p>

      {state === 'prompt' ? (
        <button
          type="button"
          className="install-card-btn"
          onClick={handleInstall}
          disabled={busy}
        >
          {busy ? 'Installing…' : 'Install app'}
        </button>
      ) : (
        <>
          {/* iOS Safari has no install API — the Share sheet is the only route,
              so the honest thing is to point at it rather than offer a button
              that cannot work. */}
          <button
            type="button"
            className="install-card-btn"
            onClick={() => setShowIosSteps((s) => !s)}
            aria-expanded={showIosSteps}
          >
            {showIosSteps ? 'Hide steps' : 'Show me how'}
          </button>
          {showIosSteps && (
            <ol className="install-card-steps">
              <li>
                Tap the Share button
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px', margin: '0 3px' }}>
                  <path d="M12 16V4m0 0L8 8m4-4l4 4" />
                  <path d="M4 14v5a2 2 0 002 2h12a2 2 0 002-2v-5" />
                </svg>
                at the bottom of Safari
              </li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong>, then open BudgetWise from your home screen</li>
            </ol>
          )}
        </>
      )}
    </div>
  );
}

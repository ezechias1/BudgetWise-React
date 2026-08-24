import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the app is running as an installed app, and how (or whether) it can
 * still be installed.
 *
 * This exists because push notifications are not available to a browser tab on
 * iOS at all — the app has to be on the home screen first. So "install" is not
 * a nice-to-have here; it is the precondition for every stokvel and Junior
 * reminder actually arriving.
 *
 * Three states matter, and they need different UI:
 *
 *   installed  — nothing to offer. Never prompt; the whole point is not to nag
 *                someone who already did it.
 *   prompt     — Chrome/Edge/Android fired `beforeinstallprompt`, so we hold a
 *                deferred event and can install with one tap.
 *   manual     — iOS Safari, which has no install API at all. The only thing
 *                that works is telling the user where the button is.
 */
export type InstallState = 'installed' | 'prompt' | 'manual' | 'unavailable';

/** The slice of BeforeInstallPromptEvent we use. Not in lib.dom yet. */
interface DeferredPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // The standards-track signal, honoured by Chrome, Edge and Android.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari never implemented display-mode; it sets this instead, and only
  // when launched from the home screen.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function detectIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  // Chrome and Firefox on iOS are Safari underneath but cannot install at all,
  // so telling their users to "tap Share" would send them somewhere that has
  // no Add to Home Screen entry.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function useInstallPrompt() {
  const [installed, setInstalled] = useState(detectStandalone);
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [iosSafari] = useState(detectIosSafari);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Chrome shows its own mini-infobar unless this is prevented; we want the
      // prompt to come from our own control in the sidebar so it can be
      // explained rather than appearing unannounced.
      e.preventDefault();
      setDeferred(e as DeferredPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // display-mode flips without a reload when the user installs from the
    // browser's own menu, which `appinstalled` does not always cover.
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = (e: MediaQueryListEvent) => {
      if (e.matches) setInstalled(true);
    };
    mq?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const state: InstallState = installed
    ? 'installed'
    : deferred
      ? 'prompt'
      : iosSafari
        ? 'manual'
        : 'unavailable';

  /** Fires the native install dialog. Only meaningful when state === 'prompt'. */
  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use: Chrome will fire a fresh one if the user
    // declines and becomes eligible again, so drop this one either way.
    setDeferred(null);
    if (outcome === 'accepted') setInstalled(true);
    return outcome;
  }, [deferred]);

  return { state, install, installed };
}

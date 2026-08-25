import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}

/**
 * `navigator.serviceWorker.ready` never settles when no service worker is
 * registered — it does not reject, it waits forever. Anything that awaits it
 * bare therefore hangs for the lifetime of the page rather than failing, which
 * turns a missing worker into a button stuck on "Turning on…" and a status read
 * that never returns. Bounded here so callers get a definite answer.
 *
 * Reproduced directly: `await navigator.serviceWorker.ready` in a context with
 * no registration hung until the harness killed it at 30 minutes.
 */
const SW_READY_TIMEOUT_MS = 5000;

export async function swReadyOrNull(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
  ]).catch(() => null);
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported =
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) return { supported: false, permission: 'default', subscribed: false };
  const reg = await swReadyOrNull();
  // No worker means this device cannot receive push, whatever the permission
  // says. Reporting subscribed:false with supported:false keeps the caller from
  // offering a control that cannot work.
  if (!reg) return { supported: false, permission: Notification.permission, subscribed: false };
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return { supported: true, permission: Notification.permission, subscribed: sub !== null };
}

/**
 * Request permission, subscribe, upsert to push_subscriptions.
 * Returns true on success, false if the user denied or anything failed.
 */
export async function enablePush(): Promise<boolean> {
  if (!VAPID_PUBLIC) {
    console.warn('[push] VITE_VAPID_PUBLIC_KEY missing');
    return false;
  }
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return false;
  }
  if (Notification.permission !== 'granted') return false;

  const reg = await swReadyOrNull();
  if (!reg) {
    console.warn('[push] no service worker registration; cannot subscribe');
    return false;
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }
  const json = sub.toJSON();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      platform: 'webpush',
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint,device_token' },
  );
  if (error) {
    console.warn('[push] upsert failed', error);
    return false;
  }
  return true;
}

export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  // Bounded: a bare await here left "turn off notifications" hanging forever on
  // a device with no registration, with no error and no completion.
  const reg = await swReadyOrNull();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // Previously discarded: a failed delete left the row behind after the
    // browser subscription was already dropped, so the sender kept pushing to
    // a dead endpoint and the user still read as "subscribed" server-side —
    // silently. disablePush runs without a user present to answer a prompt,
    // so log the failure rather than alerting.
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);
    if (error) {
      console.error(
        '[push] could not delete push subscription — the stale row will keep receiving pushes',
        { endpoint, error: error.message },
      );
    }
  }
}

import { useCallback, useEffect, useState } from 'react';

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

/**
 * Tracks the browser's Notification permission state. If the user hasn't
 * decided yet (`default`), the parent's DashboardLayout renders a small
 * banner offering to enable reminders for kid approvals.
 *
 * We don't prompt automatically on mount — mobile browsers treat that as
 * spam. The banner gives the user an explicit Allow button that triggers
 * `Notification.requestPermission()` from a user gesture.
 */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<Permission>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as Permission;
  });

  // Re-read on mount in case the user changed it in browser settings while
  // the tab was open.
  useEffect(() => {
    if (!('Notification' in window)) return;
    setPermission(Notification.permission as Permission);
  }, []);

  const request = useCallback(async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result as Permission);
  }, []);

  return { permission, request };
}

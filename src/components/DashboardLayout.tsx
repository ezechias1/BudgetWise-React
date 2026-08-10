import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AccountPickerModal } from './AccountPickerModal';
import { TripReviewBanner } from './TripReviewBanner';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { setupParentNotificationPolling } from '@/lib/junior-notifications';
import { maybeFireSundayReminder } from '@/lib/junior-sunday-reminder';
import type { Mode } from '@/types';

/**
 * Shell for every /dashboard/* route. Renders the sidebar, the mobile header,
 * and a <main> outlet. Matches the top-level layout from dashboard.html
 * (`<nav class="sidebar">` + `.mobile-header` + `<main class="main-content">`).
 *
 * Mobile drawer: Sidebar owns the `open` class on its own <nav> so the
 * vanilla CSS rule `.sidebar.open { transform: translateX(0) }` kicks in.
 * The overlay uses `.active` (vanilla class), not `.visible`.
 */
export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [permissionDismissed, setPermissionDismissed] = useState(false);
  const [sundayBanner, setSundayBanner] = useState<
    { totalOwedCents: number; kidsCount: number } | null
  >(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const location = useLocation();
  const { toggleTheme } = useTheme();
  const { user } = useAuth();
  const { setMode } = useMode();
  const { isChild, loading: kidLoading } = useKidProfile();
  const { permission, request } = useNotificationPermission();

  // Post-login account picker: AuthPage sets sessionStorage on any successful
  // login (password, Google, password-reset). Fire the modal as soon as a
  // user is available — don't wait for user_settings to load (that DB round
  // trip is what was making the popup appear "too late"). ENABLE_PRO_SYSTEM
  // is currently false so every user is effectively Pro and entitled to the
  // picker; when the Pro gate is re-enabled later, filter here.
  useEffect(() => {
    if (!user) return;
    const flag = sessionStorage.getItem('bw-just-logged-in');
    if (!flag) return;
    sessionStorage.removeItem('bw-just-logged-in');
    setShowAccountPicker(true);
  }, [user]);

  const handlePickAccount = (m: Mode) => {
    setMode(m);
    // Sync body class immediately so the accent flips in the same frame as
    // the modal closes. Without this, ModeContext's useEffect runs *after*
    // the commit, and the accent lags visibly (sometimes never updates if
    // the effect is skipped due to deduped state). Mirrors the logic in
    // ModeContext so the two stay in sync.
    const body = document.body;
    body.classList.remove('business-mode', 'family-mode', 'personal');
    if (m === 'business') body.classList.add('business-mode');
    else if (m === 'family') body.classList.add('family-mode');
    else body.classList.add('personal');
    setShowAccountPicker(false);
  };

  // Close drawer on navigation + scroll to top of the new page.
  // Mobile browsers otherwise keep the previous scroll offset, which looks
  // like the new page "opened at the bottom".
  useEffect(() => {
    setMobileOpen(false);
    // Reset both window and the .main-content container — whichever one
    // is actually the scrollable parent at the current breakpoint.
    window.scrollTo(0, 0);
    const main = document.querySelector('.main-content');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  // Parent-only: poll for approval nudges queued by kids. Kids shouldn't
  // poll their parent's notifications (nor would RLS let them).
  useEffect(() => {
    if (!user || kidLoading || isChild) return;
    const cleanup = setupParentNotificationPolling(user.id);
    maybeFireSundayReminder(user.id).then(({ fired, totalOwedCents, kidsCount }) => {
      if (fired && totalOwedCents > 0) {
        setSundayBanner({ totalOwedCents, kidsCount });
      }
    });
    return cleanup;
  }, [user, kidLoading, isChild]);

  const showPermissionBanner =
    user && !kidLoading && !isChild && permission === 'default' && !permissionDismissed;

  return (
    <>
      {showAccountPicker && (
        <AccountPickerModal
          onPick={handlePickAccount}
          onClose={() => setShowAccountPicker(false)}
        />
      )}

      <Sidebar mobileOpen={mobileOpen} />

      {/* Mobile overlay — clicking it closes the drawer (vanilla behavior) */}
      <div
        className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile header — port of dashboard.html lines 200-209 */}
      <div className="mobile-header">
        <button
          type="button"
          className="menu-toggle"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <span className="mobile-brand">BudgetWise</span>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          <svg
            className="icon-sun"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <svg
            className="icon-moon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        </button>
      </div>

      <main className="main-content loaded">
        {/* Kids don't have trips — only parent accounts see this. */}
        {user && !kidLoading && !isChild && <TripReviewBanner />}
        {sundayBanner && (
          <div role="alert" className="sunday-banner">
            <div>
              <strong>Sunday settle-up</strong>
              <br />
              You owe R{(sundayBanner.totalOwedCents / 100).toFixed(2)} across {sundayBanner.kidsCount} {sundayBanner.kidsCount === 1 ? 'child' : 'children'}.
              <a href="/dashboard/junior" style={{ marginLeft: 8 }}>Open Junior →</a>
            </div>
            <button onClick={() => setSundayBanner(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        {showPermissionBanner && (
          <div className="permission-banner">
            <span style={{ fontSize: '0.95rem' }}>
              Want reminders when the kids need approval?
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="permission-banner-allow"
                onClick={() => void request()}
              >
                Allow
              </button>
              <button
                type="button"
                className="permission-banner-dismiss"
                onClick={() => setPermissionDismissed(true)}
              >
                Not now
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>
    </>
  );
}

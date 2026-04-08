import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useTheme } from '@/contexts/ThemeContext';

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
  const location = useLocation();
  const { toggleTheme } = useTheme();

  // Close drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <>
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
        <Outlet />
      </main>
    </>
  );
}

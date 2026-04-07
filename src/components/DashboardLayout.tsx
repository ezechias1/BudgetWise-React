import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/**
 * Shell for every /dashboard/* route. Renders the sidebar, the mobile header,
 * and a <main> outlet. Matches the top-level layout from dashboard.html
 * (`<nav class="sidebar">` + `.mobile-header` + `<main class="main-content">`).
 */
export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className={mobileOpen ? 'sidebar-wrap open' : 'sidebar-wrap'}>
        <Sidebar />
      </div>

      {/* Mobile overlay — clicking it closes the drawer (vanilla behavior) */}
      <div
        className={`sidebar-overlay ${mobileOpen ? 'visible' : ''}`}
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
        <span style={{ width: 24 }} />
      </div>

      <main className="main-content">
        <Outlet />
      </main>
    </>
  );
}

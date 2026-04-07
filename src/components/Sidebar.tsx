import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { Mode } from '@/types';

interface NavEntry {
  to: string;
  label: Partial<Record<Mode, string>>;
  fallback: string;
  hideIn?: Mode[];
  icon: JSX.Element;
}

// Port of the `.sidebar-nav` `<li class="nav-item">` entries from dashboard.html.
// Kept data-driven so Pro gating and mode-based hiding are one place, not sprinkled.
const NAV: NavEntry[] = [
  {
    to: '/dashboard',
    fallback: 'Overview',
    label: { personal: 'Overview', business: 'Dashboard', family: 'Home' },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    to: '/dashboard/expenses',
    fallback: 'Expenses',
    label: { personal: 'Expenses', business: 'Transactions', family: 'Spending' },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 4H3v16h18V4zM3 10h18" />
        <path d="M7 15h4" />
      </svg>
    ),
  },
  {
    to: '/dashboard/savings',
    fallback: 'Savings',
    label: { personal: 'Savings', family: 'Family Savings' },
    hideIn: ['business'],
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-16 0H3" />
        <path d="M9 7h6m-6 4h6m-6 4h4" />
      </svg>
    ),
  },
  {
    to: '/dashboard/currency',
    fallback: 'Currency',
    label: { personal: 'Currency', business: 'FX Rates' },
    hideIn: ['family'],
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
  },
  {
    to: '/dashboard/advice',
    fallback: 'Advice',
    label: { personal: 'Advice', business: 'Insights', family: 'Tips' },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
      </svg>
    ),
  },
  {
    to: '/dashboard/account',
    fallback: 'Account',
    label: { personal: 'Account', business: 'Settings', family: 'Account' },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const { mode, setMode, label } = useMode();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close mode dropdown when clicking outside (matches vanilla behavior)
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  const handleLogout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const handleModeSelect = (next: Mode) => {
    setMode(next);
    setDropdownOpen(false);
  };

  const modeLabel = mode === 'personal' ? 'Personal' : mode === 'business' ? 'Business' : 'Family';
  const initials = (user?.user_metadata?.full_name || user?.email || 'U')
    .toString()
    .split(/\s+/)
    .map((p: string) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav className="sidebar" id="sidebar">
      <div className="sidebar-brand">
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="16" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="7" y="12" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.65" />
          <rect x="12" y="8" width="3" height="13" rx="0.5" fill="currentColor" opacity="0.8" />
          <rect x="17" y="4" width="3" height="17" rx="0.5" fill="currentColor" opacity="0.95" />
          <path d="M3 14L19 3" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 2.5L20 3L18.5 6.5" fill="currentColor" stroke="none" />
        </svg>
        <span>BudgetWise</span>
      </div>

      {/* Mode dropdown — port of .mode-dropdown from dashboard.html lines 53-80 */}
      <div className="mode-dropdown" ref={dropdownRef}>
        <button
          type="button"
          className="mode-dropdown-btn"
          onClick={() => setDropdownOpen((o) => !o)}
        >
          <div className="mode-dropdown-selected">
            {mode === 'personal' && (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
            {mode === 'business' && (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18M9 8h1m4 0h1M9 12h1m4 0h1M9 16h1m4 0h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" />
              </svg>
            )}
            {mode === 'family' && (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
              </svg>
            )}
            <span>{modeLabel}</span>
          </div>
          <svg
            className="mode-chevron"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="mode-dropdown-menu">
            {(
              [
                { id: 'personal', text: 'Personal', pro: false },
                { id: 'business', text: 'Business', pro: true },
                { id: 'family', text: 'Family', pro: true },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`mode-option ${mode === opt.id ? 'active' : ''}`}
                onClick={() => handleModeSelect(opt.id)}
              >
                <span>{opt.text}</span>
                {opt.pro && <span className="pro-mode-tag">PRO</span>}
                {mode === opt.id && (
                  <svg
                    className="mode-check"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <ul className="sidebar-nav">
        {NAV.filter((n) => !n.hideIn?.includes(mode)).map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.to === '/dashboard'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {n.icon}
              <span className="nav-label">{label(n.label, n.fallback)}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? (
            <svg
              className="icon-moon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          ) : (
            <svg
              className="icon-sun"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          )}
        </button>

        <div className="user-info">
          <div className="user-avatar">{initials}</div>
          <span>{user?.user_metadata?.full_name ?? user?.email ?? 'User'}</span>
        </div>

        <button
          type="button"
          className="btn-logout"
          onClick={handleLogout}
          aria-label="Log out"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

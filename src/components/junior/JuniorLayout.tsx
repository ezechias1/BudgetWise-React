import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useKidProfile } from '@/hooks/useKidProfile';
import { ageFromDob, bracketFor } from '@/lib/junior-age';
import { GraduationBanner, GraduationBlock } from './GraduationBanner';

export function JuniorLayout() {
  const { signOut } = useAuth();
  const { member } = useKidProfile();
  const navigate = useNavigate();

  // Junior surface is light-only in Phase 1; force body class so vanilla-CSS
  // dark selectors elsewhere don't bleed in.
  useEffect(() => {
    document.body.classList.add('junior-active');
    return () => document.body.classList.remove('junior-active');
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const handleBackToParent = async () => {
    await signOut();
    navigate('/auth?intent=parent', { replace: true });
  };

  // Age-aware palette: data-bracket drives per-bracket CSS variables defined
  // in styles-junior.css. Falls back to 10-12 bracket defaults while loading.
  const age = ageFromDob(member?.date_of_birth ?? null);
  const bracket = age !== null ? bracketFor(age) : '10-12';

  // Age 18+ sees the graduation block INSTEAD of their normal Junior content —
  // prevents a grad from continuing to accrue chore rewards on a kid account.
  const hasGraduated = age !== null && age >= 18;

  return (
    <div className="junior-shell" data-bracket={bracket}>
      <main className="junior-main">
        <GraduationBanner />
        {hasGraduated ? <GraduationBlock /> : <Outlet />}
        <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <button
            className="junior-back-parent"
            onClick={handleBackToParent}
            style={{
              flex: '1 1 180px',
              background: 'white',
              color: '#1f2937',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '10px 16px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: 'inherit',
              fontSize: '0.92rem',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to parent account
          </button>
          <button
            className="junior-signout"
            onClick={handleSignOut}
            style={{ flex: '0 0 auto', margin: 0 }}
          >
            Sign out
          </button>
        </div>
      </main>
      <nav className="junior-bottom-nav">
        <NavLink to="/junior/home" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </NavLink>
        <NavLink to="/junior/chores" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Chores
        </NavLink>
        <NavLink to="/junior/jars" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="5" height="14" rx="1" />
            <rect x="10" y="4" width="5" height="17" rx="1" />
            <rect x="17" y="10" width="5" height="11" rx="1" />
          </svg>
          Jars
        </NavLink>
        <NavLink to="/junior/missions" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          Missions
        </NavLink>
      </nav>
    </div>
  );
}

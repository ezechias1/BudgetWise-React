import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function JuniorLayout() {
  const { signOut } = useAuth();
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

  return (
    <div className="junior-shell">
      <main className="junior-main">
        <Outlet />
        <button className="junior-signout" onClick={handleSignOut}>
          Sign out
        </button>
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
      </nav>
    </div>
  );
}

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
          <span>🏠</span>Home
        </NavLink>
        {/* More tabs added in Phase 2+ */}
      </nav>
    </div>
  );
}

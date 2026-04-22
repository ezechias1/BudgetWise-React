import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useKidProfile } from '@/hooks/useKidProfile';
import { LoadingOverlay } from './LoadingOverlay';

/**
 * Gate a subtree behind: (a) a signed-in user and (b) a specific role.
 *
 * role = 'parent' — kids get bounced to /junior/home
 * role = 'child'  — parents get bounced to /dashboard
 */
export function AuthRoleGate({
  role,
  children,
}: {
  role: 'parent' | 'child';
  children: ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { isChild, loading: kidLoading } = useKidProfile();
  const location = useLocation();

  if (authLoading || kidLoading) return <LoadingOverlay />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;

  if (role === 'parent' && isChild) {
    return <Navigate to="/junior/home" replace />;
  }
  if (role === 'child' && !isChild) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

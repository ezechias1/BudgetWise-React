import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isAdmin } from '@/lib/access';
import { LoadingOverlay } from './LoadingOverlay';

/** Gate a subtree behind a signed-in Supabase user. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingOverlay />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Gate a subtree behind admin-only access. Non-admins get bounced to /dashboard. */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingOverlay />;
  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingOverlay } from './LoadingOverlay';

/** Gate a subtree behind a signed-in Supabase user. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingOverlay />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

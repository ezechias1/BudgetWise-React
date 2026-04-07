import { Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from '@/pages/AuthPage';
import PagePlaceholder from '@/pages/PagePlaceholder';
import { DashboardLayout } from '@/components/DashboardLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ModeProvider } from '@/contexts/ModeContext';

/**
 * Top-level router + provider tree.
 *
 * State flow (brief):
 *   ThemeProvider — owns dark/light, mirrors it onto <body class="light">.
 *   ModeProvider  — owns personal/business/family, mirrors onto
 *                   <body class="business-mode|family-mode|personal">.
 *   AuthProvider  — owns Supabase session, exposes sign in/up/out helpers.
 *
 * Because Theme and Mode both write body classes, the vanilla CSS selectors
 * keep working unchanged — no CSS had to be rewritten for the port.
 */
export default function App() {
  return (
    <ThemeProvider>
      <ModeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<AuthPage />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <PagePlaceholder
                    title="Overview"
                    note="Stat cards, Chart.js spending breakdown, and recent transactions — pending port."
                  />
                }
              />
              <Route
                path="expenses"
                element={
                  <PagePlaceholder
                    title="Expenses"
                    note="Expense list + add/edit/delete modal + category chips — pending port."
                  />
                }
              />
              <Route
                path="savings"
                element={
                  <PagePlaceholder
                    title="Savings"
                    note="Goal list with progress rings and contribution flow — pending port."
                  />
                }
              />
              <Route
                path="currency"
                element={
                  <PagePlaceholder
                    title="Currency"
                    note="Live FX rates via exchangerate-api.com — pending port."
                  />
                }
              />
              <Route
                path="advice"
                element={
                  <PagePlaceholder
                    title="Advice"
                    note="AI-powered spending insights — pending port."
                  />
                }
              />
              <Route
                path="account"
                element={
                  <PagePlaceholder
                    title="Account"
                    note="Profile, subscription, theme toggle, mode switch — pending port."
                  />
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

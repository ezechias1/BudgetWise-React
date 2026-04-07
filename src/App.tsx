import { Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from '@/pages/AuthPage';
import OverviewPage from '@/pages/OverviewPage';
import ExpensesPage from '@/pages/ExpensesPage';
import SavingsPage from '@/pages/SavingsPage';
import AccountPage from '@/pages/AccountPage';
import CurrencyPage from '@/pages/CurrencyPage';
import AdvicePage from '@/pages/AdvicePage';
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
              <Route index element={<OverviewPage />} />
              <Route path="expenses" element={<ExpensesPage />} />
              <Route path="savings" element={<SavingsPage />} />
              <Route path="currency" element={<CurrencyPage />} />
              <Route path="advice" element={<AdvicePage />} />
              <Route path="account" element={<AccountPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

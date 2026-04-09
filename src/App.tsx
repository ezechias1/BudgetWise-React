import { Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import AuthPage from '@/pages/AuthPage';
import OverviewPage from '@/pages/OverviewPage';
import ExpensesPage from '@/pages/ExpensesPage';
import SavingsPage from '@/pages/SavingsPage';
import AccountPage from '@/pages/AccountPage';
import CurrencyPage from '@/pages/CurrencyPage';
import AdvicePage from '@/pages/AdvicePage';
import BankPage from '@/pages/BankPage';
import StokvelPage from '@/pages/StokvelPage';
import LoadSheddingPage from '@/pages/LoadSheddingPage';
import InvoicesPage from '@/pages/InvoicesPage';
import ClientsPage from '@/pages/ClientsPage';
import PnLPage from '@/pages/PnLPage';
import TaxPage from '@/pages/TaxPage';
import MembersPage from '@/pages/MembersPage';
import AllowancesPage from '@/pages/AllowancesPage';
import ChoresPage from '@/pages/ChoresPage';
import FamilyGoalsPage from '@/pages/FamilyGoalsPage';
import SpendingTrackerPage from '@/pages/SpendingTrackerPage';
import HelpPage from '@/pages/HelpPage';
import AdminPage from '@/pages/AdminPage';
import { DashboardLayout } from '@/components/DashboardLayout';
import { AdminRoute, ProtectedRoute } from '@/components/ProtectedRoute';
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
          <Analytics />
          <SpeedInsights />
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

              {/* All Pro pages fully ported from vanilla */}
              <Route path="bank" element={<BankPage />} />
              <Route path="stokvel" element={<StokvelPage />} />
              <Route path="loadshedding" element={<LoadSheddingPage />} />

              {/* Business module */}
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="pnl" element={<PnLPage />} />
              <Route path="tax" element={<TaxPage />} />
              <Route path="partners" element={<SpendingTrackerPage />} />

              {/* Family module */}
              <Route path="members" element={<MembersPage />} />
              <Route path="allowances" element={<AllowancesPage />} />
              <Route path="chores" element={<ChoresPage />} />
              <Route path="family-goals" element={<FamilyGoalsPage />} />
              <Route path="spending-tracker" element={<SpendingTrackerPage />} />

              {/* Help + Admin */}
              <Route path="help" element={<HelpPage />} />
              <Route
                path="admin"
                element={
                  <AdminRoute>
                    <AdminPage />
                  </AdminRoute>
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

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { AdminRoute } from '@/components/ProtectedRoute';
import { AuthRoleGate } from '@/components/AuthRoleGate';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ModeProvider } from '@/contexts/ModeContext';

// Lazy-loaded page components — each becomes its own chunk
const AuthPage = lazy(() => import('@/pages/AuthPage'));
const OverviewPage = lazy(() => import('@/pages/OverviewPage'));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage'));
const SavingsPage = lazy(() => import('@/pages/SavingsPage'));
const AccountPage = lazy(() => import('@/pages/AccountPage'));
const CurrencyPage = lazy(() => import('@/pages/CurrencyPage'));
const AdvicePage = lazy(() => import('@/pages/AdvicePage'));
const BankPage = lazy(() => import('@/pages/BankPage'));
const StokvelPage = lazy(() => import('@/pages/StokvelPage'));
const LoadSheddingPage = lazy(() => import('@/pages/LoadSheddingPage'));
const InvoicesPage = lazy(() => import('@/pages/InvoicesPage'));
const ClientsPage = lazy(() => import('@/pages/ClientsPage'));
const PnLPage = lazy(() => import('@/pages/PnLPage'));
const TaxPage = lazy(() => import('@/pages/TaxPage'));
const MembersPage = lazy(() => import('@/pages/MembersPage'));
const AllowancesPage = lazy(() => import('@/pages/AllowancesPage'));
const ChoresPage = lazy(() => import('@/pages/ChoresPage'));
const FamilyGoalsPage = lazy(() => import('@/pages/FamilyGoalsPage'));
const SpendingTrackerPage = lazy(() => import('@/pages/SpendingTrackerPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const JuniorHomePage = lazy(() => import('@/pages/junior/JuniorHomePage'));
const JuniorLoginPage = lazy(() => import('@/pages/junior/JuniorLoginPage'));
const JuniorLayout = lazy(() =>
  import('@/components/junior/JuniorLayout').then((m) => ({ default: m.JuniorLayout }))
);

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
    <ErrorBoundary>
    <ThemeProvider>
      <ModeProvider>
        <AuthProvider>
          <Analytics />
          <SpeedInsights />
          <Suspense fallback={<LoadingOverlay />}>
          <Routes>
            <Route path="/" element={<AuthPage />} />

            <Route
              path="/dashboard"
              element={
                <AuthRoleGate role="parent">
                  <DashboardLayout />
                </AuthRoleGate>
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

            {/* Junior (kid-only) */}
            <Route path="/junior/login" element={<JuniorLoginPage />} />
            <Route
              path="/junior"
              element={
                <AuthRoleGate role="child">
                  <JuniorLayout />
                </AuthRoleGate>
              }
            >
              <Route path="home" element={<JuniorHomePage />} />
              <Route index element={<Navigate to="home" replace />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </ModeProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}

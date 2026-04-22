import { lazy, Suspense, type ComponentType } from 'react';
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

/**
 * Wrap dynamic imports so a chunk-not-found after a deploy doesn't brick
 * a stale tab. Vite produces hashed filenames (FamilyGoalsPage-abc123.js)
 * and Vercel purges the old hashes when a new deploy lands. Any tab that
 * had the OLD /index.html referenced still tries to import the now-404
 * old hash and throws "Failed to fetch dynamically imported module".
 * On that specific error, force a full reload — fresh /index.html
 * references the current chunks, so recovery is automatic.
 */
function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(() =>
    factory().catch((err: Error) => {
      const msg = err?.message ?? '';
      if (
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed')
      ) {
        // One-shot reload guard via session storage so we don't loop forever
        // if the chunk genuinely is gone.
        const key = 'budgetwise-chunk-retry';
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          window.location.reload();
          // Return a never-resolving promise so React doesn't render
          // before the reload takes over.
          return new Promise(() => {}) as Promise<{ default: T }>;
        }
      }
      throw err;
    }),
  );
}

// Lazy-loaded page components — each becomes its own chunk
const AuthPage = lazyWithRetry(() => import('@/pages/AuthPage'));
const OverviewPage = lazyWithRetry(() => import('@/pages/OverviewPage'));
const ExpensesPage = lazyWithRetry(() => import('@/pages/ExpensesPage'));
const SavingsPage = lazyWithRetry(() => import('@/pages/SavingsPage'));
const AccountPage = lazyWithRetry(() => import('@/pages/AccountPage'));
const CurrencyPage = lazyWithRetry(() => import('@/pages/CurrencyPage'));
const AdvicePage = lazyWithRetry(() => import('@/pages/AdvicePage'));
const BankPage = lazyWithRetry(() => import('@/pages/BankPage'));
const StokvelPage = lazyWithRetry(() => import('@/pages/StokvelPage'));
const LoadSheddingPage = lazyWithRetry(() => import('@/pages/LoadSheddingPage'));
const InvoicesPage = lazyWithRetry(() => import('@/pages/InvoicesPage'));
const ClientsPage = lazyWithRetry(() => import('@/pages/ClientsPage'));
const PnLPage = lazyWithRetry(() => import('@/pages/PnLPage'));
const TaxPage = lazyWithRetry(() => import('@/pages/TaxPage'));
const MembersPage = lazyWithRetry(() => import('@/pages/MembersPage'));
const AllowancesPage = lazyWithRetry(() => import('@/pages/AllowancesPage'));
const ChoresPage = lazyWithRetry(() => import('@/pages/ChoresPage'));
const FamilyGoalsPage = lazyWithRetry(() => import('@/pages/FamilyGoalsPage'));
const SpendingTrackerPage = lazyWithRetry(() => import('@/pages/SpendingTrackerPage'));
const JuniorDashboardPage = lazyWithRetry(() => import('@/pages/JuniorDashboardPage'));
const HelpPage = lazyWithRetry(() => import('@/pages/HelpPage'));
const AdminPage = lazyWithRetry(() => import('@/pages/AdminPage'));
const JuniorHomePage = lazyWithRetry(() => import('@/pages/junior/JuniorHomePage'));
const JuniorChoresPage = lazyWithRetry(() => import('@/pages/junior/JuniorChoresPage'));
const JuniorMissionsPage = lazyWithRetry(() => import('@/pages/junior/JuniorMissionsPage'));
const JuniorMissionPlayer = lazyWithRetry(() => import('@/pages/junior/JuniorMissionPlayer'));
const JuniorJarsPage = lazyWithRetry(() => import('@/pages/junior/JuniorJarsPage'));
const JuniorLoginPage = lazyWithRetry(() => import('@/pages/junior/JuniorLoginPage'));
const JuniorLayout = lazyWithRetry(() =>
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
              <Route path="junior" element={<JuniorDashboardPage />} />
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
              <Route path="chores" element={<JuniorChoresPage />} />
              <Route path="missions" element={<JuniorMissionsPage />} />
              <Route path="mission/:id" element={<JuniorMissionPlayer />} />
              <Route path="jars" element={<JuniorJarsPage />} />
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

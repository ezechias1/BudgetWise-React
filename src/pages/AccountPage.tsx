import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useExpenses } from '@/hooks/useExpenses';
import { useSavingsGoals } from '@/hooks/useSavingsGoals';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';
import { CURRENCIES } from '@/lib/currencies';

/**
 * Ports #page-account from dashboard.html lines 2275-2442.
 *
 * Scope for this round: profile, subscription badge (stub), account
 * details, quick stats, update monthly budget, change password, sign out.
 *
 * Deferred: avatar upload, backup/restore JSON, delete all data,
 * change email/name inline, tithe toggle, achievements grid, Upgrade flow.
 */
export default function AccountPage() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { expenses } = useExpenses();
  const { goals } = useSavingsGoals();
  const {
    currency,
    income,
    savingsGoal,
    updateSettings,
  } = useUserSettings();
  const navigate = useNavigate();

  const [currencyInput, setCurrencyInput] = useState(currency);
  const [incomeInput, setIncomeInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Seed the form once settings load
  useEffect(() => {
    setCurrencyInput(currency);
    setIncomeInput(income ? String(income) : '');
    setGoalInput(savingsGoal ? String(savingsGoal) : '');
  }, [currency, income, savingsGoal]);

  const handleLogout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const { error } = await updateSettings({
      currency: currencyInput,
      income: parseFloat(incomeInput) || 0,
      savings_goal: parseFloat(goalInput) || 0,
    });
    setSaving(false);
    setSaveMsg(
      error
        ? { text: `Save failed: ${error}`, ok: false }
        : { text: 'Saved', ok: true },
    );
    // Auto-clear the success message after a moment
    if (!error) setTimeout(() => setSaveMsg(null), 2500);
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) alert(`Error: ${error.message}`);
    else alert('Password reset link sent — check your email.');
  };

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? '—';
  const email = user?.email ?? '—';
  const provider =
    (user?.app_metadata?.provider as string | undefined) === 'google'
      ? 'Google'
      : 'Email & Password';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
      })
    : '—';

  const initials = fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const categoriesUsed = new Set(expenses.map((e) => e.category)).size;

  return (
    <section className="page active" id="page-account">
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p className="page-subtitle">Your profile and settings</p>
        </div>
      </div>

      <div className="account-profile-clean">
        <h2 className="account-name-top">{fullName}</h2>
        <div className="account-avatar-wrap">
          <div className="account-avatar">{initials}</div>
        </div>
      </div>

      {/* Subscription card (stub — Pro system wired in a later round) */}
      <div className="pro-card">
        <div className="pro-card-inner">
          <div className="pro-card-left">
            <div className="pro-plan-badge">FREE</div>
            <div className="pro-card-text">
              <h3>Upgrade to Pro</h3>
              <p>
                Unlock bank sync, Business &amp; Family modes, push alerts, and
                priority support.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-upgrade"
            onClick={() => alert('Upgrade flow — coming in a later round.')}
          >
            Upgrade Now
          </button>
        </div>
      </div>

      <div className="account-grid">
        {/* Account details */}
        <div className="chart-card full-width">
          <h3>Account Details</h3>
          <div className="account-details">
            <div className="account-row">
              <span className="account-label">Full Name</span>
              <span className="account-value">{fullName}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Email</span>
              <span className="account-value">{email}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Sign-in Method</span>
              <span className="account-value">{provider}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Member Since</span>
              <span className="account-value">{memberSince}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Currency</span>
              <span className="account-value">{currency}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Monthly Income</span>
              <span className="account-value">
                {formatCurrency(income, currency)}
              </span>
            </div>
            <div className="account-row">
              <span className="account-label">Savings Goal</span>
              <span className="account-value">
                {formatCurrency(savingsGoal, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Update budget inline form */}
        <div className="chart-card full-width">
          <h3>Update Budget &amp; Currency</h3>
          <form onSubmit={handleSave}>
            <div className="field">
              <label>Currency</label>
              <select
                value={currencyInput}
                onChange={(e) => setCurrencyInput(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Monthly Income</label>
              <input
                type="number"
                value={incomeInput}
                onChange={(e) => setIncomeInput(e.target.value)}
                placeholder="e.g. 25000"
                min="0"
                step="0.01"
              />
            </div>
            <div className="field">
              <label>Monthly Savings Goal</label>
              <input
                type="number"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="e.g. 5000"
                min="0"
                step="0.01"
              />
            </div>
            {saveMsg && (
              <p
                className="auth-error"
                style={{
                  color: saveMsg.ok ? '#10b981' : undefined,
                  marginBottom: 12,
                }}
              >
                {saveMsg.text}
              </p>
            )}
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Quick stats */}
        <div className="chart-card full-width">
          <h3>Quick Stats</h3>
          <div className="account-details">
            <div className="account-row">
              <span className="account-label">Total Expenses Logged</span>
              <span className="account-value">{expenses.length}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Categories Used</span>
              <span className="account-value">{categoriesUsed}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Savings Goals</span>
              <span className="account-value">{goals.length}</span>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="chart-card full-width">
          <h3>Appearance</h3>
          <div className="account-details">
            <div className="account-row">
              <span className="account-label">Theme</span>
              <span className="account-value">
                {theme === 'dark' ? 'Dark' : 'Light'}
                <button
                  type="button"
                  className="btn-change-inline"
                  onClick={toggleTheme}
                  style={{ marginLeft: 8 }}
                >
                  Toggle
                </button>
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="chart-card full-width">
          <h3>Actions</h3>
          <div className="account-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleChangePassword}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Change Password
            </button>
            <button type="button" className="btn-primary" onClick={handleLogout}>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

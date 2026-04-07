import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useParticleBackground } from '@/hooks/useParticleBackground';
import { PasswordInput } from '@/components/PasswordInput';
import type { Mode } from '@/types';

type Tab = 'login' | 'signup' | 'forgot';

// Auto-detect country from timezone — ported from `auth.js` lines 89-103.
const TZ_TO_COUNTRY: Record<string, string> = {
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Accra': 'GH',
  'Africa/Gaborone': 'BW',
  'Africa/Maputo': 'MZ',
  'Africa/Cairo': 'EG',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'Europe/London': 'GB',
  'Australia/Sydney': 'AU',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Asia/Kolkata': 'IN',
  'America/Sao_Paulo': 'BR',
};

const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'GH', name: 'Ghana' },
  { code: 'BW', name: 'Botswana' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'EG', name: 'Egypt' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'OTHER', name: 'Other' },
];

const TYPE_DESC: Record<Mode, string> = {
  personal: 'Track your personal spending, savings, and goals.',
  business: 'Manage business finances — invoices, clients, profit & loss.',
  family: 'Budget together — shared expenses, goals, and chore rewards.',
};

export default function AuthPage() {
  const { user, loading, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useParticleBackground();

  const [tab, setTab] = useState<Tab>('login');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Signup form state
  const [signupType, setSignupType] = useState<Mode>('personal');
  const [signupName, setSignupName] = useState('');
  const [signupCompany, setSignupCompany] = useState('');
  const [signupFamilyName, setSignupFamilyName] = useState('');
  const [signupCountry, setSignupCountry] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupErrorColor, setSignupErrorColor] = useState('');

  // Forgot form state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // Auto-populate country from timezone on mount (matches vanilla behavior)
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const detected = TZ_TO_COUNTRY[tz];
      if (detected) setSignupCountry(detected);
    } catch {
      /* ignore */
    }
  }, []);

  const typeDesc = useMemo(() => TYPE_DESC[signupType], [signupType]);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setSubmitting(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setSubmitting(false);
    if (error) {
      setLoginError(error);
      return;
    }
    navigate('/dashboard');
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setSignupError('');
    setSignupErrorColor('');
    setSubmitting(true);
    const { error } = await signUp(signupEmail, signupPassword, {
      full_name: signupName,
      company_name: signupCompany || null,
      family_name: signupFamilyName || null,
      country: signupCountry,
      account_type: signupType,
    });
    setSubmitting(false);
    if (error) {
      setSignupError(error);
      return;
    }
    // Matches vanilla flow: show a success message in the error slot (green)
    setSignupError('Check your email to confirm your account.');
    setSignupErrorColor('#10b981');
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setSubmitting(true);
    const { error } = await resetPassword(forgotEmail);
    setSubmitting(false);
    setForgotError(error ?? 'Password reset link sent — check your email.');
  };

  const handleGoogle = async () => {
    setSubmitting(true);
    const { error } = await signInWithGoogle();
    setSubmitting(false);
    if (error) setLoginError(error);
  };

  return (
    <>
      <canvas id="bgCanvas" ref={canvasRef} />

      <div className="auth-container">
        <div className="auth-left">
          <div className="brand">
            <div className="brand-icon">
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                fill="none"
                stroke="white"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="16" width="3" height="5" rx="0.5" fill="white" opacity="0.5" />
                <rect x="7" y="12" width="3" height="9" rx="0.5" fill="white" opacity="0.65" />
                <rect x="12" y="8" width="3" height="13" rx="0.5" fill="white" opacity="0.8" />
                <rect x="17" y="4" width="3" height="17" rx="0.5" fill="white" opacity="0.95" />
                <path d="M3 14L19 3" stroke="white" strokeWidth="1.8" />
                <path d="M16 2.5L20 3L18.5 6.5" fill="white" stroke="none" />
              </svg>
            </div>
            <h1>BudgetWise</h1>
          </div>
          <h2>
            Take control of
            <br />
            your <span className="gradient-text">finances</span>
          </h2>
          <p className="hero-sub">
            Track expenses, set savings goals, and get smart advice on how to manage your
            money better.
          </p>
          <div className="features-list">
            {[
              'Visual spending breakdowns',
              'Smart savings recommendations',
              'Multi-currency support',
              'Real-time exchange rates',
            ].map((text) => (
              <div className="feature-item" key={text}>
                <div className="feature-dot" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-right">
          <div className="auth-card">
            <div className="auth-tabs">
              <button
                type="button"
                className={`tab-btn ${tab === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setTab('login');
                  setLoginError('');
                  setSignupError('');
                  setForgotError('');
                }}
              >
                Log In
              </button>
              <button
                type="button"
                className={`tab-btn ${tab === 'signup' ? 'active' : ''}`}
                onClick={() => {
                  setTab('signup');
                  setLoginError('');
                  setSignupError('');
                  setForgotError('');
                }}
              >
                Sign Up
              </button>
            </div>

            {tab === 'login' && (
              <form className="auth-form" onSubmit={handleLogin}>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <PasswordInput
                    id="loginPassword"
                    value={loginPassword}
                    onChange={setLoginPassword}
                    placeholder="Enter password"
                    required
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Logging in…' : 'Log In'}
                </button>
                {loginError && <p className="auth-error">{loginError}</p>}
                <p className="forgot-link">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setTab('forgot');
                    }}
                  >
                    Forgot your password?
                  </a>
                </p>
              </form>
            )}

            {tab === 'forgot' && (
              <form className="auth-form" onSubmit={handleForgot}>
                <p className="forgot-desc">
                  Enter your email and we'll send you a link to reset your password.
                </p>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send Reset Link'}
                </button>
                {forgotError && <p className="auth-error">{forgotError}</p>}
                <p className="forgot-link">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setTab('login');
                    }}
                  >
                    Back to Log In
                  </a>
                </p>
              </form>
            )}

            {tab === 'signup' && (
              <form className="auth-form" onSubmit={handleSignup}>
                <div className="field">
                  <label>Account Type</label>
                  <div className="account-type-toggle">
                    {(['personal', 'business', 'family'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`type-btn ${signupType === t ? 'active' : ''}`}
                        onClick={() => setSignupType(t)}
                      >
                        {t === 'personal' && 'Personal'}
                        {t === 'business' && (
                          <>
                            Business <span className="pro-tag">PRO</span>
                          </>
                        )}
                        {t === 'family' && (
                          <>
                            Family <span className="pro-tag">PRO</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="type-desc">{typeDesc}</p>
                </div>

                <div className="field">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    required
                    placeholder="Your name"
                  />
                </div>

                {signupType === 'business' && (
                  <div className="field">
                    <label>Company Name</label>
                    <input
                      type="text"
                      value={signupCompany}
                      onChange={(e) => setSignupCompany(e.target.value)}
                      placeholder="Your company name"
                    />
                  </div>
                )}

                {signupType === 'family' && (
                  <div className="field">
                    <label>Family Name</label>
                    <input
                      type="text"
                      value={signupFamilyName}
                      onChange={(e) => setSignupFamilyName(e.target.value)}
                      placeholder="e.g. The Smiths"
                    />
                  </div>
                )}

                <div className="field">
                  <label>Country</label>
                  <select
                    className="auth-select"
                    value={signupCountry}
                    onChange={(e) => setSignupCountry(e.target.value)}
                  >
                    <option value="">Select your country</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </div>

                <div className="field">
                  <label>Password</label>
                  <PasswordInput
                    id="signupPassword"
                    value={signupPassword}
                    onChange={setSignupPassword}
                    placeholder="Min 6 characters"
                    required
                    minLength={6}
                  />
                </div>

                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create Account'}
                </button>
                {signupError && (
                  <p className="auth-error" style={signupErrorColor ? { color: signupErrorColor } : undefined}>
                    {signupError}
                  </p>
                )}
              </form>
            )}

            <div className="divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="btn-google"
              onClick={handleGoogle}
              disabled={submitting}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
        </div>
      </div>

      <footer
        style={{
          textAlign: 'center',
          padding: '20px 0 10px',
          fontSize: 12,
          color: '#6b7280',
        }}
      >
        <a href="/privacy" style={{ color: '#10b981', textDecoration: 'none', margin: '0 8px' }}>
          Privacy Policy
        </a>
        <a href="/terms" style={{ color: '#10b981', textDecoration: 'none', margin: '0 8px' }}>
          Terms of Service
        </a>
      </footer>
    </>
  );
}

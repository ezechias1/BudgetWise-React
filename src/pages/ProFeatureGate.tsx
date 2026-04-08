import { useUserSettings } from '@/hooks/useUserSettings';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ENABLE_PRO_SYSTEM, isProUser } from '@/lib/access';

interface Props {
  title: string;
  description: string;
}

/**
 * Placeholder shown for pages that exist on the live vanilla site but
 * haven't been ported to the React version yet.
 *
 * When the user is Pro (which is everyone while ENABLE_PRO_SYSTEM === false),
 * this page shows a neutral "coming soon" message — no upgrade prompts.
 * When the Pro system is enabled and the user is on the free plan, it shows
 * the legacy upgrade CTA.
 */
export default function ProFeatureGate({ title, description }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isProFromSettings } = useUserSettings();
  const isPro = isProUser(isProFromSettings, user);

  const showUpgrade = ENABLE_PRO_SYSTEM && !isPro;

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-subtitle">
            {showUpgrade ? description : 'Coming soon'}
          </p>
        </div>
      </div>

      <div
        style={{
          padding: '48px 24px',
          maxWidth: 600,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 72,
            height: 72,
            borderRadius: 18,
            background: showUpgrade
              ? 'linear-gradient(135deg, #f59e0b, #f97316)'
              : 'rgba(var(--accent-rgb), 0.12)',
            marginBottom: 20,
            color: showUpgrade ? '#fff' : 'var(--accent)',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="32"
            height="32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>

        <p
          style={{
            color: 'rgba(255,255,255,0.7)',
            lineHeight: 1.6,
            marginBottom: 24,
            fontSize: '0.95rem',
          }}
        >
          {showUpgrade
            ? description
            : `${title} is being rebuilt in this React version of BudgetWise. It's fully working on the live site — check back here once it's ported.`}
        </p>

        {showUpgrade ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate('/dashboard/account')}
          >
            Upgrade to Pro
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate('/dashboard')}
          >
            Back to Overview
          </button>
        )}
      </div>
    </section>
  );
}

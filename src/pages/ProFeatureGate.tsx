import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  description: string;
}

/**
 * Shown in place of Pro-gated pages (Business clients/invoices,
 * Family chores/goals, Stokvel, etc.) until those are ported in
 * dedicated rounds. Explains the feature and links to the Upgrade
 * flow on the Account page.
 */
export default function ProFeatureGate({ title, description }: Props) {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '48px 24px', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 72,
          height: 72,
          borderRadius: 18,
          background: 'linear-gradient(135deg, #f59e0b, #f97316)',
          marginBottom: 20,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="32"
          height="32"
          fill="none"
          stroke="white"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <h1 style={{ fontSize: '1.75rem', marginBottom: 10 }}>
        {title} <span style={{ fontSize: '0.7em', color: '#f59e0b' }}>PRO</span>
      </h1>
      <p
        style={{
          color: 'rgba(255,255,255,0.6)',
          lineHeight: 1.6,
          marginBottom: 24,
          fontSize: '0.95rem',
        }}
      >
        {description}
      </p>
      <button
        type="button"
        className="btn-primary"
        onClick={() => navigate('/dashboard/account')}
      >
        Upgrade to Pro
      </button>
    </div>
  );
}

import type { Mode } from '@/types';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Props {
  onPick: (mode: Mode) => void;
}

/**
 * Post-login account picker — shown to Pro users so they explicitly choose
 * which workspace to enter. Also fixes the "Personal style + Family data"
 * split-brain on first render by forcing a clean mode selection before the
 * dashboard mounts data hooks.
 *
 * Deliberately NOT dismissible: no close button, no overlay-click, no Escape.
 * Picking a mode is the only way out, and DashboardLayout holds the page
 * back until that happens — so a dismissal would leave the user on a blank
 * dashboard. Free (non-Pro) users never see this at all; they go straight
 * into Personal, since the other two workspaces aren't theirs to open.
 */
const OPTIONS: Array<{
  mode: Mode;
  label: string;
  description: string;
  accent: string;
  accentSoft: string;
  icon: JSX.Element;
}> = [
  {
    mode: 'personal',
    label: 'Personal',
    description: 'Your day-to-day budget, spending, and savings.',
    accent: '#10b981',
    accentSoft: 'rgba(16,185,129,0.12)',
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    mode: 'business',
    label: 'Business',
    description: 'Revenue, expenses, clients and invoices.',
    accent: '#3b82f6',
    accentSoft: 'rgba(59,130,246,0.12)',
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    mode: 'family',
    label: 'Family',
    description: 'Shared budget, kids, chores and Junior.',
    accent: '#8b5cf6',
    accentSoft: 'rgba(139,92,246,0.12)',
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M7 21v-2a4 4 0 0 1 3-3.87" />
        <circle cx="9" cy="7" r="4" />
        <path d="M17 11a4 4 0 1 0-3-6.87" />
      </svg>
    ),
  },
];

export function AccountPickerModal({ onPick }: Props) {
  const dialog = useDialogA11y();
  return (
    <div
      className="modal-overlay"
      {...dialog}
      style={{ zIndex: 200 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-picker-title"
    >
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 id="account-picker-title">Welcome back</h2>
        </div>
        <p style={{ marginTop: 0, opacity: 0.75 }}>
          Which account do you want to open?
        </p>

        <div
          style={{
            display: 'grid',
            gap: 12,
            marginTop: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          }}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              onClick={() => onPick(opt.mode)}
              className="account-picker-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 10,
                padding: 18,
                border: `1px solid ${opt.accentSoft}`,
                borderRadius: 14,
                background: opt.accentSoft,
                color: opt.accent,
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
                transition: 'transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease',
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: opt.accent,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {opt.icon}
              </span>
              <strong style={{ fontSize: '1.05rem', color: opt.accent }}>
                {opt.label}
              </strong>
              <span className="account-picker-desc">
                {opt.description}
              </span>
            </button>
          ))}
        </div>

        <p className="account-picker-hint">
          You can switch anytime from the mode dropdown in the sidebar.
        </p>
      </div>
    </div>
  );
}

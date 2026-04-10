import { useState } from 'react';
import type { CrossModeAccount } from '@/hooks/useLinkedAccounts';

interface Props {
  crossModeAccounts: CrossModeAccount[];
  currentMode: string;
}

/**
 * Banner shown on Overview when the user has the same bank account
 * linked across multiple modes (e.g. Personal + Business).
 * Reminds them to route deposits to the correct mode.
 */
export function CrossModeDepositBanner({ crossModeAccounts, currentMode }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (crossModeAccounts.length === 0) return null;

  const visible = crossModeAccounts.filter(
    (c) => !dismissed.has(`${c.institution_name}|${c.mask}`),
  );
  if (visible.length === 0) return null;

  const modeLabel = (m: string) =>
    m === 'business' ? 'Business' : m === 'family' ? 'Family' : 'Personal';

  return (
    <>
      {visible.map((c) => {
        const key = `${c.institution_name}|${c.mask}`;
        const otherModes = c.modes
          .filter((m) => m !== currentMode)
          .map(modeLabel);
        return (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              marginBottom: 10,
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.18)',
              borderRadius: 10,
              fontSize: '0.82rem',
            }}
          >
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🔀</span>
            <p style={{ flex: 1, margin: 0, color: 'inherit', lineHeight: 1.4 }}>
              <strong>{c.institution_name} ****{c.mask}</strong> is linked to
              both {modeLabel(currentMode)} and {otherModes.join(' & ')}.
              When money comes in, make sure to log it under the right mode.
            </p>
            <button
              onClick={() =>
                setDismissed((prev) => new Set(prev).add(key))
              }
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                opacity: 0.4,
                cursor: 'pointer',
                fontSize: '1.1rem',
                padding: 0,
                flexShrink: 0,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </>
  );
}

import { useKidProfile } from '@/hooks/useKidProfile';
import { ageFromDob, daysUntilBirthday } from '@/lib/junior-age';

/**
 * Shown in the Junior shell when a kid is within 30 days of turning 18.
 * Hides otherwise. When the kid has actually turned 18, Junior should
 * stop being usable — <GraduationBlock /> handles that case.
 */
export function GraduationBanner() {
  const { member } = useKidProfile();
  const age = ageFromDob(member?.date_of_birth ?? null);
  const days = daysUntilBirthday(member?.date_of_birth ?? null);

  // Only show in the 30-day window before turning 18. Under-17s and
  // already-18-plus kids don't see this banner.
  if (age === null || days === null) return null;
  if (age < 17) return null;
  if (age >= 18) return null; // GraduationBlock takes over
  if (days > 30) return null;

  return (
    <div
      role="status"
      style={{
        background: 'linear-gradient(135deg, #10b981, #3b82f6)',
        color: 'white',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
      </svg>
      <div style={{ lineHeight: 1.4 }}>
        <strong>
          {days === 0 ? 'Happy birthday!' : `${days} day${days === 1 ? '' : 's'} to 18`}
        </strong>
        <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
          You&apos;re about to graduate to your own BudgetWise account. Your savings, jar
          balances and streak come with you. Your parent will help you finish the switch.
        </div>
      </div>
    </div>
  );
}

/**
 * Renders instead of normal Junior content when the kid has turned 18.
 * Junior pages should render this as a replacement (not on top of) the page
 * contents so a grad can't keep earning chore rewards on a kid account.
 */
export function GraduationBlock() {
  const { member } = useKidProfile();
  const age = ageFromDob(member?.date_of_birth ?? null);
  if (age === null || age < 18) return null;

  return (
    <section
      className="junior-hero"
      style={{
        background: 'linear-gradient(135deg, #10b981, #3b82f6)',
        padding: '32px 24px',
      }}
    >
      <h1 style={{ margin: '0 0 8px' }}>You&apos;re 18 — time to graduate</h1>
      <p style={{ margin: 0, fontSize: '1rem', opacity: 0.95 }}>
        BudgetWise Junior is for kids 7–17. Ask your parent to start the graduation flow
        from the Members page — your savings, jar balances and streak will carry over to
        your own BudgetWise account.
      </p>
    </section>
  );
}

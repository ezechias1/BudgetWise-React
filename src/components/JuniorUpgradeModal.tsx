/**
 * Shown when a Junior freemium gate trips (see src/lib/access.ts —
 * checkJuniorGate). Explains which limit was hit and links to the existing
 * PayPal upgrade URL.
 *
 * Today ENABLE_PRO_SYSTEM is false so this modal never appears for real
 * users; it's wired in so the gates are ready when the flag flips.
 */

interface Props {
  reason: 'kids' | 'chores' | 'missions';
  current: number;
  limit: number;
  onClose: () => void;
}

export function JuniorUpgradeModal({ reason, current, limit, onClose }: Props) {
  const copy = {
    kids: `You've reached the free limit of ${limit} child. Upgrade to Pro to add more kids.`,
    chores: `This kid already has ${current} of ${limit} free chores. Upgrade to Pro to add unlimited chores.`,
    missions: `You've completed ${current} of ${limit} free missions. Upgrade to Pro to unlock all missions.`,
  }[reason];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upgrade to Pro</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p>{copy}</p>
        <p style={{ marginTop: 16 }}>
          Pro is <strong>$4.99</strong> (30 days) and unlocks:
        </p>
        <ul>
          <li>Unlimited Junior kids</li>
          <li>Unlimited chores per kid</li>
          <li>All 12 money-lesson missions</li>
          <li>Parent notifications (approval nudge + Sunday settle-up)</li>
          <li>Full Business + Family modes</li>
        </ul>
        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose}>Maybe later</button>
          <a
            href="https://www.paypal.com/ncp/payment/QP56M59WZBK3Q"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{ padding: '10px 20px', borderRadius: 10, textDecoration: 'none', display: 'inline-block' }}
          >
            Upgrade now
          </a>
        </div>
      </div>
    </div>
  );
}

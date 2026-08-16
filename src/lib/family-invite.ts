/**
 * Family invite links.
 *
 * Joining used to take seven steps: sign up, wait for a confirmation email,
 * click the link, log in, switch to Family mode, find Spending Tracker, type
 * the code — then wait for approval. Most of that is the app's filing system
 * leaking into the user's job.
 *
 * An invite link carries the code through all of it. The invitee taps the
 * link, signs up (already set to Family), confirms their email, and lands
 * joined. The only step they perform is signing up, which they'd have to do
 * anyway since every member keeps their own account.
 *
 * The code has to survive an email round-trip on a phone, which may open the
 * confirmation in a different tab — hence localStorage rather than component
 * state or a URL that won't come back.
 */

const PENDING_KEY = 'bw-pending-family-invite';
export const INVITE_PARAM = 'join';

/** Shareable link that carries the invite code. */
export function buildInviteLink(code: string): string {
  return `${window.location.origin}/?${INVITE_PARAM}=${encodeURIComponent(code.trim().toUpperCase())}`;
}

/** Invite code from the current URL, if this page was opened from a link. */
export function readInviteFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(INVITE_PARAM);
    return raw ? raw.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Remember the code across signup and email confirmation.
 * Survives the round trip; cleared once the join has been attempted.
 */
export function stashInvite(code: string) {
  try {
    localStorage.setItem(PENDING_KEY, code.trim().toUpperCase());
  } catch {
    // Private browsing — the invitee falls back to typing the code manually.
  }
}

export function readStashedInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearStashedInvite() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Share the invite the way people actually pass these along — a phone's share
 * sheet into WhatsApp, not a copied string. Falls back to the clipboard on
 * desktop, where the Web Share API mostly doesn't exist.
 *
 * Returns how it was delivered so the caller can show the right confirmation;
 * 'cancelled' means the user dismissed the share sheet, which is not an error
 * and should not be reported as one.
 */
export async function shareInvite(
  code: string,
  familyName?: string | null,
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const url = buildInviteLink(code);
  const who = familyName?.trim() ? familyName.trim() : 'our family';
  const text = `Join ${who} on BudgetWise so we can budget together. Tap this link and sign up — the code is already in it.`;

  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      await navigator.share({ title: 'Join us on BudgetWise', text, url });
      return 'shared';
    } catch (err) {
      // AbortError is the user closing the sheet — not a failure.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

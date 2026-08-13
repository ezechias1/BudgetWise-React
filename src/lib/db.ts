/**
 * Guards for Supabase writes.
 *
 * The audit found 49 write operations that discarded their error, so a failed
 * insert or delete reported success to the user. That is what left family
 * linking silently broken in production: the row was never created, and the
 * UI said it worked.
 *
 * Every write should go through one of these, or check its own error and say
 * something useful.
 */

interface WriteResult {
  error: { message: string } | null;
}

/**
 * Await a write and surface any failure to the user.
 *
 * Returns true on success so call sites can bail out:
 *
 *   if (!(await ok(supabase.from('invoices').delete().eq('id', id), 'delete this invoice'))) return;
 *
 * `action` completes the sentence "Could not …", so phrase it as a verb
 * phrase in the user's language — "delete this invoice", not "DELETE FROM
 * invoices".
 */
export async function ok(
  write: PromiseLike<WriteResult>,
  action: string,
): Promise<boolean> {
  const { error } = await write;
  if (error) {
    reportWriteFailure(action, error.message);
    return false;
  }
  return true;
}

/**
 * For writes where the caller handles control flow itself but still wants the
 * failure surfaced rather than swallowed.
 */
export async function warnOnFailure(
  write: PromiseLike<WriteResult>,
  action: string,
): Promise<boolean> {
  return ok(write, action);
}

/**
 * Single place the user-facing message is produced, so it can become a toast
 * later without touching 49 call sites. Deliberately not silent: a write that
 * fails without telling anyone is the bug this module exists to prevent.
 */
export function reportWriteFailure(action: string, detail?: string) {
  const message = detail
    ? `Could not ${action}: ${detail}`
    : `Could not ${action}. Please try again.`;
  console.error('[write failed]', action, detail);
  alert(message);
}

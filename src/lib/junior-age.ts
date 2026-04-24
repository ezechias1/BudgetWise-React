/**
 * Junior age-bracket helpers.
 *
 * Age is derived from `family_members.date_of_birth` at query time rather
 * than stored, so a kid naturally moves into the next bracket on their
 * birthday without any cron job.
 *
 * Brackets (see Phase 6 plan D1):
 *   7–9   → Money is a tool
 *   10–12 → Earning and choosing
 *   13–15 → Budgeting basics
 *   16–17 → Adult lite
 */

export type AgeBracket = '7-9' | '10-12' | '13-15' | '16-17';

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function bracketFor(age: number): AgeBracket {
  if (age <= 9) return '7-9';
  if (age <= 12) return '10-12';
  if (age <= 15) return '13-15';
  return '16-17';
}

export function daysUntilBirthday(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < now) next.setFullYear(next.getFullYear() + 1);
  const ms = next.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

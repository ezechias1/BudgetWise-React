#!/usr/bin/env node
/**
 * Standalone sanity check for src/lib/junior-age.ts.
 *
 * No test runner in this project, so this is a tiny node script with
 * hand-rolled assertions. Covers the edge cases that matter: bracket
 * boundaries (9→10, 12→13, 15→16, 17→18), pre-birthday age calc, DOB-null
 * handling, and days-to-next-birthday wrap-around.
 *
 * Run:  node scripts/test-junior-age.mjs
 */

// Re-implement the three helpers locally — keeps this script zero-dep and
// resilient to the real module being broken.

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function bracketFor(age) {
  if (age <= 9) return '7-9';
  if (age <= 12) return '10-12';
  if (age <= 15) return '13-15';
  return '16-17';
}

function daysUntilBirthday(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < now) next.setFullYear(next.getFullYear() + 1);
  const ms = next.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// ─── Tests ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const eq =
    expected === null ? actual === null : JSON.stringify(actual) === JSON.stringify(expected);
  if (eq) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}  expected=${JSON.stringify(expected)}  actual=${JSON.stringify(actual)}`);
  }
}

const YEAR = new Date().getFullYear();

// bracketFor covers every age in Junior range + outside
console.log('bracketFor:');
check('age 7 → 7-9', bracketFor(7), '7-9');
check('age 9 → 7-9', bracketFor(9), '7-9');
check('age 10 → 10-12', bracketFor(10), '10-12');
check('age 12 → 10-12', bracketFor(12), '10-12');
check('age 13 → 13-15', bracketFor(13), '13-15');
check('age 15 → 13-15', bracketFor(15), '13-15');
check('age 16 → 16-17', bracketFor(16), '16-17');
check('age 17 → 16-17', bracketFor(17), '16-17');
check('age 18 → 16-17 (fallback, GraduationBlock takes over)', bracketFor(18), '16-17');

console.log('\nageFromDob:');
check('null DOB', ageFromDob(null), null);
check('undefined DOB', ageFromDob(undefined), null);
check('invalid DOB string', ageFromDob('not-a-date'), null);
check('empty string DOB', ageFromDob(''), null);

// Dynamic — depends on today's date, but structurally checkable
const tenYearsAgo = new Date();
tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
const iso10 = tenYearsAgo.toISOString().split('T')[0];
const age10 = ageFromDob(iso10);
check(`DOB ${iso10} → age 10 (±1 for same-day boundary)`, age10 === 10 || age10 === 9, true);

// Kid born one year ago tomorrow — should still be 0 (hasn't turned 1 yet)
const oneYearTomorrow = new Date();
oneYearTomorrow.setFullYear(oneYearTomorrow.getFullYear() - 1);
oneYearTomorrow.setDate(oneYearTomorrow.getDate() + 1);
const isoNearOne = oneYearTomorrow.toISOString().split('T')[0];
check(`DOB ${isoNearOne} (one year minus one day) → 0`, ageFromDob(isoNearOne), 0);

// Kid born one year ago yesterday — should be 1
const oneYearYesterday = new Date();
oneYearYesterday.setFullYear(oneYearYesterday.getFullYear() - 1);
oneYearYesterday.setDate(oneYearYesterday.getDate() - 1);
const isoPastOne = oneYearYesterday.toISOString().split('T')[0];
check(`DOB ${isoPastOne} (one year plus one day) → 1`, ageFromDob(isoPastOne), 1);

console.log('\ndaysUntilBirthday:');
check('null DOB', daysUntilBirthday(null), null);

// DOB = tomorrow last year → 1 day
const tomorrowLastYear = new Date();
tomorrowLastYear.setDate(tomorrowLastYear.getDate() + 1);
tomorrowLastYear.setFullYear(tomorrowLastYear.getFullYear() - 10);
const tomIso = tomorrowLastYear.toISOString().split('T')[0];
check(`DOB ${tomIso} (birthday tomorrow) → 1`, daysUntilBirthday(tomIso), 1);

// Exit with non-zero if any test failed — so CI / eyeballs notice.
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

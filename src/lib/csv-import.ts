// =============================================================================
// CSV bank statement import — parsing, column auto-detection, and category
// guessing. Zero dependencies (intentionally no papaparse).
//
// Used by BankPage.tsx to let South African users upload a bank statement CSV
// while we wait on Stitch Connect API approval.
// =============================================================================

import { getCategoriesForMode, type CategoryOption } from '@/lib/categories';
import type { Mode } from '@/types';

// ---------- Types -----------------------------------------------------------

export interface ParsedTransaction {
  /** ISO YYYY-MM-DD date string. */
  date: string;
  description: string;
  /** Positive number — magnitude of the expense in the user's currency. */
  amount: number;
  /** Auto-guessed category value. Always belongs to the mode's category list. */
  category: string;
}

export interface CsvImportResult {
  transactions: ParsedTransaction[];
  /** Number of rows skipped (empty / zero amount / credit-only / malformed). */
  skippedCount: number;
  /** Columns that were auto-detected in the header row (for debugging/UI). */
  detectedColumns: {
    date: string | null;
    description: string | null;
    amount: string | null;
    debit: string | null;
    credit: string | null;
  };
}

// ---------- CSV parser ------------------------------------------------------

/**
 * Parse a CSV string into a 2-D array of cells. Handles:
 *   - Quoted fields: "hello, world"
 *   - Escaped quotes inside quoted fields: "she said ""hi"""
 *   - \r\n, \n, or \r line endings
 *   - Trailing whitespace on lines
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // Swallow \r; handle the row on the following \n (or now if lone \r).
      if (text[i + 1] === '\n') {
        i++;
        continue;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush final field / row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop entirely-empty rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- Column detection -----------------------------------------------

const DATE_HEADERS = [
  'date',
  'transaction date',
  'posting date',
  'effective date',
  'trans date',
  'value date',
];
const DESCRIPTION_HEADERS = [
  'description',
  'details',
  'memo',
  'narrative',
  'reference',
  'transaction',
];
const AMOUNT_HEADERS = ['amount', 'value'];
const DEBIT_HEADERS = ['debit', 'debits', 'money out', 'withdrawal'];
const CREDIT_HEADERS = ['credit', 'credits', 'money in', 'deposit'];

function findColumn(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return idx;
  }
  // Fallback: loose includes match.
  for (let i = 0; i < lower.length; i++) {
    if (candidates.some((c) => lower[i].includes(c))) return i;
  }
  return -1;
}

// ---------- Date normalization ----------------------------------------------

/**
 * Convert many common bank date formats into ISO YYYY-MM-DD. Returns null if
 * the input cannot be parsed confidently.
 */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Already ISO (YYYY-MM-DD or YYYY/MM/DD)
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY (SA banks default)
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const [, d, m, yRaw] = dmy;
    const y = yRaw.length === 2 ? '20' + yRaw : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Fallback: JS Date parser (handles "12 Jan 2026" etc.)
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

// ---------- Amount normalization --------------------------------------------

/**
 * Parse a currency string like "R 1,234.56", "-1234.56", "(1,234.56)" into a
 * number. Returns NaN on failure.
 */
export function normalizeAmount(raw: string): number {
  if (!raw) return NaN;
  let s = raw.trim();
  if (!s) return NaN;
  // Parentheses = negative.
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip currency symbols / letters / spaces.
  s = s.replace(/[^\d.,\-]/g, '');
  // Remove thousand separators (commas) — assume point is the decimal.
  s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

// ---------- Category guessing -----------------------------------------------

const CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'Food',
    keywords: [
      'woolworths',
      'pick n pay',
      'picknpay',
      'shoprite',
      'checkers',
      'spar',
      'food lovers',
      'uber eats',
      'mr d',
      'mrd food',
    ],
  },
  {
    category: 'Transport',
    keywords: [
      'uber',
      'bolt',
      'petrol',
      'total',
      'shell',
      'bp ',
      'engen',
      'caltex',
      'garage',
      'fuel',
    ],
  },
  {
    category: 'Subscriptions',
    keywords: ['netflix', 'spotify', 'showmax', 'dstv', 'apple.com/bill', 'google play'],
  },
  {
    category: 'Utilities',
    keywords: [
      'eskom',
      'city of cape town',
      'city of joburg',
      'city of tshwane',
      'telkom',
      'vodacom',
      'mtn',
      'cell c',
      'rain',
      'airtime',
      'prepaid electricity',
    ],
  },
  {
    category: 'Health',
    keywords: ['pharmacy', 'clicks', 'dischem', 'dis-chem', 'doctor', 'hospital', 'medi'],
  },
];

/**
 * Best-effort category guess from the description. Falls back to "Other" (or
 * the first available category if "Other" doesn't exist in the mode).
 */
export function guessCategory(description: string, mode: Mode): string {
  const categories = getCategoriesForMode(mode);
  const allowed = new Set(categories.map((c) => c.value));
  const desc = description.toLowerCase();

  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (!allowed.has(category)) continue;
    if (keywords.some((kw) => desc.includes(kw))) return category;
  }

  if (allowed.has('Other')) return 'Other';
  if (allowed.has('Miscellaneous')) return 'Miscellaneous';
  return categories[0]?.value ?? 'Other';
}

// ---------- Main import entry point -----------------------------------------

/**
 * Parse a CSV bank statement file into expense rows ready to insert into
 * the `expenses` table. Only expenses (debits) are included; credits/income
 * are skipped so bank statement imports can't accidentally create
 * fake "income" expenses.
 */
export function parseBankStatementCsv(
  text: string,
  mode: Mode,
): CsvImportResult {
  const rows = parseCsv(text);
  const empty: CsvImportResult = {
    transactions: [],
    skippedCount: 0,
    detectedColumns: {
      date: null,
      description: null,
      amount: null,
      debit: null,
      credit: null,
    },
  };
  if (rows.length < 2) return empty;

  const header = rows[0];
  const dateIdx = findColumn(header, DATE_HEADERS);
  const descIdx = findColumn(header, DESCRIPTION_HEADERS);
  const amountIdx = findColumn(header, AMOUNT_HEADERS);
  const debitIdx = findColumn(header, DEBIT_HEADERS);
  const creditIdx = findColumn(header, CREDIT_HEADERS);

  const detectedColumns = {
    date: dateIdx !== -1 ? header[dateIdx] : null,
    description: descIdx !== -1 ? header[descIdx] : null,
    amount: amountIdx !== -1 ? header[amountIdx] : null,
    debit: debitIdx !== -1 ? header[debitIdx] : null,
    credit: creditIdx !== -1 ? header[creditIdx] : null,
  };

  // If we can't find a date or description column, bail out cleanly.
  if (dateIdx === -1 || descIdx === -1) {
    return { ...empty, detectedColumns };
  }
  // If we have neither amount nor debit, we can't extract money.
  if (amountIdx === -1 && debitIdx === -1) {
    return { ...empty, detectedColumns };
  }

  const transactions: ParsedTransaction[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => !c || !c.trim())) {
      skipped++;
      continue;
    }

    const dateRaw = row[dateIdx] ?? '';
    const descRaw = row[descIdx] ?? '';
    const date = normalizeDate(dateRaw);
    if (!date) {
      skipped++;
      continue;
    }
    const description = descRaw.trim();
    if (!description) {
      skipped++;
      continue;
    }

    // Figure out the amount. Preference order:
    //   1. Debit column present + non-zero → expense
    //   2. Credit column present + non-zero → skip (income/refund)
    //   3. Amount column → negative = expense, positive = income (skip)
    let expense = NaN;

    if (debitIdx !== -1) {
      const debit = normalizeAmount(row[debitIdx] ?? '');
      const credit =
        creditIdx !== -1 ? normalizeAmount(row[creditIdx] ?? '') : NaN;

      if (!isNaN(credit) && credit !== 0) {
        // Pure credit row → income. Skip.
        skipped++;
        continue;
      }
      if (!isNaN(debit) && debit !== 0) {
        expense = Math.abs(debit);
      }
    }

    if (isNaN(expense) && amountIdx !== -1) {
      const amt = normalizeAmount(row[amountIdx] ?? '');
      if (isNaN(amt) || amt === 0) {
        skipped++;
        continue;
      }
      if (amt > 0) {
        // Positive amount = income. Skip.
        skipped++;
        continue;
      }
      expense = Math.abs(amt);
    }

    if (isNaN(expense) || expense === 0) {
      skipped++;
      continue;
    }

    transactions.push({
      date,
      description,
      amount: Math.round(expense * 100) / 100,
      category: guessCategory(description, mode),
    });
  }

  return { transactions, skippedCount: skipped, detectedColumns };
}

/** Helper exposed for the preview dropdown. */
export function categoryOptionsForMode(mode: Mode): CategoryOption[] {
  return getCategoriesForMode(mode);
}

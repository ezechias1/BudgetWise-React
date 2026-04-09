/**
 * Receipt OCR pipeline - ported from vanilla js/app.js
 * (resizeImageForOCR, parseReceiptText, setupReceiptScanning).
 *
 * Flow:
 *   1. Downscale + grayscale the image on a canvas (reduces Tesseract RAM
 *      + improves accuracy on noisy phone photos).
 *   2. Lazy-import tesseract.js so the ~4MB worker does not bloat the main
 *      bundle - only fetched the first time the user taps "Scan".
 *   3. Run OCR, parse the raw text heuristically into {amount, description,
 *      date}.
 *
 * The parser is deliberately lenient: it has to cope with the messy output
 * OCR produces on crumpled till slips, so prefer "best guess" over strict
 * validation. Caller is expected to open an ExpenseModal pre-filled with
 * these values so the user can review/fix before saving.
 */

import { todayIso } from './format';

export interface ParsedReceipt {
  /** Decimal amount as a string ("1234.56"), or "" if nothing plausible was found. */
  amount: string;
  /** Merchant name guess - typically the first meaningful line. */
  description: string;
  /** ISO date (YYYY-MM-DD). Defaults to today when no date is detected. */
  date: string;
}

/**
 * Downscale an image to maxDimension px on its longest side and convert
 * it to grayscale. Returns a JPEG Blob. Falls back to the original file on
 * any load error so a failed resize does not block OCR entirely.
 */
export function resizeImageForOCR(
  file: File | Blob,
  maxDimension = 800,
): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const scale = Math.min(1, maxDimension / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Grayscale pass (Rec. 601 luma). Matches the vanilla implementation.
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob ?? file);
        },
        'image/jpeg',
        0.6,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}

/**
 * Heuristic parser for OCR output. We prefer amounts that appear on the
 * same line as the word "TOTAL" (minus "SUBTOTAL") because receipts
 * frequently repeat prices; if none match, we fall back to the largest
 * currency-shaped number on the slip.
 */
export function parseReceiptText(text: string): ParsedReceipt {
  const result: ParsedReceipt = {
    amount: '',
    description: '',
    date: todayIso(),
  };

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // --- Amount ---------------------------------------------------------
  // Matches "1,234.56", "1234.56", "12.50" - optional R/$/euro/pound/naira
  // prefix. We parse every match, then pick either the one next to "TOTAL"
  // or the biggest value overall. Thousand separators are stripped before
  // parseFloat.
  const amountPattern =
    '[$\\u20ac\\u00a3\\u20a6R]?\\s*(\\d{1,3}(?:[,\\s]\\d{3})*(?:\\.\\d{2})|\\d+\\.\\d{2})';

  const allAmounts: number[] = [];
  let totalLineAmount: number | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const lineRegex = new RegExp(amountPattern, 'g');
    let m: RegExpExecArray | null;
    const lineValues: number[] = [];
    while ((m = lineRegex.exec(line)) !== null) {
      const raw = m[1].replace(/[,\s]/g, '');
      const val = parseFloat(raw);
      if (!Number.isNaN(val) && val > 0) lineValues.push(val);
    }
    if (lineValues.length === 0) continue;
    allAmounts.push(...lineValues);

    // Prefer lines where "total" appears but NOT "subtotal" - the last
    // such match wins because "TOTAL" typically comes after "SUBTOTAL"
    // on a receipt and we want the grand total.
    if (lower.includes('total') && !lower.includes('subtotal')) {
      totalLineAmount = Math.max(...lineValues);
    }
  }

  if (totalLineAmount !== null) {
    result.amount = totalLineAmount.toFixed(2);
  } else if (allAmounts.length > 0) {
    result.amount = Math.max(...allAmounts).toFixed(2);
  }

  // --- Description (merchant name) -----------------------------------
  // Prefer the first ALL-CAPS line (merchants usually print their name in
  // big caps at the top). Otherwise, first non-numeric line in the top 5.
  const allCaps = lines
    .slice(0, 6)
    .find(
      (l) =>
        l.length > 2 &&
        l === l.toUpperCase() &&
        /[A-Z]/.test(l) &&
        !/^\d+$/.test(l),
    );
  if (allCaps) {
    result.description = allCaps.replace(/[^A-Za-z0-9\s&\-']/g, '').trim();
  } else {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const cleaned = lines[i].replace(/[^a-zA-Z0-9\s&\-']/g, '').trim();
      if (cleaned.length > 2 && !/^\d+$/.test(cleaned)) {
        result.description = cleaned;
        break;
      }
    }
  }

  // --- Date -----------------------------------------------------------
  // Try ISO (YYYY-MM-DD) first, then DD/MM/YYYY or DD-MM-YYYY (SA-typical).
  const isoMatch = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    const [, y, mo, day] = isoMatch;
    result.date = `${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } else {
    const dmyMatch = text.match(
      /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})\b/,
    );
    if (dmyMatch) {
      const [, d, mo, yRaw] = dmyMatch;
      const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
      const dayNum = parseInt(d, 10);
      const monNum = parseInt(mo, 10);
      if (dayNum >= 1 && dayNum <= 31 && monNum >= 1 && monNum <= 12) {
        result.date = `${y}-${String(monNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      }
    }
  }

  return result;
}

/**
 * Runs the full scan pipeline against a user-picked image file: resize ->
 * lazy-load tesseract.js -> OCR -> parse. Throws if the OCR library fails
 * to load (caller should catch and fall back to an empty modal).
 */
export async function scanReceipt(file: File): Promise<ParsedReceipt> {
  const resized = await resizeImageForOCR(file, 800);

  // Lazy dynamic import - keeps the ~4MB tesseract worker out of the main
  // bundle. Vite code-splits this into its own chunk automatically.
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(resized);
    return parseReceiptText(data.text);
  } finally {
    await worker.terminate();
  }
}

#!/usr/bin/env node
/**
 * Standalone Playwright screenshot generator for BudgetWise.
 *
 * Bypasses the Playwright MCP shim's 5s hard timeout so we can capture
 * at 1290x2796 (iPhone 15 Pro Max portrait — the main Play Store size).
 *
 * Run with: node scripts/screenshots.mjs
 *
 * Saves:
 *   store-assets/screenshots/*.png            — Play Store phone size
 *   ../budgetwise-website/assets/*.png        — marketing site hero images
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STORE_DIR = path.join(ROOT, 'store-assets', 'screenshots');
const MARKETING_DIR = path.resolve(ROOT, '..', 'budgetwise-website', 'assets');

const BASE_URL = process.env.BUDGETWISE_URL || 'https://budget-wise-react.vercel.app';
const EMAIL = process.env.BUDGETWISE_EMAIL;
const PASSWORD = process.env.BUDGETWISE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Missing BUDGETWISE_EMAIL or BUDGETWISE_PASSWORD env vars.');
  console.error('Set them in your shell or a .env.local file before running this script.');
  process.exit(1);
}

const PHONE = { width: 1290, height: 2796 };     // Play Store phone (iPhone 15 Pro Max)
const DESKTOP = { width: 1440, height: 900 };    // Marketing hero desktop shot

/** Navigate, wait for hydration, wait a beat for data + chart renders. */
async function goto(page, pathname) {
  const url = BASE_URL + pathname;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function ensureLoggedIn(page) {
  await page.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  // If the auth form is showing, log in
  const emailInput = await page.$('#loginEmail, input[type="email"]');
  if (emailInput) {
    console.log('Signing in…');
    await emailInput.fill(EMAIL);
    const pwInput = await page.$('#loginPassword, input[type="password"]');
    if (pwInput) await pwInput.fill(PASSWORD);
    const submit = await page.$('button[type="submit"]');
    if (submit) {
      await submit.click();
      await page.waitForTimeout(3000);
    }
  }
}

async function switchMode(page, mode) {
  await page.evaluate(async (target) => {
    const btn = document.querySelector('.mode-dropdown-btn');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const titleCase = target.charAt(0).toUpperCase() + target.slice(1);
    const opt = Array.from(document.querySelectorAll('.mode-option')).find((o) =>
      o.textContent?.includes(titleCase),
    );
    if (opt) opt.click();
  }, mode);
  await page.waitForTimeout(2500);
}

async function toggleTheme(page) {
  await page.evaluate(() => {
    document.querySelector('.theme-toggle')?.click();
  });
  await page.waitForTimeout(800);
}

async function shot(page, outDir, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true, timeout: 30000 });
  console.log(`✓ ${path.relative(ROOT, file)}`);
}

async function main() {
  await mkdir(STORE_DIR, { recursive: true });
  try {
    await mkdir(MARKETING_DIR, { recursive: true });
  } catch {
    console.warn('Marketing dir not writable — skipping marketing shots');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  try {
    // ==============================
    // PHONE SHOTS for Play Store
    // ==============================
    console.log('\n== Phone 1290x2796 — Play Store ==');

    // 1. Auth page (sign out first if logged in)
    await goto(page, '/dashboard');
    const signedOut = await page.$('input[type="email"]');
    if (!signedOut) {
      await page.evaluate(() => document.querySelector('.btn-logout')?.click());
      await page.waitForTimeout(2000);
    }
    await goto(page, '/');
    await shot(page, STORE_DIR, '01-auth-dark.png');

    // Log in
    await ensureLoggedIn(page);

    // 2. Overview — Personal mode, dark
    await goto(page, '/dashboard');
    await shot(page, STORE_DIR, '02-overview-personal-dark.png');

    // 3. Overview — Business mode, dark
    await switchMode(page, 'business');
    await shot(page, STORE_DIR, '03-overview-business-dark.png');

    // switch back to personal for subsequent pages
    await switchMode(page, 'personal');

    // 4. Expenses
    await goto(page, '/dashboard/expenses');
    await shot(page, STORE_DIR, '04-expenses-dark.png');

    // 5. Savings
    await goto(page, '/dashboard/savings');
    await shot(page, STORE_DIR, '05-savings-dark.png');

    // 6. Currency
    await goto(page, '/dashboard/currency');
    await shot(page, STORE_DIR, '06-currency-dark.png');

    // 7. Advice
    await goto(page, '/dashboard/advice');
    await shot(page, STORE_DIR, '07-advice-dark.png');

    // 8. Account
    await goto(page, '/dashboard/account');
    await shot(page, STORE_DIR, '08-account-dark.png');

    // 9. Bank
    await goto(page, '/dashboard/bank');
    await shot(page, STORE_DIR, '10-bank-dark.png');

    // 10. Overview — Personal mode, LIGHT theme
    await goto(page, '/dashboard');
    await toggleTheme(page);
    await shot(page, STORE_DIR, '09-overview-personal-light.png');

    // toggle back to dark for marketing shots
    await toggleTheme(page);

    // ==============================
    // DESKTOP SHOTS for marketing site
    // ==============================
    console.log('\n== Desktop 1440x900 — marketing site ==');
    await context.close();

    const desktopCtx = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 2,
    });
    const dp = await desktopCtx.newPage();

    // Reuse the session by logging in again
    await dp.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await dp.waitForTimeout(1500);
    const authForm = await dp.$('input[type="email"]');
    if (authForm) {
      await authForm.fill(EMAIL);
      const pw = await dp.$('input[type="password"]');
      if (pw) await pw.fill(PASSWORD);
      const submit = await dp.$('button[type="submit"]');
      if (submit) {
        await submit.click();
        await dp.waitForTimeout(3000);
      }
    }

    // desktop-personal.png — Overview in Personal mode
    await dp.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle' });
    await dp.waitForTimeout(2000);
    if (MARKETING_DIR) {
      await dp.screenshot({
        path: path.join(MARKETING_DIR, 'desktop-personal.png'),
        fullPage: false,
      });
      console.log(`✓ ${path.join('..', 'budgetwise-website', 'assets', 'desktop-personal.png')}`);
    }

    // Marketing mobile shot — use the first phone page
    await desktopCtx.close();
    const mobileCtx = await browser.newContext({
      viewport: { width: 414, height: 896 },
      deviceScaleFactor: 3,
      isMobile: true,
    });
    const mp = await mobileCtx.newPage();
    await mp.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await mp.waitForTimeout(1500);
    const mAuth = await mp.$('input[type="email"]');
    if (mAuth) {
      await mAuth.fill(EMAIL);
      const pw = await mp.$('input[type="password"]');
      if (pw) await pw.fill(PASSWORD);
      const submit = await mp.$('button[type="submit"]');
      if (submit) {
        await submit.click();
        await mp.waitForTimeout(3000);
      }
    }
    await mp.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle' });
    await mp.waitForTimeout(2000);
    if (MARKETING_DIR) {
      await mp.screenshot({
        path: path.join(MARKETING_DIR, 'mobile-personal.png'),
        fullPage: false,
      });
      console.log(`✓ ${path.join('..', 'budgetwise-website', 'assets', 'mobile-personal.png')}`);
    }
    await mobileCtx.close();
  } finally {
    await browser.close();
  }

  console.log('\nAll screenshots saved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

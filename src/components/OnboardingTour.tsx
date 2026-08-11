import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TourStep {
  target: string; // CSS selector for the element to highlight
  title: string;
  text: string;
  openMenu?: boolean; // if true, opens the mobile sidebar before highlighting
}

const STEPS: TourStep[] = [
  {
    target: '.stats-grid',
    title: 'Your Financial Snapshot',
    text: 'See your income, spending, balance, and savings at a glance. These update in real time as you add expenses.',
  },
  {
    target: '.btn-add',
    title: 'Add Expense',
    text: 'Tap here to open the full expense form with date, category, recurring options, and more.',
  },
  {
    target: '.btn-scan',
    title: 'Scan Receipts',
    text: "Snap a photo of any receipt and we'll read it using OCR — the total, store name, and category are auto-filled.",
  },
  {
    // BudgetRing.tsx renders id="budgetRingCard" — a plain `.chart-card`
    // fallback here used to match whichever chart-card happened to be first
    // in the DOM (My Accounts wallet, or Spending by Category), never the
    // actual ring, since `.budget-ring-container` never existed anywhere.
    target: '#budgetRingCard',
    title: 'Budget Ring',
    text: 'A visual gauge of your spending. Green means on track, yellow means careful, red means near your limit.',
  },
  {
    target: '.mode-dropdown',
    title: 'Switch Modes',
    text: 'BudgetWise has three modes: Personal, Business, and Family. Each has its own budget, categories, and features.',
    // Lives in the sidebar, which is an off-canvas drawer on mobile — without
    // this the step highlighted something parked off-screen to the left.
    openMenu: true,
  },
  {
    target: '.menu-toggle',
    title: 'Menu',
    text: 'Tap this button to open the navigation menu and access all features.',
  },
  {
    target: '.sidebar-nav',
    title: 'Explore Features',
    text: 'Use the sidebar to navigate — Expenses, Savings Goals, Bank Connect, Currency Converter, and more.',
    openMenu: true,
  },
];

const STORAGE_KEY = 'budgetwise-onboarded';

// Matches the CSS breakpoint (styles-dashboard.css) where .sidebar switches
// from an always-visible column to an off-canvas drawer. Below this width,
// .sidebar-nav is only reachable by opening the drawer; at or above it,
// the sidebar is already on-screen and "opening" it has no business firing.
const MOBILE_BREAKPOINT = '(max-width: 768px)';
const isMobileLayout = () => window.matchMedia(MOBILE_BREAKPOINT).matches;

/**
 * First selector in a step's comma-separated target list that resolves to an
 * element actually occupying space. Being in the DOM isn't enough — a
 * display:none element (e.g. .menu-toggle above the mobile breakpoint) and a
 * detached one both measure 0x0 at the origin, which would otherwise be
 * accepted as a legitimate position and park the spotlight in the corner.
 */
function findVisibleTarget(target: string): Element | null {
  for (const sel of target.split(',')) {
    const el = document.querySelector(sel.trim());
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // Reject anything parked off-screen horizontally — that's the closed
    // mobile drawer (translateX(-100%)), whose contents still measure a full
    // size and would otherwise be "highlighted" somewhere the user can't see.
    // Vertical offsets are fine: below-the-fold targets are scrolled to.
    if (r.right <= 0 || r.left >= window.innerWidth) continue;
    return el;
  }
  return null;
}

/**
 * Onboarding tour overlay — shows step-by-step highlights for first-time users.
 * Scrolls elements into view, handles mobile menu, and positions tooltip smartly.
 */
export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
  // Real rendered tooltip box, needed to clamp it inside the viewport. Seeded
  // with the CSS max-width and a typical height so the very first paint is
  // already close; the layout effect below corrects it before the browser
  // draws.
  const [tipSize, setTipSize] = useState({ w: 300, h: 168 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // True while measureAndScroll's own scrollIntoView is moving the page.
  // Without this, that programmatic scroll fires 'scroll' events which the
  // resize/scroll listener below would treat as a user scroll and react to
  // by re-running positionTooltip — which calls scrollIntoView again,
  // restarting the animation in a loop that never settles.
  const autoScrollingRef = useRef(false);
  // Set when a resize/scroll/layout change arrives while the rect poll is
  // still running. Those events used to be dropped outright, so a shift that
  // landed mid-measure (the "kids need approval" banner mounting ~1s in and
  // pushing the page down) was never reconciled and the spotlight stayed
  // behind. Deferring instead of discarding fixes that.
  const pendingRepositionRef = useRef(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const positionTooltip = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex];
    if (!s) return;

    // Open mobile menu if this step requires it. On desktop the sidebar is
    // already an always-visible column (no .open/.sidebar-overlay involved
    // at that breakpoint) — clicking the mobile menu-toggle there was firing
    // anyway (it's still in the DOM, just display:none), which flipped on
    // .sidebar-overlay.active. That overlay has no desktop media guard, so
    // it threw a full-screen dark scrim over the entire dashboard for a step
    // that never needed a drawer opened in the first place.
    if (s.openMenu) {
      if (isMobileLayout()) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && !sidebar.classList.contains('open')) {
          const menuBtn = document.querySelector('.menu-toggle') as HTMLButtonElement | null;
          menuBtn?.click();
        }
      }
      // measureAndScroll polls until the target's rect stops moving, which
      // naturally absorbs the drawer's slide-in transition on mobile and is
      // a same-tick no-op on desktop.
      measureAndScroll(stepIndex);
      return;
    }

    // Close mobile menu if open and step doesn't need it
    if (!s.openMenu) {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar?.classList.contains('open')) {
        const overlay = document.querySelector('.sidebar-overlay') as HTMLElement | null;
        overlay?.click();
      }
    }

    measureAndScroll(stepIndex);
  }, []);

  // Re-read the target's position without scrolling to it again. Used to
  // reconcile a layout shift that landed mid-measure — re-running the full
  // scroll-and-poll there would restart the smooth-scroll animation, which
  // itself emits scroll events and can chase its own tail.
  const remeasure = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex];
    if (!s) return;
    const el = findVisibleTarget(s.target);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  const measureAndScroll = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex];
    if (!s) return;

    // Scroll the target into view, then measure once it settles. A fixed delay
    // here used to guess how long the scroll would take — but that varies a
    // lot with distance, and mobile's single-column layout often needs a
    // much longer scroll than desktop's grid does for the same step. Too
    // short a guess measured mid-scroll and placed the spotlight over
    // whatever happened to be there instead of the real target. Polling
    // until the rect stops moving works the same way regardless of screen
    // size or scroll duration (including prefers-reduced-motion, where the
    // scroll is instant and this just settles on the first read).
    //
    // Resolving the target is deliberately left to the poll rather than done
    // up-front: on mobile an openMenu step has just clicked the drawer open,
    // and for the ~300ms of its slide-in the contents are still parked
    // off-screen. Skipping on the first look dropped those steps entirely.
    autoScrollingRef.current = true;

    clearTimeout(scrollTimeoutRef.current);
    let lastRect: DOMRect | null = null;
    let stableReads = 0;
    let attempts = 0;
    let missingAttempts = 0;
    let scrolled = false;
    const MAX_ATTEMPTS = 40; // ~2s at 50ms — well past any real scroll/transition
    // ~800ms: comfortably longer than the drawer's 0.3s transition, short
    // enough that a step with no target on this layout (the mobile-only
    // .menu-toggle on desktop) is skipped without a visible stall.
    const MAX_MISSING_ATTEMPTS = 16;

    const poll = () => {
      attempts += 1;

      // Re-resolve the node every tick instead of reusing the one captured
      // above. A re-render (data arriving, charts mounting) can replace the
      // target's DOM node, and a detached node reports 0x0 at the origin —
      // which the "has it stopped moving?" check happily accepted as settled,
      // parking the spotlight offscreen. Treat a missing/zero-size read as
      // "not ready" and keep waiting instead.
      const live = findVisibleTarget(s.target);
      if (!live) {
        lastRect = null;
        stableReads = 0;
        missingAttempts += 1;
        if (missingAttempts < MAX_MISSING_ATTEMPTS) {
          scrollTimeoutRef.current = setTimeout(poll, 50);
        } else {
          // Never showed up on this layout — nothing to point at, so move on.
          autoScrollingRef.current = false;
          if (stepIndex < STEPS.length - 1) setStep(stepIndex + 1);
          else finish();
        }
        return;
      }

      if (!scrolled) {
        scrolled = true;
        live.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }

      const rect = live.getBoundingClientRect();
      const settled =
        lastRect !== null &&
        Math.abs(rect.top - lastRect.top) < 1 &&
        Math.abs(rect.left - lastRect.left) < 1 &&
        Math.abs(rect.width - lastRect.width) < 1 &&
        Math.abs(rect.height - lastRect.height) < 1;
      lastRect = rect;
      stableReads = settled ? stableReads + 1 : 0;

      if (stableReads >= 2 || attempts >= MAX_ATTEMPTS) {
        autoScrollingRef.current = false;
        // Viewport coordinates, deliberately without scrollX/scrollY. The
        // spotlight and tooltip are position:fixed, so document coordinates
        // would double-count the scroll offset.
        setPos({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
        // Something moved the page while we were measuring — reconcile now
        // that the guard is down, measuring only so we don't re-scroll.
        if (pendingRepositionRef.current) {
          pendingRepositionRef.current = false;
          scrollTimeoutRef.current = setTimeout(() => remeasure(stepIndex), 120);
        }
        return;
      }
      scrollTimeoutRef.current = setTimeout(poll, 50);
    };
    scrollTimeoutRef.current = setTimeout(poll, 50);
  }, []);

  useEffect(() => {
    if (visible) positionTooltip(step);
    return () => clearTimeout(scrollTimeoutRef.current);
  }, [step, visible, positionTooltip]);

  // Measure the tooltip after each render so the clamp above works off its
  // true size (copy length varies per step). The 1px threshold stops the
  // set-state/re-measure loop that an unconditional update would cause.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (Math.abs(width - tipSize.w) > 1 || Math.abs(height - tipSize.h) > 1) {
      setTipSize({ w: width, h: height });
    }
  });

  // Reposition on resize/scroll. The scroll listener was previously missing
  // despite this comment — so a manual scroll mid-step (common on mobile,
  // e.g. momentum/rubber-band scroll continuing after the automatic
  // scrollIntoView) left the spotlight stranded over whatever content had
  // scrolled into its old spot instead of following the real target.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const handler = () => {
      if (autoScrollingRef.current) {
        pendingRepositionRef.current = true;
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => positionTooltip(step));
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, { passive: true });

    // The rect poll settles as soon as the target holds still for ~150ms,
    // which can land before late async chrome (the "kids need approval"
    // banner, chart cards) finishes mounting and pushes the page down —
    // leaving the spotlight stranded over whatever moved into its old spot.
    // Watching the body for size changes re-runs the measurement whenever
    // that happens.
    const ro = new ResizeObserver(handler);
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler);
    };
  }, [visible, step, positionTooltip]);

  const finish = () => {
    // Close sidebar if open
    const overlay = document.querySelector('.sidebar-overlay') as HTMLElement | null;
    if (overlay?.classList.contains('active')) overlay.click();
    localStorage.setItem(STORAGE_KEY, 'true');
    localStorage.setItem('budgetwise-tour-complete', 'true');
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const skip = () => finish();

  if (!visible) return null;

  const current = STEPS[step];
  if (!current) return null;

  // Place the tooltip below the target, flipping above when it doesn't fit,
  // then clamp to the viewport on BOTH axes. Vertical clamping is what keeps
  // the Skip/Done row on-screen for tall targets like the full-height
  // .sidebar-nav, whose bottom edge sits far below the fold.
  const MARGIN = 12;
  const GAP = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { w: tipW, h: tipH } = tipSize;

  const elBottom = pos.top + pos.height;
  const elRight = pos.left + pos.width;

  // A target taller than half the viewport (the full-height .sidebar-nav on
  // the "Explore Features" step) leaves no room above or below, so the
  // tooltip ends up clamped on top of the very thing it's describing —
  // sitting over the brightly-lit spotlight, which is what made its text so
  // hard to read. Put it alongside instead, on whichever side has room.
  const isTallTarget = pos.height > vh * 0.5;
  const roomRight = vw - elRight >= tipW + GAP + MARGIN;
  const roomLeft = pos.left >= tipW + GAP + MARGIN;
  const placeBeside = isTallTarget && (roomRight || roomLeft);

  let rawTop: number;
  let rawLeft: number;

  if (placeBeside) {
    rawLeft = roomRight ? elRight + GAP : pos.left - tipW - GAP;
    rawTop = pos.top + pos.height / 2 - tipH / 2; // vertically centred on it
  } else {
    const fitsBelow = vh - elBottom >= tipH + GAP + MARGIN;
    const fitsAbove = pos.top >= tipH + GAP + MARGIN;
    rawTop = !fitsBelow && fitsAbove ? pos.top - tipH - GAP : elBottom + GAP;
    rawLeft = pos.left;
  }

  const tooltipTop = Math.max(MARGIN, Math.min(rawTop, vh - tipH - MARGIN));
  const tooltipLeft = Math.max(MARGIN, Math.min(rawLeft, vw - tipW - MARGIN));

  // Portal to <body>. Rendered in place, the tour lives inside .main-content,
  // which is position:relative + z-index:1 and therefore its own stacking
  // context — capping the tour's z-index:802 below the sidebar's z-index:50.
  // Steps pointing at sidebar targets (Switch Modes, Explore Features) had
  // their tooltip painted behind the sidebar as a result.
  return createPortal(
    <>
      <div className="tour-overlay" onClick={skip} />
      <div
        className="tour-spotlight"
        style={{
          top: pos.top - 8,
          left: pos.left - 8,
          width: pos.width + 16,
          height: pos.height + 16,
        }}
      />
      <div
        ref={tooltipRef}
        className="tour-tooltip"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          position: 'fixed',
          // Keep the stylesheet's 300px cap — a bare `calc(100vw - 24px)`
          // inline overrides it and lets the card stretch the full viewport.
          maxWidth: 'min(300px, calc(100vw - 24px))',
        }}
      >
        <h3>{current.title}</h3>
        <p>{current.text}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={skip}>
            Skip tour
          </button>
          <div className="tour-dots">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={'tour-dot' + (i === step ? ' active' : '')}
              />
            ))}
          </div>
          <button className="tour-next" onClick={next}>
            {step === STEPS.length - 1 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

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
 * Onboarding tour overlay — shows step-by-step highlights for first-time users.
 * Scrolls elements into view, handles mobile menu, and positions tooltip smartly.
 */
export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // True while measureAndScroll's own scrollIntoView is moving the page.
  // Without this, that programmatic scroll fires 'scroll' events which the
  // resize/scroll listener below would treat as a user scroll and react to
  // by re-running positionTooltip — which calls scrollIntoView again,
  // restarting the animation in a loop that never settles.
  const autoScrollingRef = useRef(false);

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

  const measureAndScroll = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex];
    if (!s) return;

    const selectors = s.target.split(',').map((sel) => sel.trim());
    let el: Element | null = null;
    for (const sel of selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }

    if (!el) {
      // Element not found — skip to next or finish
      if (stepIndex < STEPS.length - 1) {
        setStep(stepIndex + 1);
      } else {
        finish();
      }
      return;
    }

    // Scroll element into view, then measure once it settles. A fixed delay
    // here used to guess how long the scroll would take — but that varies a
    // lot with distance, and mobile's single-column layout often needs a
    // much longer scroll than desktop's grid does for the same step. Too
    // short a guess measured mid-scroll and placed the spotlight over
    // whatever happened to be there instead of the real target. Polling
    // until the rect stops moving works the same way regardless of screen
    // size or scroll duration (including prefers-reduced-motion, where the
    // scroll is instant and this just settles on the first read).
    autoScrollingRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    clearTimeout(scrollTimeoutRef.current);
    let lastRect: DOMRect | null = null;
    let stableReads = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // ~2s at 50ms — well past any real scroll/transition

    const poll = () => {
      const rect = el!.getBoundingClientRect();
      const settled =
        lastRect !== null &&
        Math.abs(rect.top - lastRect.top) < 1 &&
        Math.abs(rect.left - lastRect.left) < 1 &&
        Math.abs(rect.width - lastRect.width) < 1 &&
        Math.abs(rect.height - lastRect.height) < 1;
      lastRect = rect;
      attempts += 1;
      stableReads = settled ? stableReads + 1 : 0;

      if (stableReads >= 2 || attempts >= MAX_ATTEMPTS) {
        autoScrollingRef.current = false;
        setPos({
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
        });
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

  // Reposition on resize/scroll. The scroll listener was previously missing
  // despite this comment — so a manual scroll mid-step (common on mobile,
  // e.g. momentum/rubber-band scroll continuing after the automatic
  // scrollIntoView) left the spotlight stranded over whatever content had
  // scrolled into its old spot instead of following the real target.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const handler = () => {
      if (autoScrollingRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => positionTooltip(step));
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
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

  // Position tooltip below or above the highlighted element
  const viewportHeight = window.innerHeight;
  const elBottom = pos.top + pos.height - window.scrollY;
  const spaceBelow = viewportHeight - elBottom;
  const placeAbove = spaceBelow < 200 && pos.top - window.scrollY > 200;

  const tooltipTop = placeAbove
    ? pos.top - 16 // tooltip will use transform to go above
    : pos.top + pos.height + 16;
  const tooltipWidth = Math.min(320, window.innerWidth - 24);
  const tooltipLeft = Math.max(12, Math.min(pos.left, window.innerWidth - tooltipWidth - 12));

  return (
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
        className="tour-tooltip"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          position: 'absolute',
          maxWidth: 'calc(100vw - 24px)',
          ...(placeAbove ? { transform: 'translateY(-100%)' } : {}),
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
    </>
  );
}

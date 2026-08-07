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
    target: '.budget-ring-container, .chart-card',
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

/**
 * Onboarding tour overlay — shows step-by-step highlights for first-time users.
 * Scrolls elements into view, handles mobile menu, and positions tooltip smartly.
 */
export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const positionTooltip = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex];
    if (!s) return;

    // Open mobile menu if this step requires it
    if (s.openMenu) {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && !sidebar.classList.contains('open')) {
        const menuBtn = document.querySelector('.menu-toggle') as HTMLButtonElement | null;
        menuBtn?.click();
      }
      // Wait for sidebar animation
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => measureAndScroll(stepIndex), 350);
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

    // Scroll element into view first, then measure after scroll completes
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      const rect = el!.getBoundingClientRect();
      setPos({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      });
    }, 400);
  }, []);

  useEffect(() => {
    if (visible) positionTooltip(step);
    return () => clearTimeout(scrollTimeoutRef.current);
  }, [step, visible, positionTooltip]);

  // Reposition on resize/scroll
  useEffect(() => {
    if (!visible) return;
    const handler = () => positionTooltip(step);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
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

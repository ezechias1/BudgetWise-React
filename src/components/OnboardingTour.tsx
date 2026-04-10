import { useCallback, useEffect, useState } from 'react';

interface TourStep {
  target: string; // CSS selector for the element to highlight
  title: string;
  text: string;
}

const STEPS: TourStep[] = [
  {
    target: '.stats-grid',
    title: 'Your Financial Snapshot',
    text: 'See your income, spending, balance, and savings at a glance. These update in real time as you add expenses.',
  },
  {
    target: '.quick-add-bar, .stats-grid + div + div',
    title: 'Quick Add',
    text: 'Log expenses instantly — pick a category, type the amount, and hit Add. No need to open the full form.',
  },
  {
    target: '.btn-add',
    title: 'Add Expense',
    text: 'For more detail, tap here to open the full expense form with date, category, recurring options, and more.',
  },
  {
    target: '.btn-scan',
    title: 'Scan Receipts',
    text: 'Snap a photo of any receipt and we\'ll read it using OCR — the total, store name, and category are auto-filled.',
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
    target: '.nav-items, nav ul',
    title: 'Explore Features',
    text: 'Use the sidebar to navigate — Expenses, Savings Goals, Bank Connect, Currency Converter, and more.',
  },
];

const STORAGE_KEY = 'budgetwise-onboarded';

/**
 * Onboarding tour overlay — shows step-by-step highlights for first-time users.
 * Uses the existing .tour-overlay / .tour-tooltip / .tour-spotlight CSS.
 * Skips if user has already completed or dismissed the tour.
 */
export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });

  useEffect(() => {
    // Only show for first-time users
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Small delay so DOM elements are rendered
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const positionTooltip = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex];
    if (!s) return;
    // Try each selector (some steps have fallbacks separated by comma)
    const selectors = s.target.split(',').map((s) => s.trim());
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
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    });
    // Scroll element into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    if (visible) positionTooltip(step);
  }, [step, visible, positionTooltip]);

  const finish = () => {
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
  const tooltipTop = pos.top + pos.height + 16;
  const tooltipLeft = Math.max(16, Math.min(pos.left, window.innerWidth - 320));

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

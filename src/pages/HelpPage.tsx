import { useMode } from '@/contexts/ModeContext';

/**
 * Ports #page-help from dashboard.html lines 2108-2273.
 *
 * Content-heavy static page. All class names, headings, SVGs and copy
 * are preserved verbatim so the existing dashboard.css rules apply.
 *
 * The business-only and family-only help sections are hidden by default
 * in the vanilla site and revealed via app.js based on the active mode —
 * here we toggle via the ModeContext.
 */
export default function HelpPage() {
  const { mode } = useMode();

  const handleReplayTour = () => {
    // TODO: wire up the guided tour replay once the tour system is ported.
    // Vanilla: js/app.js resets the onboarding flag in localStorage and
    // re-triggers the walkthrough overlay.
  };

  return (
    <section className="page active" id="page-help">
      <div className="page-header">
        <div>
          <h1>How to Use BudgetWise</h1>
          <p className="page-subtitle">Your guide to every feature</p>
        </div>
        <button className="btn-primary" id="replayTourBtn" onClick={handleReplayTour}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 4v6h6" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
          Replay Tour
        </button>
      </div>

      {/* Shared instructions (all modes) */}
      <div className="help-section">
        <div className="help-card">
          <div className="help-card-icon">&#128202;</div>
          <h3>Overview Dashboard</h3>
          <p>
            Your home page shows a snapshot of your finances: monthly income, total spent,
            remaining budget, and savings goal progress. The <strong>Budget Ring</strong> gives a
            visual gauge — green means you're on track, yellow means be careful, red means you're
            near your limit.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#9889;</div>
          <h3>Quick Add</h3>
          <p>
            The bar at the top of Overview lets you log expenses instantly. Pick a category, type
            the amount, add a short description, and hit <strong>Add</strong>. No need to open the
            full expense form for quick entries.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128176;</div>
          <h3>Expenses</h3>
          <p>
            View all your transactions, filter by month or category, and search by description. On
            mobile, <strong>swipe left</strong> on a row to delete or <strong>swipe right</strong>{' '}
            to edit. Deleted expenses can be undone within 5 seconds.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#127919;</div>
          <h3>Savings Goals</h3>
          <p>
            Set multiple savings goals with target amounts and deadlines. Track your progress
            visually and get advice on how to reach them faster.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128177;</div>
          <h3>Currency Converter</h3>
          <p>
            Convert between 150+ currencies with real-time exchange rates. Great for travel
            budgeting or if you earn in one currency and spend in another.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128161;</div>
          <h3>Smart Advice</h3>
          <p>
            Get personalised tips based on your spending patterns — like which categories you're
            overspending in and how to adjust your budget.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128269;</div>
          <h3>Global Search</h3>
          <p>
            Press <strong>Ctrl+K</strong> (or Cmd+K on Mac) to search across all your expenses,
            savings goals, and categories in one place.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128260;</div>
          <h3>Recurring Detection</h3>
          <p>
            If the same expense appears 3+ months in a row, BudgetWise will suggest marking it as
            recurring so it auto-populates each month.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#127974;</div>
          <h3>Bank Connect</h3>
          <p>
            Link your bank account to automatically import transactions (Beta). Currently supports
            South African banks.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128424;</div>
          <h3>Export to PDF</h3>
          <p>
            Export your expenses list as a clean PDF. Go to <strong>Expenses</strong> and click{' '}
            <strong>Export PDF</strong> — a print-friendly view opens so you can save or print
            your records.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128247;</div>
          <h3>Receipt Scanner</h3>
          <p>
            Snap a photo of any receipt and BudgetWise will read it using OCR. It extracts the
            total amount, store name, and suggests a category. Tap <strong>Scan</strong> on the
            Overview page to try it.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128190;</div>
          <h3>Backup &amp; Restore</h3>
          <p>
            Download all your data as a JSON file from{' '}
            <strong>Account &gt; Backup All Data</strong>. To restore, use{' '}
            <strong>Restore from Backup</strong> and pick a previously saved file. Great for
            migrating between devices.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128100;</div>
          <h3>Profile Editing</h3>
          <p>
            Update your name, email, or password from the <strong>Account</strong> page. Click{' '}
            <strong>Edit</strong> next to your name or <strong>Change</strong> next to your email.
            Use <strong>Change Password</strong> under Actions.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128274;</div>
          <h3>Budget Limits</h3>
          <p>
            Set spending limits per category from <strong>Expenses &gt; Limits</strong>. When you
            approach or exceed a limit, you'll get a notification. Limits reset monthly.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#9971;</div>
          <h3>Tithe Tracking</h3>
          <p>
            Toggle tithe on from <strong>Account</strong> to automatically calculate 10% of your
            income. A tithe category appears in your expense dropdown for easy tracking.
          </p>
        </div>
      </div>

      {/* Business-only instructions */}
      <div
        className="help-section help-business-only"
        style={{ display: mode === 'business' ? undefined : 'none' }}
      >
        <h2 className="help-section-title">Business Features</h2>
        <div className="help-card">
          <div className="help-card-icon">&#128221;</div>
          <h3>Invoices</h3>
          <p>
            Create and manage invoices for your clients. Track which are paid, pending, or
            overdue. Invoice amounts feed into your Profit &amp; Loss report automatically.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128101;</div>
          <h3>Clients</h3>
          <p>
            Keep a directory of your clients with contact details. Link invoices to clients for
            easy tracking of who owes what.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128200;</div>
          <h3>Profit &amp; Loss</h3>
          <p>
            See your revenue vs expenses breakdown. Tracks income from paid invoices against your
            business expenses to show net profit by category.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128203;</div>
          <h3>Tax Estimator</h3>
          <p>
            Estimates your quarterly tax liability based on your revenue and deductible expenses.
            Shows a breakdown by quarter and your top deductible categories.
          </p>
        </div>
      </div>

      {/* Family-only instructions */}
      <div
        className="help-section help-family-only"
        style={{ display: mode === 'family' ? undefined : 'none' }}
      >
        <h2 className="help-section-title">Family Features</h2>
        <div className="help-card">
          <div className="help-card-icon">&#128106;</div>
          <h3>Family Members</h3>
          <p>
            Add everyone in your household — parents, teens, and kids. Each member gets their own
            colour, role, and weekly allowance. Click <strong>Edit</strong> on any member card to
            update their details.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128181;</div>
          <h3>Allowances</h3>
          <p>
            Set weekly spending money for each member. Track how much they've spent and how much
            is left. Allowances <strong>auto-reset every Monday</strong>. You'll see a warning
            when someone has used 80%+ of their allowance.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#9989;</div>
          <h3>Chores &amp; Rewards</h3>
          <p>
            Assign chores with cash rewards to motivate the family. When a chore is marked
            complete, the reward gets added to that member's allowance automatically.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#127942;</div>
          <h3>Family Goals</h3>
          <p>
            Save together as a family for something special — a holiday, new TV, etc. Each member
            can contribute, and you'll see who contributed what.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#127775;</div>
          <h3>Wish List</h3>
          <p>
            Kids can add items they're saving up for. They can incrementally save toward each wish
            and see their progress. A celebration shows when they reach the goal!
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#127941;</div>
          <h3>Savings Leaderboard</h3>
          <p>
            See which family member has saved the most from their allowance this week. Gold,
            silver, and bronze medals make saving a friendly competition.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128202;</div>
          <h3>Monthly Family Report</h3>
          <p>
            Get a full breakdown of the month: total budget, per-member spending, completed
            chores, goal progress, and top spending categories. Great for family budget meetings.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128161;</div>
          <h3>Financial Tips</h3>
          <p>
            A new money tip appears daily on the Allowances page — age-appropriate advice to teach
            kids about saving, spending wisely, and earning.
          </p>
        </div>
        <div className="help-card">
          <div className="help-card-icon">&#128065;</div>
          <h3>Spending Tracker</h3>
          <p>
            Track real spending from family members who also have BudgetWise. As a parent:{' '}
            <strong>generate an invite code</strong> and share it. Members enter the code to link,
            then you <strong>approve</strong> them. Members choose to{' '}
            <strong>share all spending or specific categories only</strong>. Their expenses appear
            in your live feed. Members can unlink at any time.
          </p>
        </div>
      </div>
    </section>
  );
}

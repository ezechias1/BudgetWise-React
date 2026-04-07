import { useState } from 'react';
import { useOverviewStats } from '@/hooks/useOverviewStats';
import { useSavingsGoals } from '@/hooks/useSavingsGoals';
import { NewGoalModal, AddToGoalModal } from '@/components/SavingsGoalModals';
import { formatCurrency } from '@/lib/format';
import type { SavingsGoal } from '@/types';

// Matches `goalColors` in app.js line 209.
const GOAL_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#6366f1',
];

/** Port of the advice-building logic in renderSavingsGoals (app.js line 2089). */
function buildAdvice(goal: SavingsGoal, currency: string): string {
  const pct =
    goal.target_amount > 0
      ? Math.min(100, (goal.saved_amount / goal.target_amount) * 100)
      : 0;
  if (pct >= 100) {
    return "You did it! You've reached your goal. Time to treat yourself.";
  }
  const remaining = goal.target_amount - goal.saved_amount;
  if (goal.deadline) {
    const deadline = new Date(goal.deadline);
    const now = new Date();
    const monthsUntil = Math.max(
      0,
      (deadline.getFullYear() - now.getFullYear()) * 12 +
        deadline.getMonth() -
        now.getMonth(),
    );
    const needed = remaining / Math.max(1, monthsUntil);
    if (needed > goal.monthly_contribution) {
      return `You need ${formatCurrency(needed, currency)}/month to hit your deadline. Consider increasing your contribution from ${formatCurrency(goal.monthly_contribution, currency)}.`;
    }
    return "You're on track! At your current rate you'll reach this goal before your deadline.";
  }
  const monthsLeft =
    goal.monthly_contribution > 0
      ? Math.ceil(remaining / goal.monthly_contribution)
      : 0;
  if (monthsLeft > 0) {
    return `At ${formatCurrency(goal.monthly_contribution, currency)}/month, you'll reach this goal in about ${monthsLeft} month${monthsLeft === 1 ? '' : 's'}.`;
  }
  return '';
}

/**
 * Ports #page-savings (dashboard.html lines 697-778) + renderSavingsGoals
 * (app.js line 2063). Scope: goals list with progress + advice, stat cards,
 * create modal, add-to-goal modal, delete. Deferred: savings line chart,
 * update-monthly-budget inline form (needs user_settings write — Round 5).
 */
export default function SavingsPage() {
  const { goals, addGoal, fundGoal, deleteGoal } = useSavingsGoals();
  const stats = useOverviewStats();

  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [fundTarget, setFundTarget] = useState<SavingsGoal | null>(null);

  const handleDelete = async (goal: SavingsGoal) => {
    if (!confirm(`Delete "${goal.name}"?`)) return;
    const { error } = await deleteGoal(goal.id);
    if (error) alert(`Delete failed: ${error}`);
  };

  const goalStatus =
    stats.savingsGoal === 0
      ? 'Not set'
      : stats.savingsPct >= 100
        ? 'Achieved'
        : `${Math.round(stats.savingsPct)}% of goal`;

  return (
    <>
      <section className="page active" id="page-savings">
        <div className="page-header">
          <div>
            <h1>Savings</h1>
            <p className="page-subtitle">Track your savings goals</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-add"
              style={{
                background: 'rgba(139,92,246,0.1)',
                borderColor: 'rgba(139,92,246,0.2)',
                color: '#8b5cf6',
              }}
              onClick={() => setNewGoalOpen(true)}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14m-7-7h14" />
              </svg>
              New Goal
            </button>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon stat-green">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Monthly Budget Goal</span>
              <span className="stat-value">
                {formatCurrency(stats.savingsGoal, stats.currency)}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-blue">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Saved This Month</span>
              <span className="stat-value">
                {formatCurrency(stats.saved, stats.currency)}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-purple">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2m-9-3h.01M15 11h.01" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Goal Status</span>
              <span className="stat-value">{goalStatus}</span>
            </div>
          </div>
        </div>

        <div className="chart-card full-width">
          <h3>What You're Saving For</h3>
          <div className="savings-goals-list">
            {goals.length === 0 ? (
              <div className="empty-state empty-state-action">
                <svg
                  viewBox="0 0 24 24"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ opacity: 0.3 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <p>No savings goals yet</p>
                <button
                  type="button"
                  className="empty-action-btn"
                  onClick={() => setNewGoalOpen(true)}
                >
                  Create Your First Goal
                </button>
              </div>
            ) : (
              goals.map((goal, idx) => {
                const pct =
                  goal.target_amount > 0
                    ? Math.min(100, (goal.saved_amount / goal.target_amount) * 100)
                    : 0;
                const color = GOAL_COLORS[idx % GOAL_COLORS.length];
                const advice = buildAdvice(goal, stats.currency);
                return (
                  <div className="goal-card" key={goal.id}>
                    <div className="goal-header">
                      <div className="goal-name-row">
                        <div
                          className="goal-dot"
                          style={{ background: color }}
                        />
                        <h4>{goal.name}</h4>
                      </div>
                      <div className="goal-actions">
                        <button
                          type="button"
                          className="btn-goal-add"
                          onClick={() => setFundTarget(goal)}
                        >
                          + Add
                        </button>
                        <button
                          type="button"
                          className="btn-delete btn-goal-delete"
                          onClick={() => handleDelete(goal)}
                          aria-label={`Delete ${goal.name}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="goal-progress">
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${pct}%`,
                            background: color,
                            boxShadow: `0 0 12px ${color}40`,
                          }}
                        />
                      </div>
                      <div className="goal-stats">
                        <span>{formatCurrency(goal.saved_amount, stats.currency)} saved</span>
                        <span>{Math.round(pct)}%</span>
                        <span>{formatCurrency(goal.target_amount, stats.currency)} goal</span>
                      </div>
                    </div>
                    {advice && <p className="goal-advice">{advice}</p>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <NewGoalModal
        open={newGoalOpen}
        onClose={() => setNewGoalOpen(false)}
        onSubmit={addGoal}
      />
      <AddToGoalModal
        open={fundTarget !== null}
        onClose={() => setFundTarget(null)}
        goalName={fundTarget?.name ?? ''}
        onSubmit={(amount) =>
          fundTarget
            ? fundGoal(fundTarget.id, amount)
            : Promise.resolve({ error: 'No goal selected' })
        }
      />
    </>
  );
}

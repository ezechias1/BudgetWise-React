import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExpenses } from '@/hooks/useExpenses';
import { useSavingsGoals } from '@/hooks/useSavingsGoals';
import { formatCurrency } from '@/lib/format';
import { useUserSettings } from '@/hooks/useUserSettings';
import { CATEGORY_COLORS, type Category } from '@/lib/categories';

/**
 * Ports `setupGlobalSearch()` from js/app.js:6380-6470.
 *
 * Uses the existing vanilla CSS classes (.global-search-trigger, .global-search-overlay,
 * .global-search-box, .global-search-results, .search-result-*) so the styling is
 * theme-aware (works in dark + light) without any inline styles.
 */
export function GlobalSearch() {
  const { expenses } = useExpenses();
  const { goals } = useSavingsGoals();
  const { currency } = useUserSettings();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K to toggle; Escape to close — matches vanilla 6407-6414.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'k') {
        ev.preventDefault();
        setOpen((o) => !o);
      } else if (ev.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus input when overlay opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [open]);

  const q = query.trim().toLowerCase();

  const matchedExpenses = useMemo(() => {
    if (q.length < 2) return [];
    return expenses
      .filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [q, expenses]);

  const matchedGoals = useMemo(() => {
    if (q.length < 2) return [];
    return goals
      .filter((g) => g.name.toLowerCase().includes(q))
      .slice(0, 3);
  }, [q, goals]);

  const hasResults = matchedExpenses.length + matchedGoals.length > 0;

  return (
    <>
      <button
        type="button"
        className="global-search-trigger"
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span style={{ flex: 1, textAlign: 'left' }}>
          Search expenses, goals, categories…
        </span>
        <span
          style={{
            fontSize: '0.7rem',
            padding: '2px 6px',
            background: 'currentColor',
            opacity: 0.15,
            borderRadius: 4,
            color: 'inherit',
          }}
        >
          ⌘K
        </span>
      </button>

      {open && (
        <div className="global-search-overlay" onClick={() => setOpen(false)}>
          <div className="global-search-box" onClick={(ev) => ev.stopPropagation()}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Search expenses, goals, categories…"
              className="global-search-input"
            />
            <div className="global-search-results">
              {q.length < 2 && (
                <div className="search-no-results">
                  Type at least 2 characters to search
                </div>
              )}

              {q.length >= 2 && !hasResults && (
                <div className="search-no-results">No matches for "{query}"</div>
              )}

              {matchedExpenses.length > 0 && (
                <>
                  <div className="search-result-group">Expenses</div>
                  {matchedExpenses.map((e) => {
                    const color =
                      CATEGORY_COLORS[e.category as Category] ?? '#6b7280';
                    return (
                      <div
                        key={e.id}
                        className="search-result-item"
                        onClick={() => {
                          setOpen(false);
                          navigate('/dashboard/expenses');
                        }}
                      >
                        <div
                          className="search-result-icon"
                          style={{ background: `${color}20`, color }}
                        />
                        <div className="search-result-info">
                          <div className="search-result-title">{e.description}</div>
                          <div className="search-result-meta">
                            {e.category} • {e.date}
                          </div>
                        </div>
                        <div className="search-result-amount">
                          {formatCurrency(e.amount, currency)}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {matchedGoals.length > 0 && (
                <>
                  <div className="search-result-group">Savings Goals</div>
                  {matchedGoals.map((g) => (
                    <div
                      key={g.id}
                      className="search-result-item"
                      onClick={() => {
                        setOpen(false);
                        navigate('/dashboard/savings');
                      }}
                    >
                      <div
                        className="search-result-icon"
                        style={{ background: 'rgba(16,185,129,0.15)' }}
                      >
                        🎯
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-title">{g.name}</div>
                        <div className="search-result-meta">
                          Goal: {formatCurrency(g.target_amount, currency)}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

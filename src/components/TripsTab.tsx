import { useCallback, useEffect, useState } from 'react';
import { TripModal } from '@/components/TripModal';
import { LinkBankAccountFlow } from '@/components/LinkBankAccountFlow';
import { useTrips } from '@/hooks/useTrips';
import { useTripExpenses } from '@/hooks/useTripExpenses';
import { useLinkedAccounts, type LinkedAccount } from '@/hooks/useLinkedAccounts';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { supabase } from '@/lib/supabase';
import { reportWriteFailure } from '@/lib/db';
import { CATEGORY_COLORS } from '@/lib/categories';
import { formatCurrency, getCurrencySymbol } from '@/lib/format';
import { exportExpensesToCSV, exportExpensesToPDF } from '@/lib/exports';
import type { Trip } from '@/types';

/**
 * Trips sub-tab of the Expenses page. Personal/Family only — the parent
 * page is responsible for not rendering this in Business mode.
 *
 * List view: create/delete trips, "needs review" badge per trip.
 * Detail view: business/personal split, per-expense sort prompt, CSV export.
 */
export function TripsTab() {
  const { user } = useAuth();
  const { currency, income } = useUserSettings();
  const { trips, loading, error, addTrip, deleteTrip } = useTrips();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});

  // Lightweight aggregate query for the "N to review" badge on each trip
  // card — avoids loading every trip's full expense list just for a count.
  const loadReviewCounts = useCallback(async () => {
    if (!user || trips.length === 0) {
      setReviewCounts({});
      return;
    }
    const { data } = await supabase
      .from('expenses')
      .select('trip_id')
      .eq('user_id', user.id)
      .is('business_expense', null)
      .not('trip_id', 'is', null);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { trip_id: string }[]) {
      counts[row.trip_id] = (counts[row.trip_id] ?? 0) + 1;
    }
    setReviewCounts(counts);
  }, [user, trips]);

  useEffect(() => {
    loadReviewCounts();
  }, [loadReviewCounts]);

  const selectedTrip = trips.find((t) => t.id === selectedTripId) ?? null;

  const handleDelete = async (trip: Trip) => {
    if (!confirm(`Delete "${trip.name}"? Its expenses stay, just untagged from the trip.`)) {
      return;
    }
    const res = await deleteTrip(trip.id);
    if (res.error) {
      alert(`Delete failed: ${res.error}`);
      return;
    }
    if (selectedTripId === trip.id) setSelectedTripId(null);
  };

  if (selectedTrip) {
    return (
      <TripDetail
        trip={selectedTrip}
        currency={currency}
        income={income}
        onBack={() => setSelectedTripId(null)}
      />
    );
  }

  return (
    <>
      <BusinessCardsSection />
      <div className="chart-card full-width trips-panel">
      <div className="trips-panel-header">
        <div>
          <h3>Trips</h3>
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
            Track spend for a trip, then sort business from personal later.
          </p>
        </div>
        <button type="button" className="btn-add" onClick={() => setModalOpen(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14m-7-7h14" />
          </svg>
          New Trip
        </button>
      </div>

      {error && (
        <p className="auth-error" style={{ padding: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p style={{ padding: 24, opacity: 0.4 }}>Loading…</p>
      ) : trips.length === 0 ? (
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
            <path d="M3 11l18-5v12L3 14v-3z" />
            <path d="M11.6 16.8L14 20" />
          </svg>
          <p>No trips yet</p>
          <button type="button" className="empty-action-btn" onClick={() => setModalOpen(true)}>
            Create a Trip
          </button>
        </div>
      ) : (
        <div className="trip-list">
          {trips.map((t) => {
            const reviewCount = reviewCounts[t.id] ?? 0;
            return (
              <div
                key={t.id}
                className="trip-card"
                onClick={() => setSelectedTripId(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') setSelectedTripId(t.id);
                }}
              >
                <div className="trip-card-main">
                  <div className="trip-card-name">{t.name}</div>
                  <div className="trip-card-dates">
                    {t.start_date} – {t.end_date}
                  </div>
                </div>
                <div className="trip-card-actions">
                  {reviewCount > 0 && (
                    <span className="trip-badge trip-badge-review">
                      {reviewCount} to review
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-delete"
                    aria-label={`Delete ${t.name}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleDelete(t);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TripModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={addTrip} />
      </div>
    </>
  );
}

/**
 * Company credit cards, scoped to Trips rather than the Bank page — the
 * checkbox/toggle version of this used to live on BankPage.tsx, but that
 * confused regular users who never travel for work. Every account linked
 * here is a business card by definition (LinkBankAccountFlow's
 * isBusinessCard=true); spend outside any trip's dates never renders
 * anywhere in the app (enforced at the DB trigger level).
 */
function BusinessCardsSection() {
  const { user } = useAuth();
  const { mode } = useMode();
  const { accounts, loading, refresh } = useLinkedAccounts();
  const businessCards = accounts.filter((a) => a.is_business === true);

  const handleRemove = async (acc: LinkedAccount) => {
    if (!user) return;
    if (!confirm('Remove this business card? Transaction history will be kept.')) return;
    // Silently failed before: the delete discarded both its error and its
    // result, so a blocked removal left the card linked while the list
    // re-rendered without it — the user only found out on their next visit.
    // .select() returns the rows actually deleted; none means nothing went.
    const { data, error } = await supabase
      .from('linked_accounts')
      .delete()
      .eq('id', acc.id)
      .eq('user_id', user.id)
      .select('id');
    if (error) {
      reportWriteFailure('remove this business card', error.message);
      return;
    }
    if (!data || data.length === 0) {
      reportWriteFailure(
        'remove this business card',
        'no matching card was removed. It may already have been unlinked.',
      );
      await refresh();
      return;
    }
    await refresh();
  };

  return (
    <div className="chart-card full-width trips-panel" style={{ marginBottom: 20 }}>
      <div className="trips-panel-header">
        <div>
          <h3>Business Cards</h3>
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
            Company credit cards for trip expenses. Spend outside a trip's dates
            never appears in the app.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <LinkBankAccountFlow mode={mode} isBusinessCard onLinked={refresh} />
        </div>
      </div>

      {loading ? (
        <p style={{ padding: '16px 0', opacity: 0.4 }}>Loading…</p>
      ) : businessCards.length === 0 ? (
        <p style={{ padding: '16px 0', opacity: 0.5, fontSize: '0.85rem' }}>
          No business cards linked yet.
        </p>
      ) : (
        <div className="trip-list">
          {businessCards.map((acc) => (
            <div key={acc.id} className="trip-card" style={{ cursor: 'default' }}>
              <div className="trip-card-main">
                <div className="trip-card-name">
                  {acc.institution_name || 'Bank'} ****{acc.mask}
                </div>
                <div className="trip-card-dates">{acc.account_name}</div>
              </div>
              <div className="trip-card-actions">
                <button
                  type="button"
                  className="btn-delete"
                  aria-label={`Remove ${acc.institution_name}`}
                  onClick={() => handleRemove(acc)}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TripDetailProps {
  trip: Trip;
  currency: string;
  income: number;
  onBack: () => void;
}

function TripDetail({ trip, currency, income, onBack }: TripDetailProps) {
  const { expenses, loading, error, setBusinessFlag, business, personal, reviewCount, total } =
    useTripExpenses(trip.id);

  const handleExportCSV = () => exportExpensesToCSV(expenses);
  const handleExportPDF = () =>
    exportExpensesToPDF({ expenses, income, currencySymbol: getCurrencySymbol(currency) });

  return (
    <div className="chart-card full-width trips-panel">
      <div className="trips-panel-header">
        <div>
          <button type="button" className="trip-back-btn" onClick={onBack}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            All Trips
          </button>
          <h3 style={{ margin: '10px 0 0' }}>{trip.name}</h3>
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
            {trip.start_date} – {trip.end_date}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn-export" onClick={handleExportCSV}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3" />
            </svg>
            Export CSV
          </button>
          <button type="button" className="btn-export" onClick={handleExportPDF}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Export PDF
          </button>
        </div>
      </div>

      <div className="trip-split">
        <div className="trip-split-item">
          <span className="trip-split-label">Business</span>
          <span className="trip-split-value">{formatCurrency(business, currency)}</span>
        </div>
        <div className="trip-split-item">
          <span className="trip-split-label">Personal</span>
          <span className="trip-split-value">{formatCurrency(personal, currency)}</span>
        </div>
        <div className="trip-split-item">
          <span className="trip-split-label">Total</span>
          <span className="trip-split-value">{formatCurrency(total, currency)}</span>
        </div>
        <div className="trip-split-item">
          <span className="trip-split-label">Needs review</span>
          <span className={`trip-split-value${reviewCount > 0 ? ' trip-split-value-warn' : ''}`}>
            {reviewCount}
          </span>
        </div>
      </div>

      {error && (
        <p className="auth-error" style={{ padding: 16 }}>
          {error}
        </p>
      )}

      <div className="table-wrap">
        {loading ? (
          <p style={{ padding: 24, opacity: 0.4 }}>Loading…</p>
        ) : expenses.length === 0 ? (
          <div className="empty-state">
            <p>No expenses tagged to this trip yet</p>
          </div>
        ) : (
          <table className="expense-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                const color = CATEGORY_COLORS[e.category] ?? '#6b7280';
                return (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td>
                      <span className="category-badge" style={{ background: `${color}20`, color }}>
                        {e.category}
                      </span>
                    </td>
                    <td>{e.description}</td>
                    <td>{formatCurrency(e.amount, currency)}</td>
                    <td>
                      {e.business_expense === null ? (
                        <div className="trip-review-prompt">
                          <span>Business or personal?</span>
                          <button
                            type="button"
                            className="trip-review-btn"
                            onClick={async () => {
                              // Previously discarded: a failed write reverted
                              // the optimistic row with no message at all.
                              const res = await setBusinessFlag(e.id, true);
                              if (res.error) {
                                reportWriteFailure('mark this expense as business', res.error);
                              }
                            }}
                          >
                            Business
                          </button>
                          <button
                            type="button"
                            className="trip-review-btn"
                            onClick={async () => {
                              const res = await setBusinessFlag(e.id, false);
                              if (res.error) {
                                reportWriteFailure('mark this expense as personal', res.error);
                              }
                            }}
                          >
                            Personal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`trip-type-badge ${e.business_expense ? 'is-business' : 'is-personal'}`}
                          onClick={async () => {
                            const res = await setBusinessFlag(e.id, null);
                            if (res.error) {
                              reportWriteFailure('put this expense back into review', res.error);
                            }
                          }}
                          title="Click to mark for review again"
                        >
                          {e.business_expense ? 'Business' : 'Personal'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

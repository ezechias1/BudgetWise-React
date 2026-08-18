import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ok, reportWriteFailure } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';
import {
  parseBankStatementCsv,
  type ParsedTransaction,
} from '@/lib/csv-import';
import { useCategories } from '@/hooks/useCategories';
import {
  useLinkedAccounts,
  type LinkedAccount,
} from '@/hooks/useLinkedAccounts';
import { LinkBankAccountFlow } from '@/components/LinkBankAccountFlow';

// ==========================================================================
// Ported from vanilla dashboard.html (#page-bank, line 1165) and js/app.js
// bank connection flows (loadLinkedAccounts, renderBankCards). Plaid and
// Salt Edge were never wired to working server-side pieces and have been
// removed — Stitch (South Africa) is the only live connection provider.
// Business-card linking (Stitch region picker, manual SA form, "is this a
// business card" checkbox) lives in LinkBankAccountFlow.tsx and is only
// rendered from the Trips tab now — regular Bank page users never travel
// for work and shouldn't see that option here.
// ==========================================================================

// ==========================================================================
// Bank connection kill switch.
//
// FALSE because no provider is actually wired up end to end. The connect
// flow calls the `stitch-link-initiate` edge function, and that function has
// never been deployed to the live project — the only stitch functions that
// exist there are the older `stitch-link-token` / `stitch-exchange-token`
// pair, which nothing in this codebase calls. `stitch-oauth-callback` and
// `stitch-sync-transactions` are undeployed too, so even a successful link
// would never sync. "Add Account" → region picker → South Africa therefore
// ended in an error alert every single time. Bank linking is the feature
// people judge a finance app on, so the page now says "coming soon" instead
// of failing at the last step.
//
// Flip back to true when ALL of these hold:
//   1. stitch-link-initiate, stitch-oauth-callback and
//      stitch-sync-transactions are deployed to the live Supabase project.
//   2. Stitch Connect credentials are configured on them and the OAuth
//      callback redirect is registered for the production domain.
//   3. A real account can be linked end to end and lands in linked_accounts
//      with provider = 'stitch'.
//
// Flipping it is the only change needed: the connect copy, the provider
// strip and LinkBankAccountFlow are all still here, untouched. Note this
// gate covers the Bank page only — the Trips tab renders its own
// LinkBankAccountFlow for business cards.
// ==========================================================================
const BANK_CONNECT_ENABLED = false;

const PROVIDER_STRIP = [
  'Stitch',
  'Mono',
  'Belvo',
  'Basiq',
  'Setu',
  'Lean',
  'Brankas',
  'Moneytree',
];

// =============================================================================
// Main component
// =============================================================================
export default function BankPage() {
  const { user } = useAuth();
  const { mode } = useMode();
  const { currency } = useUserSettings();
  const {
    accounts: linkedAccounts,
    loading,
    primaryAccount,
    totalBalance,
    setPrimary,
    refresh: loadLinkedAccounts,
  } = useLinkedAccounts();

  const fmt = useCallback(
    (n: number) => formatCurrency(n, currency),
    [currency]
  );

  // Stitch accounts sync automatically on a schedule (cron-driven, see
  // supabase/functions/stitch-sync-transactions) — there's no safe
  // client-invokable "sync now" action since that function is protected by
  // a server-only shared secret, not a user JWT. Manual/legacy accounts
  // still get the balance-entry "Update" flow below.
  const handleSync = async () => {
    alert('Stitch accounts sync automatically every 15–30 minutes.');
  };

  const handleUpdateBalance = async (acc: LinkedAccount) => {
    if (!user) return;
    const newBalance = prompt('Enter updated balance:');
    if (newBalance === null || isNaN(parseFloat(newBalance))) return;
    // Silently failed before: a rejected update still refreshed the cards,
    // so the balance snapped back to the old figure with no explanation.
    const updated = await ok(
      supabase
        .from('linked_accounts')
        .update({
          balance_current: parseFloat(newBalance),
          balance_available: parseFloat(newBalance),
          last_synced: new Date().toISOString(),
        })
        .eq('id', acc.id)
        .eq('user_id', user.id),
      'update this balance',
    );
    if (!updated) return;
    await loadLinkedAccounts();
  };

  const handleRemove = async (acc: LinkedAccount) => {
    if (!user) return;
    if (!confirm('Remove this account? Transaction history will be kept.')) return;
    // Silently failed before: the delete discarded both its error and its
    // result, so a blocked removal left the account linked while the card
    // disappeared until the next visit. .select() returns the rows actually
    // deleted — none means nothing went.
    const { data, error } = await supabase
      .from('linked_accounts')
      .delete()
      .eq('id', acc.id)
      .eq('user_id', user.id)
      .select('id');
    if (error) {
      reportWriteFailure('remove this account', error.message);
      return;
    }
    if (!data || data.length === 0) {
      reportWriteFailure(
        'remove this account',
        'no matching account was removed. It may already have been unlinked.',
      );
      await loadLinkedAccounts();
      return;
    }
    await loadLinkedAccounts();
  };

  const hasAccounts = linkedAccounts.length > 0;

  // ===========================================================================
  // CSV bank statement import (manual "auto-import" while Stitch is pending)
  // ===========================================================================
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  // 'business' = a company credit card statement — every imported row is
  // pre-marked business_expense:true (no per-row review popup, since
  // choosing this import type already answers the question for the whole
  // batch); still auto-tags to a trip by date normally. Personal/Family only.
  const [csvImportKind, setCsvImportKind] = useState<'personal' | 'business'>('personal');
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvPreview, setCsvPreview] = useState<ParsedTransaction[]>([]);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState(0);
  const [csvSuccess, setCsvSuccess] = useState<number | null>(null);
  const [csvFailedRows, setCsvFailedRows] = useState<
    Array<{ row: number; description: string; error: string }>
  >([]);

  // Same list the rest of the app offers, so a category you made yourself is
  // selectable while correcting rows in the import preview. Keyed on the
  // current mode exactly as categoryOptionsForMode(mode) was.
  const { categories: csvCategoryOptions } = useCategories();

  const csvTotalAmount = useMemo(
    () => csvPreview.reduce((sum, t) => sum + t.amount, 0),
    [csvPreview]
  );

  const resetCsvState = () => {
    setCsvPreview([]);
    setCsvSkipped(0);
    setCsvError(null);
    setCsvSuccess(null);
    setCsvFailedRows([]);
    setCsvProgress(0);
    setCsvFileName('');
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const handleCsvFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    setCsvSuccess(null);
    setCsvFailedRows([]);
    setCsvFileName(file.name);
    try {
      const text = await file.text();
      const result = parseBankStatementCsv(text, mode);
      if (result.transactions.length === 0) {
        setCsvPreview([]);
        setCsvSkipped(result.skippedCount);
        setCsvError(
          'No expense rows found. Make sure the file has Date, Description, and Amount/Debit columns.'
        );
        return;
      }
      setCsvPreview(result.transactions);
      setCsvSkipped(result.skippedCount);
    } catch (err) {
      setCsvError('Could not read file: ' + (err as Error).message);
    }
  };

  const updatePreviewCategory = (index: number, category: string) => {
    setCsvPreview((prev) =>
      prev.map((t, i) => (i === index ? { ...t, category } : t))
    );
  };

  const removePreviewRow = (index: number) => {
    setCsvPreview((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCsvImport = async () => {
    if (!user || csvPreview.length === 0) return;
    setCsvImporting(true);
    setCsvProgress(0);
    setCsvSuccess(null);
    setCsvFailedRows([]);

    const failed: Array<{ row: number; description: string; error: string }> = [];
    let successCount = 0;

    const isBusinessImport = csvImportKind === 'business' && mode !== 'business';
    for (let i = 0; i < csvPreview.length; i++) {
      const tx = csvPreview[i];
      const { error } = await supabase.from('expenses').insert({
        user_id: user.id,
        account_mode: mode,
        category: tx.category,
        description: tx.description,
        amount: tx.amount,
        date: tx.date,
        recurring: 'no',
        ...(isBusinessImport ? { business_expense: true } : {}),
      });
      if (error) {
        failed.push({
          row: i + 1,
          description: tx.description,
          error: error.message,
        });
      } else {
        successCount++;
      }
      setCsvProgress(i + 1);
    }

    setCsvImporting(false);
    setCsvSuccess(successCount);
    setCsvFailedRows(failed);
  };

  // =============================================================================
  // Render
  // =============================================================================
  return (
    <section className="page active" id="page-bank">
      <div className="page-header">
        <div>
          <h1>
            Bank Connect <span className="beta-tag">Beta</span>
          </h1>
          <p className="page-subtitle">
            {BANK_CONNECT_ENABLED
              ? 'Link your bank for automatic expense tracking'
              : 'Add an account manually or import a CSV statement — automatic bank links are coming soon'}
          </p>
        </div>
        <div className="header-actions">
          {/* No provider is wired while BANK_CONNECT_ENABLED is false, so the
              "Add Account" picker is hidden via a prop rather than CSS —
              "Add Manually" and CSV import are real and stay available. */}
          <LinkBankAccountFlow
            mode={mode}
            isBusinessCard={false}
            onLinked={loadLinkedAccounts}
            showConnect={BANK_CONNECT_ENABLED}
          />
        </div>
      </div>

      {/* Persistent "not live yet" notice.
          The fuller explanation lives in the empty state below, but that only
          renders when the user has no accounts — so anyone who already added
          one manually (common in Personal mode) never saw it, and had no way
          to know automatic linking isn't available. Shown in every mode. */}
      {!BANK_CONNECT_ENABLED && hasAccounts && (
        <div className="bank-coming-soon-note" role="status">
          <strong>Automatic bank connections aren&rsquo;t live yet.</strong>{' '}
          We&rsquo;re still working through provider approvals. For now, add
          accounts manually or import a CSV statement from your bank &mdash;
          both work fully.
        </div>
      )}

      {/* Total Balance Banner */}
      {hasAccounts && (
        <div className="bank-balance-banner" id="bankBalanceBanner">
          <div className="balance-label">Total Balance</div>
          <div className="balance-amount" id="totalBankBalance">
            {fmt(totalBalance)}
          </div>
          <div className="balance-sub" id="bankAccountCount">
            {linkedAccounts.length} account
            {linkedAccounts.length !== 1 ? 's' : ''} linked
            {primaryAccount && (
              <span style={{ marginLeft: 8, color: '#10b981' }}>
                · Main: {primaryAccount.institution_name} ****{primaryAccount.mask}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bank Cards Grid */}
      <div className="bank-cards-grid" id="bankCardsGrid">
        {linkedAccounts.map((acc) => {
          let cardType = 'checking';
          if (acc.account_subtype === 'savings') cardType = 'savings-card';
          else if (
            acc.account_subtype === 'credit card' ||
            acc.account_type === 'credit'
          )
            cardType = 'credit';

          const mask = acc.mask || '****';
          const dots = `\u2022\u2022\u2022\u2022  \u2022\u2022\u2022\u2022  \u2022\u2022\u2022\u2022  ${mask}`;
          const isStitch = acc.provider === 'stitch';
          const isManual = !isStitch;

          const isPrimary = acc.is_primary === true;

          return (
            <div className={'bank-card ' + cardType} key={acc.id} style={isPrimary ? { border: '2px solid #10b981' } : undefined}>
              <div className="bank-card-top">
                <span className="bank-card-institution">
                  {acc.institution_name || 'Bank'}
                  {isPrimary && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        background: 'rgba(16,185,129,0.2)',
                        color: '#10b981',
                        padding: '2px 8px',
                        borderRadius: 6,
                        verticalAlign: 'middle',
                      }}
                    >
                      ★ Main
                    </span>
                  )}
                </span>
                <span className="bank-card-type">{acc.account_subtype}</span>
              </div>
              <div className="bank-card-number">{dots}</div>
              <div className="bank-card-bottom">
                <div>
                  <div className="bank-card-balance-label">
                    {acc.account_type === 'credit' ? 'Balance Owed' : 'Available'}
                  </div>
                  <div className="bank-card-balance">
                    {fmt(acc.balance_current || 0)}
                  </div>
                </div>
                <div className="bank-card-actions">
                  {isManual ? (
                    <button
                      className="btn-update-balance"
                      data-id={acc.id}
                      onClick={() => handleUpdateBalance(acc)}
                    >
                      Update
                    </button>
                  ) : (
                    <button
                      className="btn-sync"
                      data-id={acc.id}
                      onClick={() => handleSync()}
                    >
                      Sync
                    </button>
                  )}
                  {!isPrimary && (
                    <button
                      className="btn-set-primary"
                      onClick={() => setPrimary(acc.id)}
                    >
                      ★ Set Main
                    </button>
                  )}
                  <button
                    className="btn-remove"
                    data-id={acc.id}
                    onClick={() => handleRemove(acc)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state / How it works */}
      {!hasAccounts && !loading && (
        <div id="bankEmptyState" className="bank-connect-grid">
          <div className="chart-card full-width bank-hero-card">
            <div className="bank-hero">
              <svg
                viewBox="0 0 24 24"
                width="56"
                height="56"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.6"
              >
                <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3" />
              </svg>
              {BANK_CONNECT_ENABLED ? (
                <>
                  <h3>Connect Your Bank Account</h3>
                  <p>
                    Link your bank to automatically import transactions. We support
                    banks across 5 regions worldwide.
                  </p>
                </>
              ) : (
                <>
                  <h3>
                    Connect Your Bank Account{' '}
                    <span className="beta-tag">Coming Soon</span>
                  </h3>
                  <p>
                    Automatic bank connections are not available yet. We are
                    still working through provider approvals, and we would
                    rather say so here than send you to a bank login that
                    cannot finish.
                  </p>
                  <p>
                    What works today: <strong>Add Manually</strong> at the top
                    of this page to add an account and keep its balance up to
                    date, or <strong>Import CSV Bank Statement</strong> below
                    to bring in transactions from your bank's own download.
                  </p>
                </>
              )}
            </div>
            {!BANK_CONNECT_ENABLED && (
              <p
                style={{
                  textAlign: 'center',
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  opacity: 0.4,
                  margin: '20px 0 -12px',
                }}
              >
                Providers we plan to support
              </p>
            )}
            <div className="bank-providers-strip">
              {PROVIDER_STRIP.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </div>

          <div className="chart-card full-width bank-info-card">
            <h3>{BANK_CONNECT_ENABLED ? 'How It Works' : 'How It Will Work'}</h3>
            {!BANK_CONNECT_ENABLED && (
              <p style={{ fontSize: '0.85rem', opacity: 0.55, margin: '4px 0 0' }}>
                Linking will take three steps once connections are switched on.
                None of it is live yet.
              </p>
            )}
            <div className="bank-steps">
              <div className="bank-step">
                <div className="bank-step-num">1</div>
                <div>
                  <strong>Choose Region</strong>
                  <p>
                    Select your region to connect with the right banking
                    provider
                  </p>
                </div>
              </div>
              <div className="bank-step">
                <div className="bank-step-num">2</div>
                <div>
                  <strong>Link Your Bank</strong>
                  <p>
                    Securely log in to your bank through an encrypted portal
                  </p>
                </div>
              </div>
              <div className="bank-step">
                <div className="bank-step-num">3</div>
                <div>
                  <strong>Auto-Import</strong>
                  <p>
                    Transactions are categorized and added to your expenses
                    automatically
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          CSV bank statement import section — manual "auto-import" for SA
          while we wait on Stitch Connect API approval.
          ===================================================================== */}
      <div
        className="chart-card full-width"
        id="csvImportCard"
        style={{ marginTop: 24 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>
              Import CSV Bank Statement{' '}
              <span className="beta-tag">Beta</span>
            </h3>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '0.85rem',
                opacity: 0.6,
              }}
            >
              Upload a CSV from FNB, Capitec, Standard Bank, Absa, Nedbank, TymeBank or Bidvest.
              We auto-detect columns and categorize each transaction.
            </p>
            {mode !== 'business' && (
              <div className="csv-import-kind-toggle">
                <button
                  type="button"
                  className={csvImportKind === 'personal' ? 'active' : ''}
                  onClick={() => setCsvImportKind('personal')}
                >
                  My Own Statement
                </button>
                <button
                  type="button"
                  className={csvImportKind === 'business' ? 'active' : ''}
                  onClick={() => setCsvImportKind('business')}
                >
                  Business Credit Card Statement
                </button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFile}
              style={{ display: 'none' }}
              id="csvFileInput"
            />
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => csvInputRef.current?.click()}
              disabled={csvImporting}
            >
              {csvPreview.length > 0 ? 'Choose Different File' : 'Choose CSV File'}
            </button>
            {(csvPreview.length > 0 || csvError || csvSuccess !== null) && (
              <button
                type="button"
                className="btn-sm"
                onClick={resetCsvState}
                disabled={csvImporting}
                style={{
                  background: 'transparent',
                  border: '1px solid currentColor',
                  opacity: 0.6,
                  borderRadius: 6,
                  padding: '6px 12px',
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {csvFileName && (
          <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: 8 }}>
            File: <strong>{csvFileName}</strong>
            {csvSkipped > 0 && (
              <>
                {' — '}
                {csvSkipped} row{csvSkipped !== 1 ? 's' : ''} skipped (credits,
                empty, or zero-amount)
              </>
            )}
          </p>
        )}

        {csvError && (
          <div
            className="alert"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              padding: 12,
              borderRadius: 8,
              fontSize: '0.85rem',
              marginBottom: 12,
            }}
          >
            {csvError}
          </div>
        )}

        {csvSuccess !== null && (
          <div
            className="alert"
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#10b981',
              padding: 12,
              borderRadius: 8,
              fontSize: '0.9rem',
              marginBottom: 12,
            }}
          >
            <strong>
              Imported {csvSuccess} transaction{csvSuccess !== 1 ? 's' : ''}.
            </strong>{' '}
            <Link
              to="/expenses"
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              View in Expenses →
            </Link>
            {csvFailedRows.length > 0 && (
              <div style={{ marginTop: 8, color: '#ef4444' }}>
                <strong>
                  {csvFailedRows.length} row
                  {csvFailedRows.length !== 1 ? 's' : ''} failed:
                </strong>
                <ul style={{ margin: '6px 0 0 20px', fontSize: '0.8rem' }}>
                  {csvFailedRows.slice(0, 10).map((f) => (
                    <li key={f.row}>
                      Row {f.row} — {f.description}: {f.error}
                    </li>
                  ))}
                  {csvFailedRows.length > 10 && (
                    <li>…and {csvFailedRows.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {csvPreview.length > 0 && csvSuccess === null && (
          <>
            <div
              style={{
                overflowX: 'auto',
                border: '1px solid rgba(128,128,128,0.2)',
                borderRadius: 8,
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.85rem',
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: 'rgba(128,128,128,0.08)',
                      textAlign: 'left',
                    }}
                  >
                    <th style={{ padding: '8px 10px' }}>Date</th>
                    <th style={{ padding: '8px 10px' }}>Description</th>
                    <th style={{ padding: '8px 10px' }}>Category</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>
                      Amount
                    </th>
                    <th style={{ padding: '8px 10px', width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.slice(0, 20).map((tx, i) => (
                    <tr
                      key={i}
                      style={{
                        borderTop: '1px solid rgba(128,128,128,0.15)',
                      }}
                    >
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                        {tx.date}
                      </td>
                      <td
                        style={{
                          padding: '6px 10px',
                          maxWidth: 280,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={tx.description}
                      >
                        {tx.description}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <select
                          className="quick-input"
                          value={tx.category}
                          onChange={(e) =>
                            updatePreviewCategory(i, e.target.value)
                          }
                          style={{
                            padding: '4px 6px',
                            fontSize: '0.8rem',
                            minWidth: 140,
                          }}
                        >
                          {csvCategoryOptions.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        style={{
                          padding: '6px 10px',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fmt(tx.amount)}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <button
                          type="button"
                          onClick={() => removePreviewRow(i)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            opacity: 0.5,
                            cursor: 'pointer',
                            fontSize: '1rem',
                          }}
                          aria-label="Remove row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 12,
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                {csvPreview.length > 20 && (
                  <span>
                    Showing first 20 of {csvPreview.length} rows.{' '}
                  </span>
                )}
                <strong>{csvPreview.length}</strong> transaction
                {csvPreview.length !== 1 ? 's' : ''} · Total{' '}
                <strong>{fmt(csvTotalAmount)}</strong>
                {csvImportKind === 'business' && mode !== 'business' && (
                  <div style={{ marginTop: 4, opacity: 0.6 }}>
                    Every row will be marked Business immediately — no review needed.
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCsvImport}
                disabled={csvImporting || csvPreview.length === 0}
              >
                {csvImporting
                  ? `Importing ${csvProgress} / ${csvPreview.length}...`
                  : `Import ${csvPreview.length} Transaction${
                      csvPreview.length !== 1 ? 's' : ''
                    }`}
              </button>
            </div>

            {csvImporting && (
              <div
                style={{
                  marginTop: 12,
                  height: 6,
                  background: 'rgba(128,128,128,0.15)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${
                      (csvProgress / Math.max(csvPreview.length, 1)) * 100
                    }%`,
                    background: 'var(--accent, #10b981)',
                    transition: 'width 120ms linear',
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

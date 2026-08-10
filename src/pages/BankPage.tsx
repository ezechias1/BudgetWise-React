import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';
import {
  parseBankStatementCsv,
  categoryOptionsForMode,
  type ParsedTransaction,
} from '@/lib/csv-import';
import {
  useLinkedAccounts,
  type LinkedAccount,
} from '@/hooks/useLinkedAccounts';

// ==========================================================================
// Ported from vanilla dashboard.html (#page-bank, line 1165) and js/app.js
// bank connection flows (loadLinkedAccounts, renderBankCards). Plaid and
// Salt Edge were never wired to working server-side pieces and have been
// removed — Stitch (South Africa) is the only live connection provider.
// ==========================================================================

interface RegionOption {
  provider: string;
  ready: boolean;
  manual?: boolean;
  flag: string;
  title: string;
  providerLabel: string;
  banks: string;
}

// Stitch is the only real, live connection provider — this app is
// South-Africa-focused and Plaid/Salt Edge never had working server-side
// pieces (their edge functions don't exist). The rest stay as decorative
// "coming soon" placeholders.
const REGIONS: RegionOption[] = [
  {
    provider: 'stitch',
    ready: true,
    flag: '🇿🇦',
    title: 'South Africa',
    providerLabel: 'Powered by Stitch',
    banks: 'FNB, Capitec, Standard Bank, Absa, Nedbank',
  },
  {
    provider: 'mono',
    ready: false,
    flag: '🇳🇬 🇬🇭 🇰🇪',
    title: 'Nigeria, Ghana & Kenya',
    providerLabel: 'Powered by Mono',
    banks: 'GTBank, Access, Zenith, Ecobank, M-Pesa',
  },
  {
    provider: 'belvo',
    ready: false,
    flag: '🇧🇷 🇲🇽 🇨🇴',
    title: 'Brazil, Mexico & Colombia',
    providerLabel: 'Powered by Belvo',
    banks: 'Nubank, BBVA, Bancolombia, Itau',
  },
  {
    provider: 'basiq',
    ready: false,
    flag: '🇦🇺 🇳🇿',
    title: 'Australia & New Zealand',
    providerLabel: 'Powered by Basiq',
    banks: 'CommBank, ANZ, Westpac, ASB',
  },
  {
    provider: 'setu',
    ready: false,
    flag: '🇮🇳',
    title: 'India',
    providerLabel: 'Powered by Setu',
    banks: 'SBI, HDFC, ICICI, Axis, Kotak, PNB, UPI',
  },
  {
    provider: 'lean',
    ready: false,
    flag: '🇦🇪 🇸🇦 🇧🇭 🇴🇲 🇰🇼 🇶🇦',
    title: 'Middle East',
    providerLabel: 'Powered by Lean Technologies',
    banks: 'Emirates NBD, Al Rajhi, FAB, Mashreq, KFH',
  },
  {
    provider: 'brankas',
    ready: false,
    flag: '🇸🇬 🇵🇭 🇮🇩 🇹🇭 🇻🇳',
    title: 'Southeast Asia',
    providerLabel: 'Powered by Brankas',
    banks: 'DBS, BDO, BCA, GCash, GrabPay, OVO',
  },
  {
    provider: 'moneytree',
    ready: false,
    flag: '🇯🇵 🇰🇷 🇹🇼 🇭🇰',
    title: 'East Asia',
    providerLabel: 'Powered by Moneytree',
    banks: 'MUFG, Mizuho, SMBC, Shinhan, Cathay, HSBC HK',
  },
  {
    provider: 'mono-ext',
    ready: false,
    flag: '🇹🇿 🇺🇬 🇷🇼 🇪🇬 🇲🇦 🇨🇮',
    title: 'Rest of Africa',
    providerLabel: 'Powered by Mono',
    banks: 'M-Pesa, Equity Bank, CIB Egypt, Attijariwafa, Ecobank',
  },
];

interface SABank {
  name: string;
  full: string;
  color: string;
  initial: string;
}

// Verbatim from dashboard.html lines 1303-1327.
const SA_BANKS: SABank[] = [
  { name: 'FNB', full: 'First National Bank', color: '#009639', initial: 'F' },
  { name: 'Capitec', full: 'Capitec Bank', color: '#0033a0', initial: 'C' },
  {
    name: 'Standard Bank',
    full: 'The Standard Bank of SA',
    color: '#0038a8',
    initial: 'S',
  },
  { name: 'Absa', full: 'Absa Group Limited', color: '#af0028', initial: 'A' },
  { name: 'Nedbank', full: 'Nedbank Group', color: '#009946', initial: 'N' },
];

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
    toggleBusinessCard,
    refresh: loadLinkedAccounts,
  } = useLinkedAccounts();

  const [connecting, setConnecting] = useState(false);

  const [showRegionModal, setShowRegionModal] = useState(false);
  const [showSAModal, setShowSAModal] = useState(false);
  const [regionSearch, setRegionSearch] = useState('');
  const [saSearch, setSaSearch] = useState('');
  const [selectedSABank, setSelectedSABank] = useState<string>('');
  const [saAccountName, setSaAccountName] = useState('');
  const [saAccountType, setSaAccountType] = useState('cheque');
  const [saBalance, setSaBalance] = useState('');
  // "This is a business card" — set at add-time so a company card can be
  // flagged immediately instead of requiring a separate toggle afterward.
  const [addAsBusinessCard, setAddAsBusinessCard] = useState(false);

  const fmt = useCallback(
    (n: number) => formatCurrency(n, currency),
    [currency]
  );

  // ---- Provider connect handlers ----
  // Stitch's hosted Link flow: get a consent URL from our edge function
  // (user-JWT authenticated) and redirect. The OAuth callback function does
  // the token exchange + linked_accounts insert server-side, then redirects
  // back here with ?stitch_linked=1 — see the effect below.
  const openStitchLink = useCallback(async () => {
    if (!user) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('stitch-link-initiate', {
        body: { mode, isBusinessCard: addAsBusinessCard },
      });
      if (error || !data?.authorize_url) {
        alert(
          'Error connecting to Stitch: ' +
            (data?.error || error?.message || 'Please try again.')
        );
        return;
      }
      window.location.href = data.authorize_url;
    } catch (err) {
      alert('Connection error: ' + (err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [user, mode, addAsBusinessCard]);

  // Handle the Stitch OAuth callback redirect — the account itself was
  // already inserted server-side, so this just refreshes the list.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('stitch_linked')) return;
    window.history.replaceState({}, '', window.location.pathname);
    loadLinkedAccounts();
  }, [loadLinkedAccounts]);

  const handleRegionClick = (r: RegionOption) => {
    if (!r.ready) {
      alert(
        'This region is coming soon! We are working on integrating ' +
          r.title +
          '. Stay tuned.'
      );
      return;
    }
    setShowRegionModal(false);
    if (r.provider === 'stitch') openStitchLink();
  };

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
    await supabase
      .from('linked_accounts')
      .update({
        balance_current: parseFloat(newBalance),
        balance_available: parseFloat(newBalance),
        last_synced: new Date().toISOString(),
      })
      .eq('id', acc.id)
      .eq('user_id', user.id);
    await loadLinkedAccounts();
  };

  const handleRemove = async (acc: LinkedAccount) => {
    if (!user) return;
    if (!confirm('Remove this account? Transaction history will be kept.')) return;
    await supabase
      .from('linked_accounts')
      .delete()
      .eq('id', acc.id)
      .eq('user_id', user.id);
    await loadLinkedAccounts();
  };

  // ---- SA manual account submit (app.js L5247) ----
  const handleSASubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !selectedSABank) return;
    const bal = parseFloat(saBalance) || 0;
    const { error } = await supabase.from('linked_accounts').insert({
      user_id: user.id,
      plaid_access_token: 'manual',
      account_id: 'manual-' + Date.now(),
      account_name: saAccountName || selectedSABank,
      account_type: saAccountType === 'credit' ? 'credit' : 'depository',
      account_subtype: saAccountType,
      institution_name: selectedSABank,
      mask: '****',
      balance_current: bal,
      balance_available: bal,
      currency_code: 'ZAR',
      last_synced: new Date().toISOString(),
      account_mode: mode,
      is_business_card: mode !== 'business' && addAsBusinessCard,
    });
    if (error) {
      alert('Error adding account: ' + error.message);
      return;
    }
    setShowSAModal(false);
    setSelectedSABank('');
    setSaAccountName('');
    setSaAccountType('cheque');
    setSaBalance('');
    await loadLinkedAccounts();
  };

  // ---- Filtered lists for modal searches ----
  const filteredRegions = useMemo(() => {
    const q = regionSearch.trim().toLowerCase();
    if (!q) return REGIONS;
    return REGIONS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.banks.toLowerCase().includes(q) ||
        r.providerLabel.toLowerCase().includes(q)
    );
  }, [regionSearch]);

  const filteredSABanks = useMemo(() => {
    const q = saSearch.trim().toLowerCase();
    if (!q) return SA_BANKS;
    return SA_BANKS.filter(
      (b) =>
        b.name.toLowerCase().includes(q) || b.full.toLowerCase().includes(q)
    );
  }, [saSearch]);

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

  const csvCategoryOptions = useMemo(
    () => categoryOptionsForMode(mode),
    [mode]
  );

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
            Link your bank for automatic expense tracking
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-export"
            onClick={() => {
              setAddAsBusinessCard(false);
              setShowSAModal(true);
            }}
          >
            Add Manually
          </button>
          <button
            className="btn-primary btn-sm"
            id="connectBankBtn"
            onClick={() => {
              setAddAsBusinessCard(false);
              setShowRegionModal(true);
            }}
            disabled={connecting}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14m-7-7h14" />
            </svg>
            {connecting ? 'Connecting...' : 'Add Account'}
          </button>
        </div>
      </div>

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
                      style={{
                        background: 'rgba(16,185,129,0.1)',
                        color: '#10b981',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
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
              {isStitch && mode !== 'business' && (
                <div className="bank-card-business-toggle">
                  <span>Business card</span>
                  <label className="tithe-toggle">
                    <input
                      type="checkbox"
                      checked={acc.is_business_card === true}
                      onChange={(e) => toggleBusinessCard(acc.id, e.target.checked)}
                    />
                    <span className="tithe-slider" />
                  </label>
                </div>
              )}
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
              <h3>Connect Your Bank Account</h3>
              <p>
                Link your bank to automatically import transactions. We support
                banks across 5 regions worldwide.
              </p>
            </div>
            <div className="bank-providers-strip">
              {PROVIDER_STRIP.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </div>

          <div className="chart-card full-width bank-info-card">
            <h3>How It Works</h3>
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
              Upload a CSV from FNB, Capitec, Standard Bank, Absa or Nedbank.
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

      {/* Region Selector Modal */}
      {showRegionModal && (
        <div className="modal-overlay" id="regionModal">
          <div className="modal">
            <div className="modal-header">
              <h2>Select Your Region</h2>
              <button
                className="modal-close"
                onClick={() => setShowRegionModal(false)}
              >
                ×
              </button>
            </div>
            <p
              style={{
                color: 'inherit', opacity: 0.4,
                marginBottom: 16,
                fontSize: '0.85rem',
              }}
            >
              Choose your region or search for your bank.
            </p>
            <div className="bank-search-wrap" style={{ marginBottom: 16 }}>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: 0.3,
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                className="quick-input"
                placeholder="Search for your bank..."
                style={{ paddingLeft: 36, width: '100%' }}
                value={regionSearch}
                onChange={(e) => setRegionSearch(e.target.value)}
              />
            </div>
            {mode !== 'business' && (
              <label className="bank-business-card-check">
                <input
                  type="checkbox"
                  checked={addAsBusinessCard}
                  onChange={(e) => setAddAsBusinessCard(e.target.checked)}
                />
                This is a business credit card (for trip expenses)
              </label>
            )}
            {regionSearch && filteredRegions.length === 0 && (
              <p
                className="bank-search-result"
                style={{
                  color: 'inherit', opacity: 0.5,
                  fontSize: '0.8rem',
                  marginBottom: 12,
                }}
              >
                No regions matched "{regionSearch}".
              </p>
            )}
            <div className="region-grid">
              {filteredRegions.map((r) => (
                <button
                  key={r.provider}
                  className={
                    'region-card ' + (r.ready ? 'region-ready' : 'region-soon')
                  }
                  data-provider={r.provider}
                  onClick={() => handleRegionClick(r)}
                >
                  <span
                    className={
                      'region-status ' + (r.ready ? 'ready' : 'soon')
                    }
                  >
                    {r.ready ? (r.manual ? 'Manual Entry' : 'Ready') : 'Coming Soon'}
                  </span>
                  <div className="region-flag">{r.flag}</div>
                  <strong>{r.title}</strong>
                  <span className="region-provider">{r.providerLabel}</span>
                  <span className="region-banks">{r.banks}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SA Bank Modal */}
      {showSAModal && (
        <div className="modal-overlay" id="saBankModal">
          <div className="modal">
            <div className="modal-header">
              <h2>Add South African Bank</h2>
              <button
                className="modal-close"
                onClick={() => {
                  setShowSAModal(false);
                  setSelectedSABank('');
                }}
              >
                ×
              </button>
            </div>
            <p
              style={{
                color: 'inherit', opacity: 0.4,
                marginBottom: 16,
                fontSize: '0.85rem',
              }}
            >
              Select your bank, then enter your account details.
            </p>
            <div className="bank-search-wrap" style={{ marginBottom: 12 }}>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: 0.3,
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                className="quick-input"
                placeholder="Search SA banks..."
                style={{ paddingLeft: 36, width: '100%' }}
                value={saSearch}
                onChange={(e) => setSaSearch(e.target.value)}
              />
            </div>
            <div className="sa-bank-list">
              {filteredSABanks.map((b) => (
                <button
                  key={b.name}
                  className={
                    'sa-bank-btn' +
                    (selectedSABank === b.name ? ' selected' : '')
                  }
                  data-bank={b.name}
                  onClick={() => setSelectedSABank(b.name)}
                  type="button"
                >
                  <span
                    className="sa-bank-logo"
                    style={{ background: b.color }}
                  >
                    {b.initial}
                  </span>
                  <span className="sa-bank-name">{b.name}</span>
                  <span className="sa-bank-full">{b.full}</span>
                </button>
              ))}
            </div>

            {selectedSABank && (
              <form
                onSubmit={handleSASubmit}
                style={{ marginTop: 20 }}
              >
                <div className="field">
                  <label>Account Name</label>
                  <input
                    type="text"
                    value={saAccountName}
                    onChange={(e) => setSaAccountName(e.target.value)}
                    placeholder="e.g. My Cheque Account"
                  />
                </div>
                <div className="field">
                  <label>Account Type</label>
                  <select
                    value={saAccountType}
                    onChange={(e) => setSaAccountType(e.target.value)}
                  >
                    <option value="cheque">Cheque / Current</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit Card</option>
                  </select>
                </div>
                <div className="field">
                  <label>Current Balance (ZAR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={saBalance}
                    onChange={(e) => setSaBalance(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                {mode !== 'business' && (
                  <label className="bank-business-card-check">
                    <input
                      type="checkbox"
                      checked={addAsBusinessCard}
                      onChange={(e) => setAddAsBusinessCard(e.target.checked)}
                    />
                    This is a business credit card (for trip expenses)
                  </label>
                )}
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: '100%', marginTop: 12 }}
                >
                  Add Account
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

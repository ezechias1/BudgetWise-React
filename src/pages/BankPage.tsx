import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';

// ==========================================================================
// Ported from vanilla dashboard.html (#page-bank, line 1165) and js/app.js
// bank connection flows (loadLinkedAccounts, renderBankCards, openPlaidLink,
// openStitchLink, openSaltEdgeConnect). See app.js lines ~4650-5492.
// ==========================================================================

interface LinkedAccount {
  id: string;
  user_id: string;
  plaid_access_token?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  account_type?: string | null;
  account_subtype?: string | null;
  institution_name?: string | null;
  mask?: string | null;
  balance_current?: number | null;
  balance_available?: number | null;
  currency_code?: string | null;
  last_synced?: string | null;
  account_mode?: string | null;
  created_at?: string | null;
}

interface RegionOption {
  provider: string;
  ready: boolean;
  manual?: boolean;
  flag: string;
  title: string;
  providerLabel: string;
  banks: string;
}

// Verbatim from dashboard.html lines 1207-1286.
const REGIONS: RegionOption[] = [
  {
    provider: 'plaid',
    ready: true,
    flag: '🇺🇸 🇬🇧 🇨🇦 🇪🇺',
    title: 'US, UK, Canada & Europe',
    providerLabel: 'Powered by Plaid',
    banks: '12,000+ banks including Chase, HSBC, Barclays, TD',
  },
  {
    provider: 'stitch',
    ready: true,
    flag: '🇿🇦',
    title: 'South Africa',
    providerLabel: 'Add Manually',
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
    provider: 'saltedge',
    ready: true,
    manual: true,
    flag: '🇩🇪 🇫🇷 🇮🇹 🇪🇸 🇵🇱 🇨🇿',
    title: 'Europe (Extended)',
    providerLabel: 'Powered by Salt Edge',
    banks:
      'Deutsche Bank, BNP Paribas, UniCredit, Santander, ING, 5000+ banks across 50 countries',
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
  'Plaid',
  'Stitch',
  'Mono',
  'Belvo',
  'Basiq',
  'Setu',
  'Lean',
  'Brankas',
  'Salt Edge',
  'Moneytree',
];

// =============================================================================
// Main component
// =============================================================================
export default function BankPage() {
  const { user } = useAuth();
  const { mode } = useMode();
  const { currency } = useUserSettings();

  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [showRegionModal, setShowRegionModal] = useState(false);
  const [showSAModal, setShowSAModal] = useState(false);
  const [regionSearch, setRegionSearch] = useState('');
  const [saSearch, setSaSearch] = useState('');
  const [selectedSABank, setSelectedSABank] = useState<string>('');
  const [saAccountName, setSaAccountName] = useState('');
  const [saAccountType, setSaAccountType] = useState('cheque');
  const [saBalance, setSaBalance] = useState('');

  const fmt = useCallback(
    (n: number) => formatCurrency(n, currency),
    [currency]
  );

  // ---- Load linked accounts (port of loadLinkedAccounts, app.js L4857) ----
  const loadLinkedAccounts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('linked_accounts')
        .select('*')
        .eq('user_id', user.id)
        .eq('account_mode', mode)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLinkedAccounts((data ?? []) as LinkedAccount[]);
    } catch {
      // Fallback: account_mode column may not exist yet.
      const { data } = await supabase
        .from('linked_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setLinkedAccounts((data ?? []) as LinkedAccount[]);
    } finally {
      setLoading(false);
    }
  }, [user, mode]);

  useEffect(() => {
    loadLinkedAccounts();
  }, [loadLinkedAccounts]);

  // ---- Totals (port of renderBankCards totals, app.js L5450) ----
  const totalBalance = useMemo(
    () =>
      linkedAccounts.reduce((sum, a) => sum + (a.balance_current ?? 0), 0),
    [linkedAccounts]
  );

  // ---- Provider connect handlers ----
  const openPlaidLink = useCallback(async () => {
    if (!user) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'plaid-link-token',
        { body: { user_id: user.id } }
      );
      if (error || !data?.link_token) {
        alert(
          'Error connecting to bank: ' +
            (data?.error_message || data?.error || error?.message || 'Please try again.')
        );
        return;
      }
      // TODO: Initialize Plaid Link SDK with data.link_token once the script
      // is loaded in index.html (mirrors openPlaidLink in app.js L4704).
      console.log('[plaid] link_token received, open Plaid Link here', data);
      alert('Plaid Link token received. Full Plaid SDK flow is not wired in the React port yet.');
    } catch (err) {
      alert('Connection error: ' + (err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [user]);

  const openStitchLink = useCallback(async () => {
    // In vanilla, Stitch is South Africa: it opens the SA manual-entry modal
    // fallback flow (see app.js ~L4921). We surface the SA modal here.
    setShowSAModal(true);
  }, []);

  const openSaltEdgeConnect = useCallback(async () => {
    if (!user) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'saltedge-connect',
        { body: { user_id: user.id } }
      );
      if (error || !data?.connect_url) {
        alert(
          'Error connecting to Salt Edge: ' +
            (data?.error || error?.message || 'Please try again.')
        );
        return;
      }
      // TODO: full Salt Edge redirect/callback flow (app.js L5159).
      console.log('[saltedge] connect_url', data);
      window.open(data.connect_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Connection error: ' + (err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [user]);

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
    if (r.provider === 'plaid') openPlaidLink();
    else if (r.provider === 'stitch') openStitchLink();
    else if (r.provider === 'saltedge') openSaltEdgeConnect();
  };

  // ---- Sync / update / remove (app.js L4671 - L4700) ----
  const handleSync = async (acc: LinkedAccount) => {
    if (!acc.plaid_access_token || acc.plaid_access_token === 'manual') return;
    try {
      const { data } = await supabase.functions.invoke('plaid-exchange-token', {
        body: { access_token: acc.plaid_access_token },
      });
      if (data?.accounts) {
        const match = data.accounts.find(
          (a: { account_id: string }) => a.account_id === acc.account_id
        );
        if (match) {
          await supabase
            .from('linked_accounts')
            .update({
              balance_current: match.balances.current,
              balance_available: match.balances.available,
              last_synced: new Date().toISOString(),
            })
            .eq('id', acc.id);
        }
      }
      await loadLinkedAccounts();
    } catch (err) {
      console.error('Sync error:', err);
    }
  };

  const handleUpdateBalance = async (acc: LinkedAccount) => {
    const newBalance = prompt('Enter updated balance:');
    if (newBalance === null || isNaN(parseFloat(newBalance))) return;
    await supabase
      .from('linked_accounts')
      .update({
        balance_current: parseFloat(newBalance),
        balance_available: parseFloat(newBalance),
        last_synced: new Date().toISOString(),
      })
      .eq('id', acc.id);
    await loadLinkedAccounts();
  };

  const handleRemove = async (acc: LinkedAccount) => {
    if (!confirm('Remove this account? Transaction history will be kept.')) return;
    await supabase.from('linked_accounts').delete().eq('id', acc.id);
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
        <button
          className="btn-primary btn-sm"
          id="connectBankBtn"
          onClick={() => setShowRegionModal(true)}
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
          const isManual = acc.plaid_access_token === 'manual';

          return (
            <div className={'bank-card ' + cardType} key={acc.id}>
              <div className="bank-card-top">
                <span className="bank-card-institution">
                  {acc.institution_name || 'Bank'}
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
                      onClick={() => handleSync(acc)}
                    >
                      Sync
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
                color: 'rgba(255,255,255,0.4)',
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
                className="input"
                placeholder="Search for your bank..."
                style={{ paddingLeft: 36, width: '100%' }}
                value={regionSearch}
                onChange={(e) => setRegionSearch(e.target.value)}
              />
            </div>
            {regionSearch && filteredRegions.length === 0 && (
              <p
                className="bank-search-result"
                style={{
                  color: 'rgba(255,255,255,0.5)',
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
                color: 'rgba(255,255,255,0.4)',
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
                className="input"
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
                <div className="form-group">
                  <label>Account Name</label>
                  <input
                    type="text"
                    value={saAccountName}
                    onChange={(e) => setSaAccountName(e.target.value)}
                    placeholder="e.g. My Cheque Account"
                    className="input"
                  />
                </div>
                <div className="form-group">
                  <label>Account Type</label>
                  <select
                    value={saAccountType}
                    onChange={(e) => setSaAccountType(e.target.value)}
                    className="input"
                  >
                    <option value="cheque">Cheque / Current</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit Card</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Current Balance (ZAR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={saBalance}
                    onChange={(e) => setSaBalance(e.target.value)}
                    placeholder="0.00"
                    className="input"
                  />
                </div>
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

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import type { Mode } from '@/types';

// Extracted from BankPage.tsx so the same "link a bank account" flow can be
// reused from the Trips tab for business cards, without regular Bank-page
// users (who never travel for work) seeing a business-card checkbox that
// doesn't apply to them. isBusinessCard is now fixed per caller instead of
// a user-togglable checkbox: BankPage always passes false, the Trips tab's
// Business Cards section always passes true.

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
    banks: 'FNB, Capitec, Standard Bank, Absa, Nedbank, TymeBank, Bidvest',
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
  // TymeBank and Bidvest confirmed live on Mono's SA institution coverage
  // (verified against their real API), so they belong here alongside the
  // big five rather than forcing those customers to pick "Other".
  { name: 'TymeBank', full: 'TymeBank', color: '#ffcb05', initial: 'T' },
  { name: 'Bidvest', full: 'Bidvest Bank', color: '#00539f', initial: 'B' },
];

interface Props {
  mode: Mode;
  isBusinessCard: boolean;
  /**
   * Show the "Add Account" button that opens the provider/region picker.
   * Defaults to true. BankPage passes false while BANK_CONNECT_ENABLED is
   * off, because no provider is actually wired — the Stitch edge functions
   * were never deployed, so the flow leads to a bank login that cannot
   * complete. "Add Manually" is unaffected and always renders.
   */
  showConnect?: boolean;
  onLinked: () => void;
}

export function LinkBankAccountFlow({ mode, isBusinessCard, onLinked, showConnect = true }: Props) {
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [showRegionModal, setShowRegionModal] = useState(false);
  const [showSAModal, setShowSAModal] = useState(false);
  const [regionSearch, setRegionSearch] = useState('');
  const [saSearch, setSaSearch] = useState('');
  const [selectedSABank, setSelectedSABank] = useState<string>('');
  const [saAccountName, setSaAccountName] = useState('');
  const [saAccountType, setSaAccountType] = useState('cheque');
  const [saBalance, setSaBalance] = useState('');
  const regionDialog = useDialogA11y(showRegionModal);
  const saDialog = useDialogA11y(showSAModal);

  // Stitch's hosted Link flow: get a consent URL from our edge function
  // (user-JWT authenticated) and redirect. The OAuth callback function does
  // the token exchange + linked_accounts insert server-side, then redirects
  // back with ?stitch_linked=1 — see the effect below.
  const openStitchLink = useCallback(async () => {
    if (!user) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('stitch-link-initiate', {
        body: { mode, isBusinessCard },
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
  }, [user, mode, isBusinessCard]);

  // Handle the Stitch OAuth callback redirect — the account itself was
  // already inserted server-side, so this just refreshes the caller's list.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('stitch_linked')) return;
    window.history.replaceState({}, '', window.location.pathname);
    onLinked();
  }, [onLinked]);

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
      is_business: isBusinessCard,
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
    onLinked();
  };

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

  return (
    <>
      <button type="button" className="btn-export" onClick={() => setShowSAModal(true)}>
        Add Manually
      </button>
      {showConnect && (
        <button
          type="button"
          className="btn-primary btn-sm"
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
      )}

      {/* Region Selector Modal */}
      {showRegionModal && (
        <div
          className="modal-overlay"
          id="regionModal"
          {...regionDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="select-region-title"
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="select-region-title">Select Your Region</h2>
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
        <div
          className="modal-overlay"
          id="saBankModal"
          {...saDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-sa-bank-title"
        >
          <div className="modal">
            <div className="modal-header">
              <h2 id="add-sa-bank-title">Add South African Bank</h2>
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
              <form onSubmit={handleSASubmit} style={{ marginTop: 20 }}>
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
    </>
  );
}

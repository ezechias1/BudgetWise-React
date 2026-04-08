import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/format';

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

interface InvoiceLite {
  id: string;
  client_id: string;
  amount: number;
  status: string;
}

export default function ClientsPage() {
  const { user } = useAuth();
  const { currency } = useUserSettings();

  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [showModal, setShowModal] = useState(false);

  const loadClients = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', user.id)
      .eq('account_mode', 'business')
      .order('created_at', { ascending: false });
    setClients((data ?? []) as Client[]);
  }, [user]);

  const loadInvoices = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('invoices')
      .select('id, client_id, amount, status')
      .eq('user_id', user.id)
      .eq('account_mode', 'business');
    setInvoices((data ?? []) as InvoiceLite[]);
  }, [user]);

  useEffect(() => {
    loadClients();
    loadInvoices();
  }, [loadClients, loadInvoices]);

  const fmt = (n: number) => formatCurrency(n, currency);

  const { clientRevMap, totalRev } = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.forEach((inv) => {
      if (inv.status === 'paid') {
        map[inv.client_id] = (map[inv.client_id] || 0) + inv.amount;
      }
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return { clientRevMap: map, totalRev: total };
  }, [invoices]);

  const openModal = () => setShowModal(true);
  const closeModal = () => setShowModal(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const client = {
      user_id: user.id,
      name: String(fd.get('clientName') ?? ''),
      email: (fd.get('clientEmail') as string) || null,
      phone: (fd.get('clientPhone') as string) || null,
      company: (fd.get('clientCompany') as string) || null,
      account_mode: 'business',
    };
    await supabase.from('clients').insert(client);
    form.reset();
    closeModal();
    loadClients();
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Delete this client? Their invoices will remain.')) return;
    await supabase.from('clients').delete().eq('id', id);
    loadClients();
  };

  return (
    <>
      <section className="page active" id="page-clients">
        <div className="page-header">
          <div>
            <h1>Clients</h1>
            <p className="page-subtitle">Manage your customers and contacts</p>
          </div>
          <button className="btn-add" id="addClientBtn" onClick={openModal}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14m-7-7h14" />
            </svg>
            Add Client
          </button>
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon stat-blue">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Clients</span>
              <span className="stat-value" id="clientCount">
                {clients.length}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-green">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Revenue</span>
              <span className="stat-value" id="clientRevenue">
                {fmt(totalRev)}
              </span>
            </div>
          </div>
        </div>
        <div className="clients-grid" id="clientsGrid">
          {clients.length === 0 ? (
            <div className="empty-state empty-state-action" id="emptyClients">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3 }}>
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
              </svg>
              <p>No clients yet</p>
              <button className="empty-action-btn trigger-add-client" onClick={openModal}>
                Add First Client
              </button>
            </div>
          ) : (
            clients.map((c) => {
              const rev = clientRevMap[c.id] || 0;
              const invCount = invoices.filter((i) => i.client_id === c.id).length;
              const initials = c.name
                .split(' ')
                .map((w) => w.charAt(0))
                .join('')
                .toUpperCase()
                .substring(0, 2);
              return (
                <div key={c.id} className="chart-card client-card">
                  <div className="client-card-header">
                    <div className="client-avatar">{initials}</div>
                    <div className="client-info">
                      <h4>{c.name}</h4>
                      <span>{c.email || c.company || 'No contact info'}</span>
                    </div>
                    <button className="btn-delete client-delete" onClick={() => deleteClient(c.id)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                  <div className="client-stats">
                    <div>
                      <span className="client-stat-val">{fmt(rev)}</span>
                      <span className="client-stat-lbl">Revenue</span>
                    </div>
                    <div>
                      <span className="client-stat-val">{invCount}</span>
                      <span className="client-stat-lbl">Invoices</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Client Modal */}
      <div className={`modal-overlay${showModal ? '' : ' hidden'}`} id="clientModal">
        <div className="modal">
          <div className="modal-header">
            <h2>Add Client</h2>
            <button className="modal-close" id="closeClientModal" onClick={closeModal}>
              &times;
            </button>
          </div>
          <form id="clientForm" onSubmit={handleSubmit}>
            <div className="field">
              <label>Client Name</label>
              <input type="text" name="clientName" id="clientName" required placeholder="e.g. Acme Corp" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" name="clientEmail" id="clientEmail" placeholder="client@example.com" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input type="tel" name="clientPhone" id="clientPhone" placeholder="+27 82 123 4567" />
            </div>
            <div className="field">
              <label>Company</label>
              <input type="text" name="clientCompany" id="clientCompany" placeholder="Company name (optional)" />
            </div>
            <button type="submit" className="btn-primary">
              Add Client
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

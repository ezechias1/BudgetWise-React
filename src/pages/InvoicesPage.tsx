import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { ok, reportWriteFailure } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency, todayIso } from '@/lib/format';

interface Client {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  user_id: string;
  client_id: string;
  description: string;
  amount: number;
  invoice_date: string;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue';
  account_mode: string;
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const { currency } = useUserSettings();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showModal, setShowModal] = useState(false);

  const loadInvoices = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('user_id', user.id)
      .eq('account_mode', 'business')
      .order('invoice_date', { ascending: false });
    setInvoices((data ?? []) as Invoice[]);
  }, [user]);

  const loadClients = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('account_mode', 'business')
      .order('created_at', { ascending: false });
    setClients((data ?? []) as Client[]);
  }, [user]);

  useEffect(() => {
    loadInvoices();
    loadClients();
  }, [loadInvoices, loadClients]);

  const fmt = (n: number) => formatCurrency(n, currency);

  const stats = useMemo(() => {
    const today = todayIso();
    let totalAmt = 0,
      pendingAmt = 0,
      paidAmt = 0,
      overdueAmt = 0;
    invoices.forEach((inv) => {
      totalAmt += inv.amount;
      let status: Invoice['status'] = inv.status;
      if (status === 'pending' && inv.due_date < today) status = 'overdue';
      if (status === 'paid') paidAmt += inv.amount;
      else if (status === 'overdue') overdueAmt += inv.amount;
      else pendingAmt += inv.amount;
    });
    return { totalAmt, pendingAmt, paidAmt, overdueAmt };
  }, [invoices]);

  const markPaid = async (id: string) => {
    if (!user) return;
    // Silently failed before: a rejected update still fell through to
    // loadInvoices(), so the row flipped back to Pending on the next render
    // with no explanation.
    const paid = await ok(
      supabase
        .from('invoices')
        .update({ status: 'paid' })
        .eq('id', id)
        .eq('user_id', user.id),
      'mark this invoice as paid',
    );
    if (!paid) return;
    loadInvoices();
  };

  const deleteInvoice = async (id: string) => {
    if (!user) return;
    // Silently failed before: the delete discarded both its error and its
    // result, so an RLS-blocked delete left the invoice in the database
    // while the table re-rendered without it. .select() makes the database
    // hand back the rows it actually deleted — no rows means nothing went.
    const { data, error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');
    if (error) {
      reportWriteFailure('delete this invoice', error.message);
      return;
    }
    if (!data || data.length === 0) {
      reportWriteFailure(
        'delete this invoice',
        'no matching invoice was removed. It may already have been deleted.',
      );
      loadInvoices();
      return;
    }
    loadInvoices();
  };

  const openModal = () => setShowModal(true);
  const closeModal = () => setShowModal(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const inv = {
      user_id: user.id,
      client_id: String(fd.get('invClient') ?? ''),
      description: String(fd.get('invDescription') ?? ''),
      amount: parseFloat(String(fd.get('invAmount') ?? '0')),
      invoice_date: String(fd.get('invDate') ?? ''),
      due_date: String(fd.get('invDueDate') ?? ''),
      status: 'pending' as const,
      account_mode: 'business',
    };
    // Silently failed before: a rejected insert still reset the form and
    // closed the modal, so the user's typing was thrown away for an invoice
    // that was never created. Keep the modal open on failure.
    const created = await ok(
      supabase.from('invoices').insert(inv),
      'create this invoice',
    );
    if (!created) return;
    form.reset();
    closeModal();
    loadInvoices();
  };

  const defaultDue = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  };

  const today = todayIso();

  return (
    <>
      <section className="page active" id="page-invoices">
        <div className="page-header">
          <div>
            <h1>Invoices</h1>
            <p className="page-subtitle">Create and track client invoices</p>
          </div>
          <button className="btn-add" id="addInvoiceBtn" onClick={openModal}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14m-7-7h14" />
            </svg>
            New Invoice
          </button>
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon stat-green">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Invoiced</span>
              <span className="stat-value" id="invTotal">
                {fmt(stats.totalAmt)}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-blue">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Pending</span>
              <span className="stat-value" id="invPending">
                {fmt(stats.pendingAmt)}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-purple">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <path d="M22 4L12 14.01l-3-3" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Paid</span>
              <span className="stat-value" id="invPaid">
                {fmt(stats.paidAmt)}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-red">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6m0-6l6 6" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Overdue</span>
              <span className="stat-value" id="invOverdue">
                {fmt(stats.overdueAmt)}
              </span>
            </div>
          </div>
        </div>
        <div className="chart-card full-width">
          <div className="table-wrap">
            <table className="expense-table" id="invoiceTable">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Client</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="invoiceBody">
                {invoices.map((inv, idx) => {
                  let status: Invoice['status'] = inv.status;
                  if (status === 'pending' && inv.due_date < today) status = 'overdue';
                  const client = clients.find((c) => c.id === inv.client_id);
                  const clientName = client ? client.name : 'Unknown';
                  const invNum = 'INV-' + String(idx + 1).padStart(3, '0');
                  const statusClass =
                    status === 'paid'
                      ? 'status-paid'
                      : status === 'overdue'
                        ? 'status-overdue'
                        : 'status-pending';
                  return (
                    <tr key={inv.id}>
                      <td>{invNum}</td>
                      <td>{clientName}</td>
                      <td>{fmt(inv.amount)}</td>
                      <td>{inv.invoice_date}</td>
                      <td>{inv.due_date}</td>
                      <td>
                        <span className={`inv-status ${statusClass}`}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                      </td>
                      <td className="actions-cell">
                        {status !== 'paid' && (
                          <button className="btn-mark-paid" onClick={() => markPaid(inv.id)}>
                            Mark Paid
                          </button>
                        )}
                        <button className="btn-delete" onClick={() => deleteInvoice(inv.id)}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {invoices.length === 0 && (
              <div className="empty-state empty-state-action" id="emptyInvoices">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3 }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <path d="M14 2v6h6m-4 5H8m8 4H8m2-8H8" />
                </svg>
                <p>No invoices yet</p>
                <button className="empty-action-btn trigger-add-invoice" onClick={openModal}>
                  Create First Invoice
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Invoice Modal */}
      <div className={`modal-overlay${showModal ? '' : ' hidden'}`} id="invoiceModal">
        <div className="modal">
          <div className="modal-header">
            <h2>New Invoice</h2>
            <button className="modal-close" id="closeInvoiceModal" onClick={closeModal}>
              &times;
            </button>
          </div>
          <form id="invoiceForm" onSubmit={handleSubmit}>
            <div className="field">
              <label>Client</label>
              <select name="invClient" id="invClient" required defaultValue="">
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Description</label>
              <input type="text" name="invDescription" id="invDescription" required placeholder="e.g. Website redesign" />
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" name="invAmount" id="invAmount" required placeholder="0.00" min="0" step="0.01" />
            </div>
            <div className="field">
              <label>Invoice Date</label>
              <input type="date" name="invDate" id="invDate" required defaultValue={todayIso()} />
            </div>
            <div className="field">
              <label>Due Date</label>
              <input type="date" name="invDueDate" id="invDueDate" required defaultValue={defaultDue()} />
            </div>
            <button type="submit" className="btn-primary">
              Create Invoice
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

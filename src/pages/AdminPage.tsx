import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Ports admin.html from the vanilla site.
 *
 * The vanilla Admin page is a standalone HTML file with its own inline CSS.
 * We preserve the exact class names and markup so the same styles can be
 * reused. The wrapper <AdminRoute> already enforces isAdmin(), so we don't
 * re-check here — but we still render a "denied" fallback defensively.
 *
 * Data sources (all normal RLS queries):
 *  - supabase.rpc('get_admin_users')   → user list with full_name/email/etc.
 *  - login_events table                 → recent login rows (limit 100)
 *
 * NOTE: Any destructive admin action (grant/revoke Pro, delete user, etc.)
 * requires the service role key, which must never live in the browser.
 * Those flows are stubbed with TODOs — they belong in an edge function.
 */

type AdminUser = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  account_type?: string | null;
  provider?: string | null;
  created_at?: string | null;
  last_sign_in?: string | null;
};

type LoginEvent = {
  user_id: string;
  logged_in_at: string;
};

function fmt(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

function AccountBadge({ type }: { type?: string | null }) {
  if (type === 'business') return <span className="badge badge-blue">Business</span>;
  if (type === 'family') return <span className="badge badge-purple">Family</span>;
  return <span className="badge badge-green">Personal</span>;
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logins, setLogins] = useState<LoginEvent[]>([]);
  const [currentTab, setCurrentTab] = useState<'users' | 'logins'>('users');

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [usersResult, loginsResult] = await Promise.all([
      supabase.rpc('get_admin_users'),
      supabase
        .from('login_events')
        .select('*')
        .order('logged_in_at', { ascending: false })
        .limit(100),
    ]);
    setUsers((usersResult.data as AdminUser[] | null) ?? []);
    setLogins((loginsResult.data as LoginEvent[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const adminAction = async (action: string, targetId: string, label: string) => {
    if (!confirm(`Are you sure you want to ${label}?`)) return;
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action, target_user_id: targetId },
      });
      if (error) {
        alert('Error: ' + error.message);
        return;
      }
      alert(data?.result || 'Done');
      if (action === 'delete_user') {
        setUsers((prev) => prev.filter((u) => u.id !== targetId));
      }
      await loadAll();
    } catch (err) {
      alert('Error: ' + (err as Error).message);
    }
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 7,
  ).toISOString();

  const statUsers = users.length;
  const statLogins = logins.length;
  const statLoginsToday = logins.filter((l) => l.logged_in_at >= todayStart).length;
  const statLoginsWeek = logins.filter((l) => l.logged_in_at >= weekStart).length;
  const statNewToday = users.filter((u) => (u.created_at ?? '') >= todayStart).length;

  let personal = 0;
  let business = 0;
  let family = 0;
  users.forEach((u) => {
    const type = u.account_type || 'personal';
    if (type === 'business') business++;
    else if (type === 'family') family++;
    else personal++;
  });

  // Login counts per user
  const loginCounts: Record<string, number> = {};
  logins.forEach((l) => {
    loginCounts[l.user_id] = (loginCounts[l.user_id] || 0) + 1;
  });

  // User map for login display
  const userMap: Record<string, AdminUser> = {};
  users.forEach((u) => {
    userMap[u.id] = u;
  });

  // Most recent login per user
  const seen: Record<string, { login: LoginEvent; count: number }> = {};
  logins.forEach((l) => {
    const existing = seen[l.user_id];
    if (existing) {
      existing.count++;
      return;
    }
    seen[l.user_id] = { login: l, count: 1 };
  });
  const loginRows = Object.values(seen).sort((a, b) =>
    b.login.logged_in_at > a.login.logged_in_at ? 1 : -1,
  );

  return (
    <section className="page active admin-page" id="page-admin">
      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div id="adminPanel">
          <div className="header">
            <h1>
              <span>BudgetWise</span> Admin
            </h1>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button className="refresh-btn" onClick={loadAll}>
                Refresh
              </button>
              <a href="/dashboard" className="back-link">
                Back to Dashboard
              </a>
            </div>
          </div>

          <div className="stats">
            <div className="stat-card accent">
              <div className="value">{statUsers}</div>
              <div className="label">Total Users</div>
            </div>
            <div className="stat-card">
              <div className="value">{statLogins}</div>
              <div className="label">Total Logins</div>
            </div>
            <div className="stat-card">
              <div className="value">{statLoginsToday}</div>
              <div className="label">Logins Today</div>
            </div>
            <div className="stat-card">
              <div className="value">{statLoginsWeek}</div>
              <div className="label">Logins This Week</div>
            </div>
            <div className="stat-card">
              <div className="value">{personal}</div>
              <div className="label">Personal Accounts</div>
            </div>
            <div className="stat-card">
              <div className="value">{business}</div>
              <div className="label">Business Accounts</div>
            </div>
            <div className="stat-card">
              <div className="value">{family}</div>
              <div className="label">Family Accounts</div>
            </div>
            <div className="stat-card">
              <div className="value">{statNewToday}</div>
              <div className="label">New Users Today</div>
            </div>
          </div>

          <div className="tabs">
            <button
              className={`tab-btn${currentTab === 'users' ? ' active' : ''}`}
              data-tab="users"
              onClick={() => setCurrentTab('users')}
            >
              Users
            </button>
            <button
              className={`tab-btn${currentTab === 'logins' ? ' active' : ''}`}
              data-tab="logins"
              onClick={() => setCurrentTab('logins')}
            >
              Recent Logins
            </button>
          </div>

          <div id="usersTab" style={{ display: currentTab === 'users' ? '' : 'none' }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Account Type</th>
                    <th>Provider</th>
                    <th>Logins</th>
                    <th>Joined</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="usersBody">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty">
                        No users yet
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.full_name || '-'}</td>
                        <td>{u.email || '-'}</td>
                        <td>
                          <AccountBadge type={u.account_type} />
                        </td>
                        <td>
                          <span className="badge badge-gray">{u.provider || 'email'}</span>
                        </td>
                        <td>{loginCounts[u.id] || 0}</td>
                        <td>{fmt(u.created_at)}</td>
                        <td>{fmt(u.last_sign_in)}</td>
                        <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button
                            className="badge badge-green"
                            style={{ cursor: 'pointer', border: 'none', padding: '4px 8px', fontSize: '0.7rem' }}
                            onClick={() => adminAction('grant_pro', u.id, `grant Pro to ${u.email}`)}
                          >
                            Grant Pro
                          </button>
                          <button
                            className="badge badge-gray"
                            style={{ cursor: 'pointer', border: 'none', padding: '4px 8px', fontSize: '0.7rem' }}
                            onClick={() => adminAction('revoke_pro', u.id, `revoke Pro from ${u.email}`)}
                          >
                            Revoke
                          </button>
                          <button
                            className="badge"
                            style={{ cursor: 'pointer', border: 'none', padding: '4px 8px', fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                            onClick={() => adminAction('delete_user', u.id, `permanently delete ${u.email}`)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div id="loginsTab" style={{ display: currentTab === 'logins' ? '' : 'none' }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Logins</th>
                    <th>Last Login</th>
                  </tr>
                </thead>
                <tbody id="loginsBody">
                  {loginRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        No login events yet
                      </td>
                    </tr>
                  ) : (
                    loginRows.map((entry) => {
                      const u = userMap[entry.login.user_id] || ({} as AdminUser);
                      return (
                        <tr key={entry.login.user_id}>
                          <td>{u.full_name || 'Unknown'}</td>
                          <td>{u.email || entry.login.user_id}</td>
                          <td>{entry.count}</td>
                          <td>{fmt(entry.login.logged_in_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

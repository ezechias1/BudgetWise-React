import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Ports #page-members from dashboard.html (line 1730) and
 * `renderMembers()` in js/app.js (line 1393).
 *
 * CRUD on the `family_members` Supabase table. Inline add-member modal.
 * Edit flow is stubbed (TODO) — delegates to Remove only.
 */

interface FamilyMember {
  id: string;
  user_id: string;
  name: string;
  role: string;
  age: number | null;
  color: string;
  allowance: number;
  spent: number;
  earned: number;
}

const AVATAR_COLORS = [
  '#8b5cf6',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

function symbolFor(currency: string): string {
  const sym: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
    KES: 'KSh', GHS: 'GH\u20B5', INR: '\u20B9', BRL: 'R$', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$',
  };
  return sym[currency] || currency + ' ';
}

export default function MembersPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('parent');
  const [age, setAge] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [allowance, setAllowance] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const [mRes, sRes] = await Promise.all([
      supabase
        .from('family_members')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at'),
      supabase
        .from('user_settings')
        .select('currency')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    setMembers((mRes.data as FamilyMember[]) || []);
    if (sRes.data?.currency) setCurrency(sRes.data.currency);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setName('');
    setRole('parent');
    setAge('');
    setColor('#8b5cf6');
    setAllowance('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const member = {
      user_id: user.id,
      name: name.trim(),
      role,
      age: age ? Number(age) : null,
      color,
      allowance: Number(allowance) || 0,
      spent: 0,
      earned: 0,
    };
    const { data } = await supabase
      .from('family_members')
      .insert(member)
      .select()
      .single();
    if (data) setMembers((prev) => [...prev, data as FamilyMember]);
    resetForm();
    setShowModal(false);
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this family member?')) return;
    await supabase.from('family_members').delete().eq('id', id);
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const sym = symbolFor(currency);

  return (
    <section className="page active" id="page-members">
      <div className="page-header">
        <div>
          <h1>Family Members</h1>
          <p className="page-subtitle">Manage your household</p>
        </div>
        <button
          className="btn-primary"
          id="addMemberBtn"
          onClick={() => setShowModal(true)}
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
          Add Member
        </button>
      </div>
      <div className="members-grid" id="membersGrid">
        {members.length === 0 ? (
          <div className="empty-state" id="emptyMembers">
            <svg
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.3 }}
            >
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
            </svg>
            <p>No family members yet. Add your first member to get started.</p>
          </div>
        ) : (
          members.map((m) => {
            const roleLabel =
              m.role.charAt(0).toUpperCase() +
              m.role.slice(1) +
              (m.age ? ', ' + m.age : '');
            return (
              <div className="member-card" key={m.id}>
                <div className="member-card-header">
                  <div
                    className="member-avatar"
                    style={{
                      background: /^#[0-9a-fA-F]{3,8}$/.test(m.color)
                        ? m.color
                        : '#6b7280',
                    }}
                  >
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="member-info">
                    <h4>{m.name}</h4>
                    <span className={`member-role role-${m.role}`}>
                      {roleLabel}
                    </span>
                  </div>
                </div>
                <div className="member-stats">
                  <div className="member-stat">
                    <span className="member-stat-val">
                      {sym}
                      {Number(m.allowance).toFixed(2)}
                    </span>
                    <span className="member-stat-lbl">Allowance/wk</span>
                  </div>
                  <div className="member-stat">
                    <span className="member-stat-val">
                      {sym}
                      {Number(m.spent || 0).toFixed(2)}
                    </span>
                    <span className="member-stat-lbl">Spent</span>
                  </div>
                </div>
                <div className="member-actions">
                  {/* TODO: inline edit-member modal */}
                  <button
                    className="btn-edit-member"
                    onClick={() => alert('Edit coming soon')}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-remove"
                    onClick={() => handleRemove(m.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" id="memberModal">
          <div className="modal">
            <div className="modal-header">
              <h2>Add Family Member</h2>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Role</label>
                <select
                  required
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="parent">Parent</option>
                  <option value="teen">Teen (13-17)</option>
                  <option value="child">Child (under 13)</option>
                </select>
              </div>
              <div className="field">
                <label>Age</label>
                <input
                  type="number"
                  min="1"
                  max="99"
                  placeholder="Optional"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Avatar Color</label>
                <div className="color-picker-row">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={'color-dot' + (color === c ? ' active' : '')}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Weekly Allowance</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%' }}
              >
                Add Member
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

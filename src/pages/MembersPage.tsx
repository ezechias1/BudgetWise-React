import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { AddKidModal } from '@/components/AddKidModal';
import { ShowKidLinkModal } from '@/components/ShowKidLinkModal';
import { JuniorUpgradeModal } from '@/components/JuniorUpgradeModal';
import { useUserSettings } from '@/hooks/useUserSettings';
import { checkJuniorGate, isProUser, JUNIOR_FREE_LIMITS } from '@/lib/access';

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
  auth_user_id?: string | null;
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
  const { isProFromSettings } = useUserSettings();
  const isPro = isProUser(isProFromSettings, user);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [showModal, setShowModal] = useState(false);
  const [showKidModal, setShowKidModal] = useState(false);
  const [kidGateBlocked, setKidGateBlocked] = useState<{ current: number; limit: number } | null>(null);
  const [linkForMember, setLinkForMember] = useState<FamilyMember | null>(null);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
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
    setEditingMember(null);
  };

  const openEdit = (m: FamilyMember) => {
    setEditingMember(m);
    setName(m.name);
    setRole(m.role);
    setAge(m.age != null ? String(m.age) : '');
    setColor(m.color);
    setAllowance(String(m.allowance || ''));
    setShowModal(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (editingMember) {
      // Update existing member
      const updates = {
        name: name.trim(),
        role,
        age: age ? Number(age) : null,
        color,
        allowance: Number(allowance) || 0,
      };
      const { error } = await supabase
        .from('family_members')
        .update(updates)
        .eq('id', editingMember.id)
        .eq('user_id', user.id);
      if (!error) {
        setMembers((prev) =>
          prev.map((m) =>
            m.id === editingMember.id ? { ...m, ...updates } : m,
          ),
        );
      }
    } else {
      // Insert new member
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
    }

    resetForm();
    setShowModal(false);
  };

  const handleRemove = async (id: string) => {
    if (!user) return;
    const target = members.find((m) => m.id === id);
    const isJuniorKid = target?.role === 'child' && !!target?.auth_user_id;
    const prompt = isJuniorKid
      ? `Remove ${target.name}?\n\nThis will permanently delete:\n• Their Junior login (PIN reset won't bring it back)\n• All their IOU ledger history (paid and unpaid)\n• All their chore progress, missions, streak, and goal assignments\n\nThis cannot be undone. Type "delete" in the next prompt to confirm.`
      : `Remove ${target?.name ?? 'this family member'}?`;
    if (!confirm(prompt)) return;
    if (isJuniorKid) {
      const typed = window.prompt(`Type "delete" to permanently remove ${target!.name}:`);
      if (typed?.toLowerCase() !== 'delete') return;
    }
    await supabase
      .from('family_members')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
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
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            const juniorKidCount = members.filter(
              (m) => m.role === 'child' && !!m.auth_user_id,
            ).length;
            const gate = checkJuniorGate(isPro, 'kids', juniorKidCount);
            if (gate) {
              setKidGateBlocked({ current: gate.current, limit: gate.limit });
              return;
            }
            setShowKidModal(true);
          }}
          style={{ marginLeft: 12 }}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
          Add Junior Kid
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
                  {m.role === 'child' && m.auth_user_id && (
                    <button
                      className="btn-edit-member"
                      onClick={() => setLinkForMember(m)}
                      title={`Show ${m.name}'s login link`}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ verticalAlign: 'middle', marginRight: 4 }}
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      Link
                    </button>
                  )}
                  <button
                    className="btn-edit-member"
                    onClick={() => openEdit(m)}
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
              <h2>{editingMember ? 'Edit Family Member' : 'Add Family Member'}</h2>
              <button
                className="modal-close"
                onClick={() => { setShowModal(false); resetForm(); }}
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
                {editingMember ? 'Save Changes' : 'Add Member'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showKidModal && (
        <AddKidModal
          onClose={() => setShowKidModal(false)}
          onAdded={() => {
            // Reload the list only; AddKidModal manages its own "success view" and
            // stays mounted so the parent can copy the share URL + PIN before dismissing.
            load();
          }}
        />
      )}

      {linkForMember && (
        <ShowKidLinkModal
          memberId={linkForMember.id}
          kidName={linkForMember.name}
          onClose={() => setLinkForMember(null)}
        />
      )}

      {kidGateBlocked && (
        <JuniorUpgradeModal
          reason="kids"
          current={kidGateBlocked.current}
          limit={kidGateBlocked.limit ?? JUNIOR_FREE_LIMITS.maxKids}
          onClose={() => setKidGateBlocked(null)}
        />
      )}
    </section>
  );
}

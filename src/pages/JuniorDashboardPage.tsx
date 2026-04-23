import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAllKidsLedger } from '@/hooks/useKidLedger';
import { SettleUpModal } from '@/components/SettleUpModal';
import { MissionRewardsModal } from '@/components/MissionRewardsModal';
import { PushPromptCard } from '@/components/junior/PushPromptCard';

interface KidRow {
  id: string;
  name: string;
  color: string;
  age: number | null;
  jar_split: { save: number; spend: number; give: number };
}

function symbolFor(currency: string): string {
  const sym: Record<string, string> = { ZAR: 'R', USD: '$', EUR: '€', GBP: '£' };
  return sym[currency] || currency + ' ';
}

function formatRands(cents: number, sym: string): string {
  return `${sym}${(cents / 100).toFixed(2)}`;
}

export default function JuniorDashboardPage() {
  const { user } = useAuth();
  const [kids, setKids] = useState<KidRow[]>([]);
  const [currency, setCurrency] = useState('ZAR');
  const [loading, setLoading] = useState(true);
  const { perKid, refresh: refreshLedger } = useAllKidsLedger();
  const [settleKid, setSettleKid] = useState<KidRow | null>(null);
  const [showRewards, setShowRewards] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [kRes, sRes] = await Promise.all([
      supabase
        .from('family_members')
        .select('id, name, color, age, jar_split, role, auth_user_id')
        .eq('user_id', user.id)
        .eq('role', 'child')
        .not('auth_user_id', 'is', null)
        .order('created_at'),
      supabase
        .from('user_settings')
        .select('currency')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    setKids((kRes.data as KidRow[]) ?? []);
    if (sRes.data?.currency) setCurrency(sRes.data.currency);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const sym = symbolFor(currency);

  if (loading) {
    return (
      <section className="page">
        <header className="page-header">
          <h1>Junior</h1>
          <p>Loading your kids…</p>
        </header>
      </section>
    );
  }

  if (kids.length === 0) {
    return (
      <section className="page">
        <header className="page-header">
          <h1>Junior</h1>
          <p>No Junior kids yet. Add one from Family → Members.</p>
        </header>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1>Junior</h1>
        <p>Your kids, their IOUs, and settle-up.</p>
      </header>

      <PushPromptCard />

      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={() => setShowRewards(true)}>
          Configure mission rewards
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {kids.map((k) => {
          const totals = perKid[k.id] ?? { owed_cents: 0, paid_cents: 0 };
          return (
            <article
              key={k.id}
              className="card"
              style={{ borderTop: `4px solid ${k.color}`, padding: 20 }}
            >
              <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  aria-hidden
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: k.color,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                  }}
                >
                  {k.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0 }}>{k.name}</h3>
                  {k.age != null && <small>Age {k.age}</small>}
                </div>
              </header>

              <p style={{ marginTop: 16, fontSize: '0.9rem', opacity: 0.75 }}>You owe</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: '4px 0 16px' }}>
                {formatRands(totals.owed_cents, sym)}
              </p>

              <small style={{ opacity: 0.6 }}>
                Settled lifetime: {formatRands(totals.paid_cents, sym)}
              </small>

              <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={totals.owed_cents === 0}
                  onClick={() => setSettleKid(k)}
                >
                  {totals.owed_cents === 0 ? 'Nothing owed' : 'Mark as paid'}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {settleKid && (
        <SettleUpModal
          kid={settleKid}
          currencySymbol={sym}
          onClose={() => setSettleKid(null)}
          onPaid={() => {
            refreshLedger();
            load();
          }}
        />
      )}

      {showRewards && <MissionRewardsModal onClose={() => setShowRewards(false)} />}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAllKidsLedger } from '@/hooks/useKidLedger';
import { SettleUpModal } from '@/components/SettleUpModal';
import { MoneyRequestModal } from '@/components/MoneyRequestModal';
import { MissionRewardsModal } from '@/components/MissionRewardsModal';
import { PushPromptCard } from '@/components/junior/PushPromptCard';
import { BirthdayBackfillBanner } from '@/components/BirthdayBackfillBanner';
import { ageFromDob, bracketFor, daysUntilBirthday } from '@/lib/junior-age';

interface KidRow {
  id: string;
  name: string;
  color: string;
  age: number | null;
  date_of_birth: string | null;
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
  const [requestKid, setRequestKid] = useState<KidRow | null>(null);
  const [requestCounts, setRequestCounts] = useState<Record<string, number>>({});
  const [showRewards, setShowRewards] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [kRes, sRes] = await Promise.all([
      supabase
        .from('family_members')
        .select('id, name, color, age, date_of_birth, jar_split, role, auth_user_id')
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

  const loadRequestCounts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('kid_money_requests')
      .select('member_id')
      .eq('user_id', user.id)
      .eq('status', 'pending');
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { member_id: string }[]) {
      counts[row.member_id] = (counts[row.member_id] ?? 0) + 1;
    }
    setRequestCounts(counts);
  }, [user]);

  useEffect(() => {
    load();
    loadRequestCounts();
  }, [load, loadRequestCounts]);

  const sym = symbolFor(currency);

  if (loading) {
    return (
      <section className="page active">
        <header className="page-header">
          <h1>Junior</h1>
          <p>Loading your kids…</p>
        </header>
      </section>
    );
  }

  if (kids.length === 0) {
    return (
      <section className="page active">
        <header className="page-header">
          <h1>Junior</h1>
          <p>Track chores, missions, and IOUs.</p>
        </header>
        <div
          className="card"
          style={{
            padding: 32,
            marginTop: 24,
            textAlign: 'center',
            maxWidth: 460,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          <h3 style={{ marginTop: 0 }}>No Junior kids yet</h3>
          <p style={{ opacity: 0.75, marginBottom: 20 }}>
            Add a kid from Family → Members to get started with chores and rewards.
          </p>
          <a
            href="/dashboard/members"
            className="btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Go to Members
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="page active">
      <header className="page-header">
        <h1>Junior</h1>
        <p>Your kids, their IOUs, and settle-up.</p>
      </header>

      <BirthdayBackfillBanner />

      <PushPromptCard />

      <div style={{ marginBottom: 16 }}>
        <button type="button" className="btn-secondary" onClick={() => setShowRewards(true)}>
          Configure mission rewards
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {kids.map((k) => {
          const totals = perKid[k.id] ?? { owed_cents: 0, paid_cents: 0 };
          const derivedAge = ageFromDob(k.date_of_birth) ?? k.age;
          const bracket = derivedAge !== null && derivedAge >= 7 && derivedAge <= 17 ? bracketFor(derivedAge) : null;
          const daysToBirthday = daysUntilBirthday(k.date_of_birth);
          const birthdaySoon = daysToBirthday !== null && daysToBirthday <= 30;
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
                    flexShrink: 0,
                  }}
                >
                  {k.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{k.name}</h3>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {derivedAge != null && (
                      <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                        Age {derivedAge}
                      </span>
                    )}
                    {bracket && (
                      <span
                        style={{
                          background: 'rgba(16, 185, 129, 0.12)',
                          color: '#065f46',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          lineHeight: 1.5,
                        }}
                      >
                        {bracket}
                      </span>
                    )}
                    {birthdaySoon && (
                      <span
                        style={{
                          background: '#fce7f3',
                          color: '#9d174d',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          lineHeight: 1.5,
                        }}
                        title={`${daysToBirthday} day${daysToBirthday === 1 ? '' : 's'} to birthday`}
                      >
                        {daysToBirthday === 0
                          ? 'Birthday today!'
                          : `${daysToBirthday}d to birthday`}
                      </span>
                    )}
                  </div>
                </div>
              </header>

              <p style={{ marginTop: 16, fontSize: '0.9rem', opacity: 0.75 }}>You owe</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: '4px 0 16px' }}>
                {formatRands(totals.owed_cents, sym)}
              </p>

              <small style={{ opacity: 0.6 }}>
                Settled lifetime: {formatRands(totals.paid_cents, sym)}
              </small>

              <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={totals.owed_cents === 0}
                  onClick={() => setSettleKid(k)}
                >
                  {totals.owed_cents === 0 ? 'Nothing owed' : 'Mark as paid'}
                </button>
                {(requestCounts[k.id] ?? 0) > 0 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRequestKid(k)}
                  >
                    Money requests ({requestCounts[k.id]})
                  </button>
                )}
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

      {requestKid && (
        <MoneyRequestModal
          kid={{ id: requestKid.id, name: requestKid.name, user_id: user!.id }}
          currencySymbol={sym}
          onClose={() => setRequestKid(null)}
          onDecided={() => {
            refreshLedger();
            loadRequestCounts();
          }}
        />
      )}

      {showRewards && <MissionRewardsModal onClose={() => setShowRewards(false)} />}
    </section>
  );
}

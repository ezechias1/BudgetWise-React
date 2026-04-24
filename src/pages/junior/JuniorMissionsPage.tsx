import { Link } from 'react-router-dom';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidMissions } from '@/hooks/useKidMissions';

export default function JuniorMissionsPage() {
  const { member, loading: profileLoading } = useKidProfile();
  const { missions, progressByMission, loading } = useKidMissions(member?.id ?? null);

  if (profileLoading || loading) return <p>Loading missions…</p>;
  if (!member) return <p>Couldn&apos;t load your profile.</p>;

  const byUnit: Record<string, typeof missions> = {};
  for (const m of missions) {
    if (!byUnit[m.unit]) byUnit[m.unit] = [];
    byUnit[m.unit].push(m);
  }

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>Missions</h1>
        <p>Short money lessons. Finish a mission, earn a reward.</p>
      </section>

      {Object.entries(byUnit).map(([unit, unitMissions]) => (
        <section key={unit} style={{ marginBottom: 24 }}>
          <h3>{unit}</h3>
          <ul className="junior-grid-cards" style={{ listStyle: 'none', padding: 0 }}>
            {unitMissions.map((m) => {
              const p = progressByMission[m.id];
              const done = p?.status === 'completed';
              return (
                <li key={m.id} style={{ margin: '8px 0' }}>
                  <Link
                    to={`/junior/mission/${m.id}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: done ? 'rgba(16,185,129,0.1)' : 'white',
                      borderRadius: 12,
                      padding: '14px 16px',
                      textDecoration: 'none',
                      color: 'inherit',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div>
                      <strong>{m.title}</strong>
                      {done && <small style={{ marginLeft: 8, color: '#10b981' }}>Done</small>}
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

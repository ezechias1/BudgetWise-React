import { Link } from 'react-router-dom';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidMissions } from '@/hooks/useKidMissions';

// Per-unit accent for the leading icon circle. Keeps cards visually
// grouped without forking the card component per unit.
const UNIT_COLORS: Record<string, { bg: string; fg: string; icon: JSX.Element }> = {
  Saving: {
    bg: 'linear-gradient(135deg, #10b981, #059669)',
    fg: '#065f46',
    icon: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  },
  Earning: {
    bg: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    fg: '#1e3a8a',
    icon: <path d="M20 7L9 18l-5-5" />,
  },
  Spending: {
    bg: 'linear-gradient(135deg, #f59e0b, #d97706)',
    fg: '#92400e',
    icon: <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></>,
  },
  Giving: {
    bg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    fg: '#5b21b6',
    icon: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  },
  'Money is a tool': {
    bg: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    fg: '#9a3412',
    icon: <><circle cx="12" cy="12" r="10" /><path d="M16 8l-8 8M8 8l8 8" /></>,
  },
  'Earning and choosing': {
    bg: 'linear-gradient(135deg, #10b981, #3b82f6)',
    fg: '#134e4a',
    icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  },
  'Budgeting basics': {
    bg: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    fg: '#1e40af',
    icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M3 9h18" /></>,
  },
  'Adult lite': {
    bg: 'linear-gradient(135deg, #1e293b, #0f172a)',
    fg: '#0f172a',
    icon: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  },
};

const DEFAULT_UNIT = UNIT_COLORS['Money is a tool'];

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
      <section className="junior-hero" style={{ marginBottom: 28 }}>
        <h1>Missions</h1>
        <p>Short money lessons. Finish a mission, earn a reward.</p>
      </section>

      {Object.entries(byUnit).map(([unit, unitMissions]) => {
        const palette = UNIT_COLORS[unit] ?? DEFAULT_UNIT;
        const doneCount = unitMissions.filter((m) => progressByMission[m.id]?.status === 'completed').length;
        return (
          <section key={unit} style={{ marginBottom: 32 }}>
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <h3 style={{ margin: 0, color: palette.fg, fontSize: '1.15rem' }}>{unit}</h3>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.7)',
                  color: palette.fg,
                  border: '1px solid rgba(0,0,0,0.05)',
                }}
              >
                {doneCount} / {unitMissions.length} done
              </span>
            </header>
            <ul className="junior-grid-cards" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {unitMissions.map((m, idx) => {
                const p = progressByMission[m.id];
                const done = p?.status === 'completed';
                return (
                  <li key={m.id}>
                    <Link
                      to={`/junior/mission/${m.id}`}
                      className="junior-mission-card"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        background: done ? 'rgba(16,185,129,0.08)' : 'white',
                        border: done ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(0,0,0,0.05)',
                        borderRadius: 16,
                        padding: '16px 18px',
                        textDecoration: 'none',
                        color: 'inherit',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                        transition: 'transform 150ms ease, box-shadow 150ms ease',
                      }}
                    >
                      <div
                        aria-hidden
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 14,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          background: done ? 'linear-gradient(135deg, #10b981, #059669)' : palette.bg,
                          boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
                          position: 'relative',
                        }}
                      >
                        {done ? (
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {palette.icon}
                          </svg>
                        )}
                        <span
                          style={{
                            position: 'absolute',
                            bottom: -6,
                            right: -6,
                            background: 'white',
                            color: palette.fg,
                            fontSize: '0.65rem',
                            fontWeight: 800,
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                            border: '1px solid rgba(0,0,0,0.05)',
                          }}
                        >
                          {idx + 1}
                        </span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: '0.98rem', display: 'block', lineHeight: 1.3 }}>{m.title}</strong>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: done ? '#059669' : '#6b7280',
                            fontWeight: done ? 600 : 400,
                          }}
                        >
                          {done ? 'Done' : '5-step lesson'}
                        </span>
                      </div>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

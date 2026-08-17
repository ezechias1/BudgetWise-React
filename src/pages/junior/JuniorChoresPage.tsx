import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { reportWriteFailure } from '@/lib/db';
import { useKidProfile } from '@/hooks/useKidProfile';
import { enqueueApprovalNudge } from '@/lib/junior-notifications';

interface Chore {
  id: string;
  name: string;
  reward: number;
  completed: boolean;
  pending_approval: boolean;
}

function formatRands(rands: number): string {
  return `R${rands.toFixed(2)}`;
}

export default function JuniorChoresPage() {
  const { member, loading: profileLoading } = useKidProfile();
  const [chores, setChores] = useState<Chore[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!member) return;
    setLoading(true);
    const { data } = await supabase
      .from('family_chores')
      .select('id, name, reward, completed, pending_approval')
      .eq('assignee', member.id)
      .order('created_at');
    setChores((data as Chore[]) ?? []);
    setLoading(false);
  }, [member]);

  useEffect(() => {
    load();
  }, [load]);

  const markDone = async (chore: Chore) => {
    if (marking) return;
    setMarking(chore.id);
    // .select() so a blocked update is detectable: RLS rejection returns 200
    // with zero rows and no error, which would show the chore as sent for
    // approval when nothing was written.
    const { data: marked, error } = await supabase
      .from('family_chores')
      .update({ pending_approval: true })
      .eq('id', chore.id)
      .select('id');
    if (error || !marked || marked.length === 0) {
      setMarking(null);
      reportWriteFailure(
        'send that chore for approval',
        error?.message ?? "it didn't save — ask a parent to check",
      );
      return;
    }
    if (member) {
      // Enqueue a notification for the parent to approve. Fire-and-forget —
      // failure here shouldn't block the kid's UI feedback.
      void enqueueApprovalNudge(
        member.user_id,
        member.name,
        'chore',
        chore.name,
        '/dashboard/chores',
      );
    }
    setChores((prev) =>
      prev.map((c) => (c.id === chore.id ? { ...c, pending_approval: true } : c)),
    );
    setMarking(null);
  };

  if (profileLoading || loading) return <p>Loading your chores…</p>;
  if (!member) return <p>Couldn&apos;t load your profile. Try logging in again.</p>;

  const todo = chores.filter((c) => !c.completed && !c.pending_approval);
  const pending = chores.filter((c) => c.pending_approval && !c.completed);
  const done = chores.filter((c) => c.completed);

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>Your chores</h1>
        <p>Tap a chore when you&apos;ve done it. Mom or Dad will check it.</p>
      </section>

      {todo.length > 0 && (
        <>
          <h3>To do</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {todo.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'white',
                  borderRadius: 12,
                  padding: '12px 16px',
                  margin: '8px 0',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                }}
              >
                <div>
                  <strong>{c.name}</strong>
                  <br />
                  <small style={{ color: '#10b981', fontWeight: 600 }}>
                    Worth {formatRands(c.reward)}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => markDone(c)}
                  disabled={marking === c.id}
                  style={{
                    background: '#10b981',
                    color: 'white',
                    border: 0,
                    borderRadius: 10,
                    padding: '10px 16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {marking === c.id ? '…' : "I'm done!"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {pending.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Waiting for parent</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {pending.map((c) => (
              <li
                key={c.id}
                style={{
                  background: '#fef3c7',
                  borderRadius: 12,
                  padding: '12px 16px',
                  margin: '8px 0',
                }}
              >
                <strong>{c.name}</strong> · waiting for approval ({formatRands(c.reward)})
              </li>
            ))}
          </ul>
        </>
      )}

      {done.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Done</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {done.map((c) => (
              <li
                key={c.id}
                style={{
                  background: 'rgba(16,185,129,0.1)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  margin: '8px 0',
                  textDecoration: 'line-through',
                  opacity: 0.7,
                }}
              >
                {c.name} · earned {formatRands(c.reward)}
              </li>
            ))}
          </ul>
        </>
      )}

      {chores.length === 0 && (
        <p style={{ textAlign: 'center', marginTop: 40, opacity: 0.7 }}>
          No chores yet. Ask your parent to add some!
        </p>
      )}
    </>
  );
}

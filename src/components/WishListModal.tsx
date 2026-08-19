import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { ok } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useDialogA11y } from '@/hooks/useDialogA11y';

interface Wish {
  id: string;
  name: string;
  cost: number;
  saved: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currency: string;
}

function symbolFor(currency: string): string {
  const sym: Record<string, string> = {
    ZAR: 'R', USD: '$', EUR: '\u20AC', GBP: '\u00A3', NGN: '\u20A6',
    KES: 'KSh', GHS: 'GH\u20B5', INR: '\u20B9', BRL: 'R$', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$',
  };
  return sym[currency] || currency + ' ';
}

/**
 * Wish List modal for Family mode — kids add items they're saving for,
 * track progress, celebrate when they reach the goal.
 * Stores wishes in user_settings.wishes JSONB column (mirrors vanilla).
 * Uses existing .wish-card CSS from dashboard.css.
 */
export function WishListModal({ open, onClose, currency }: Props) {
  const { user } = useAuth();
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [celebrated, setCelebrated] = useState<string | null>(null);
  const dialog = useDialogA11y(open);

  const sym = symbolFor(currency);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_settings')
      .select('wishes')
      .eq('user_id', user.id)
      .maybeSingle();
    setWishes((data as { wishes?: Wish[] } | null)?.wishes || []);
  }, [user]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async (next: Wish[]) => {
    if (!user) return;
    const previous = wishes;
    setWishes(next);
    // Previously discarded: the list is written optimistically, so a failed
    // update left the added/saved/deleted wish on screen until the next
    // reload, when it silently vanished. Roll the optimistic state back so
    // what's shown matches what's stored.
    const saved = await ok(
      supabase
        .from('user_settings')
        .update({ wishes: next })
        .eq('user_id', user.id),
      'save your wish list',
    );
    if (!saved) setWishes(previous);
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const c = parseFloat(cost);
    if (!name.trim() || !c || c <= 0) return;
    const wish: Wish = {
      id: 'wish-' + Date.now(),
      name: name.trim(),
      cost: c,
      saved: 0,
    };
    await save([...wishes, wish]);
    setName('');
    setCost('');
  };

  const handleSave = async (id: string) => {
    const amount = prompt('How much to save toward this wish?');
    if (!amount || isNaN(parseFloat(amount))) return;
    const next = wishes.map((w) => {
      if (w.id !== id) return w;
      const saved = w.saved + parseFloat(amount);
      if (saved >= w.cost) {
        setCelebrated(w.name);
        setTimeout(() => setCelebrated(null), 3000);
      }
      return { ...w, saved };
    });
    await save(next);
  };

  const handleDelete = async (id: string) => {
    await save(wishes.filter((w) => w.id !== id));
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      {...dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wish-list-title"
    >
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 id="wish-list-title">Wish List</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Celebration banner */}
        {celebrated && (
          <div
            style={{
              margin: '0 20px 12px',
              padding: '12px 16px',
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 12,
              textAlign: 'center',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            🎉 Wish achieved! You saved enough for <strong>{celebrated}</strong>!
          </div>
        )}

        {/* Wish items */}
        <div style={{ padding: '0 20px', maxHeight: 340, overflowY: 'auto' }}>
          {wishes.length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                opacity: 0.3,
                fontSize: '0.85rem',
                padding: 20,
              }}
            >
              No wishes yet. Add something you're saving for!
            </p>
          ) : (
            wishes.map((w) => {
              const pct = w.cost > 0 ? Math.min(100, (w.saved / w.cost) * 100) : 0;
              const done = w.saved >= w.cost;
              return (
                <div className="wish-card" key={w.id}>
                  <span className="wish-icon">{done ? '🎉' : '🌟'}</span>
                  <div className="wish-info">
                    <div className="wish-name">{w.name}</div>
                    <div className="wish-cost">
                      {sym}
                      {Number(w.saved).toFixed(2)} / {sym}
                      {Number(w.cost).toFixed(2)}
                    </div>
                  </div>
                  <div className="wish-progress-mini">
                    <div
                      className="wish-progress-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="wish-actions">
                    {!done && (
                      <button
                        className="btn-wish-save"
                        onClick={() => handleSave(w.id)}
                      >
                        + Save
                      </button>
                    )}
                    <button
                      className="btn-wish-delete"
                      onClick={() => handleDelete(w.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add wish form */}
        <form
          onSubmit={handleAdd}
          style={{
            padding: '16px 20px 20px',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
          }}
        >
          <div className="field" style={{ flex: 2 }}>
            <label>Item</label>
            <input
              type="text"
              required
              placeholder="e.g. New headphones"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Cost</label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            style={{ padding: '10px 16px', marginBottom: 2 }}
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}

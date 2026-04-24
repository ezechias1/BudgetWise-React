import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SignInAsKidModal } from './SignInAsKidModal';

interface JuniorKid {
  id: string;
  name: string;
  color: string;
}

/**
 * Always visible in family mode. Fetches Junior-enabled kids for the
 * current parent and lets them sign in as one. Renders:
 *
 *  - loading stub while the query is in flight
 *  - empty state with a "Go to Members" link when the parent has no
 *    Junior kids yet (no silent hide — the user needs to see the button
 *    exists so the flow is discoverable)
 *  - full dropdown with a PIN modal for each kid otherwise
 *
 * Rendered inside the sidebar — matches mode-dropdown styling so it fits
 * naturally next to it on both desktop and mobile.
 */
export function FamilyKidsDropdown() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [kids, setKids] = useState<JuniorKid[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<JuniorKid | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setFetchError(null);
    const { data, error } = await supabase
      .from('family_members')
      .select('id, name, color, auth_user_id')
      .eq('user_id', userId)
      .eq('role', 'child')
      .not('auth_user_id', 'is', null)
      .order('name');
    if (error) {
      console.warn('[FamilyKidsDropdown] fetch failed', error);
      setFetchError(error.message);
      setKids([]);
    } else {
      setKids((data as JuniorKid[]) ?? []);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <>
      <div
        className={`mode-dropdown ${open ? 'open' : ''}`}
        ref={wrapperRef}
        style={{ marginTop: -8 }}
      >
        <button
          type="button"
          className="mode-dropdown-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Sign in as a Junior kid"
        >
          <div className="mode-dropdown-selected">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22a8 8 0 0 1 16 0" />
            </svg>
            <span>Kids{!loading && ` (${kids.length})`}</span>
          </div>
          <svg
            className="mode-chevron"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div className="mode-dropdown-menu">
            {loading && (
              <div style={{ padding: '10px 14px', opacity: 0.7, fontSize: '0.85rem' }}>
                Loading kids…
              </div>
            )}
            {!loading && fetchError && (
              <div style={{ padding: '10px 14px', color: '#dc2626', fontSize: '0.85rem' }}>
                Couldn&apos;t load kids. {fetchError}
              </div>
            )}
            {!loading && !fetchError && kids.length === 0 && (
              <Link
                to="/dashboard/members"
                className="mode-option"
                onClick={() => setOpen(false)}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <small style={{ opacity: 0.8 }}>
                  No Junior kids yet. Tap to add one from Members.
                </small>
              </Link>
            )}
            {!loading && !fetchError &&
              kids.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="mode-option"
                  onClick={() => {
                    setOpen(false);
                    setPinTarget(k);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: k.color,
                      color: 'white',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {k.name.charAt(0).toUpperCase()}
                  </span>
                  <span>Sign in as {k.name}</span>
                </button>
              ))}
          </div>
        )}
      </div>
      {pinTarget && (
        <SignInAsKidModal
          memberId={pinTarget.id}
          name={pinTarget.name}
          color={pinTarget.color}
          onClose={() => setPinTarget(null)}
        />
      )}
    </>
  );
}

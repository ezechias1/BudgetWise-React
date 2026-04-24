import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SignInAsKidModal } from './SignInAsKidModal';

interface JuniorKid {
  id: string;
  name: string;
  color: string;
}

export function FamilyKidsDropdown() {
  const { user } = useAuth();
  const [kids, setKids] = useState<JuniorKid[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<JuniorKid | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('family_members')
        .select('id, name, color, auth_user_id')
        .eq('user_id', user.id)
        .eq('role', 'child')
        .not('auth_user_id', 'is', null)
        .order('name');
      if (cancelled) return;
      setKids((data as JuniorKid[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (loading || kids.length === 0) return null;

  return (
    <>
      <div className="mode-dropdown" ref={wrapperRef} style={{ marginTop: 8 }}>
        <button
          type="button"
          className="mode-dropdown-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Switch to Junior for a kid"
        >
          <div className="mode-dropdown-selected">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22a8 8 0 0 1 16 0" />
            </svg>
            <span>Kids ({kids.length})</span>
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
            {kids.map((k) => (
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

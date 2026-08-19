import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Mode } from '@/types';
import { isModeAvailable } from '@/lib/features';

interface ModeContextValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
  /** Resolve a nav label for the current mode, matching the vanilla
   *  `data-personal`/`data-business`/`data-family` attribute pattern. */
  label: (labels: Partial<Record<Mode, string>>, fallback: string) => string;
}

const ModeContext = createContext<ModeContextValue | null>(null);
const STORAGE_KEY = 'bw-mode';

function readInitialMode(): Mode {
  if (typeof window === 'undefined') return 'personal';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'business' || stored === 'family' || stored === 'personal') {
    // A workspace can be closed after someone has already been in it — anyone
    // who last used Business still has it in localStorage. Fall back rather
    // than restoring them into a mode the rest of the app now hides.
    return isModeAvailable(stored) ? stored : 'personal';
  }
  return 'personal';
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(readInitialMode);

  // Mirror the mode onto <body> so existing CSS selectors
  // (.business-mode / .family-mode) keep controlling --accent.
  useEffect(() => {
    const body = document.body;
    body.classList.remove('business-mode', 'family-mode', 'personal');
    if (mode === 'business') body.classList.add('business-mode');
    else if (mode === 'family') body.classList.add('family-mode');
    else body.classList.add('personal');
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  // Every control that offers a closed mode is disabled, so this is the net
  // rather than the gate: it means no future call site can enter one by
  // accident, and there is no half-state where the body class says business
  // but nothing can be reached.
  const setMode = useCallback((next: Mode) => {
    if (!isModeAvailable(next)) return;
    setModeState(next);
  }, []);

  const label = useCallback(
    (labels: Partial<Record<Mode, string>>, fallback: string) =>
      labels[mode] ?? fallback,
    [mode],
  );

  return (
    <ModeContext.Provider value={{ mode, setMode, label }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used within <ModeProvider>');
  return ctx;
}

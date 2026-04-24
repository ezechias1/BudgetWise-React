import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { JuniorStrings, LangCode } from './types';
import { SA_LANGUAGES } from './languages';
import { en } from './en';
import { af } from './af';
import { zu } from './zu';

export { SA_LANGUAGES };
export type { LangCode, JuniorStrings };

// Only fully-translated bundles are registered. All others fall back to en.
// Adding a language = drop a new bundle in and add it here.
const BUNDLES: Partial<Record<LangCode, JuniorStrings>> = { en, af, zu };

const STORAGE_KEY = 'bw-junior-lang';

function readStoredLang(): LangCode {
  if (typeof window === 'undefined') return 'en';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw && SA_LANGUAGES.some((l) => l.code === raw)) return raw as LangCode;
  return 'en';
}

interface Ctx {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: JuniorStrings;
}

const JuniorLangContext = createContext<Ctx | null>(null);

export function JuniorLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(readStoredLang);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang: setLangState,
      t: BUNDLES[lang] ?? en,
    }),
    [lang],
  );

  return <JuniorLangContext.Provider value={value}>{children}</JuniorLangContext.Provider>;
}

export function useJuniorLang(): Ctx {
  const ctx = useContext(JuniorLangContext);
  if (!ctx) {
    // Graceful fallback when the provider isn't mounted (e.g. parent surface
    // renders a Junior component): return en so nothing crashes.
    return { lang: 'en', setLang: () => {}, t: en };
  }
  return ctx;
}

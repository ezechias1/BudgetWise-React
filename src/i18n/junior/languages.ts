import type { LangCode } from './types';

// Order: English first (fallback), then alphabetical by native name.
// `translated: false` means strings still fall back to English — shown in the
// selector as "(coming soon)" for honesty.
export interface LangMeta {
  code: LangCode;
  native: string;
  english: string;
  translated: boolean;
}

export const SA_LANGUAGES: LangMeta[] = [
  { code: 'en',  native: 'English',     english: 'English',          translated: true },
  { code: 'af',  native: 'Afrikaans',   english: 'Afrikaans',        translated: true },
  { code: 'zu',  native: 'isiZulu',     english: 'isiZulu',          translated: true },
  { code: 'xh',  native: 'isiXhosa',    english: 'isiXhosa',         translated: false },
  { code: 'nr',  native: 'isiNdebele',  english: 'isiNdebele',       translated: false },
  { code: 'nso', native: 'Sepedi',      english: 'Sepedi',           translated: false },
  { code: 'st',  native: 'Sesotho',     english: 'Sesotho',          translated: false },
  { code: 'tn',  native: 'Setswana',    english: 'Setswana',         translated: false },
  { code: 'ss',  native: 'siSwati',     english: 'siSwati',          translated: false },
  { code: 'ts',  native: 'Xitsonga',    english: 'Xitsonga',         translated: false },
  { code: 've',  native: 'Tshivenḓa',   english: 'Tshivenda',        translated: false },
];

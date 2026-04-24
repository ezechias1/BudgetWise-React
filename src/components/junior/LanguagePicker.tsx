import { SA_LANGUAGES, useJuniorLang, type LangCode } from '@/i18n/junior';

interface Props {
  compact?: boolean;
}

export function LanguagePicker({ compact = false }: Props) {
  const { lang, setLang, t } = useJuniorLang();

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: compact ? '0.8rem' : '0.9rem',
        color: '#4b5563',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span className="visually-hidden" style={{ position: 'absolute', left: -9999 }}>
        {t.language_label}
      </span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as LangCode)}
        aria-label={t.language_label}
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: compact ? '4px 8px' : '6px 10px',
          fontSize: 'inherit',
          color: '#1f2937',
          cursor: 'pointer',
        }}
      >
        {SA_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
            {!l.translated ? ` — ${t.language_coming_soon}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

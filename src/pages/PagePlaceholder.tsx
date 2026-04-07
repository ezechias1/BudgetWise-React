interface Props {
  title: string;
  note?: string;
}

/**
 * Temporary stub used by every page that hasn't been ported yet.
 * Keeps the sidebar + layout testable without pretending pages are done.
 * Remove as each page is properly ported from the vanilla app.
 */
export default function PagePlaceholder({ title, note }: Props) {
  return (
    <div style={{ padding: '32px 24px', maxWidth: 720 }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: 12 }}>{title}</h1>
      <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
        {note ?? 'This page has not been ported from the vanilla app yet.'}
      </p>
      <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 16, fontSize: '0.85rem' }}>
        Reference: <code>~/Desktop/BudgetWise/dashboard.html</code> and{' '}
        <code>js/app.js</code>
      </p>
    </div>
  );
}

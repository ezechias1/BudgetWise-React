/**
 * Line icons for the How to Use cards, replacing the emoji that used to sit
 * there. Emoji render differently on every platform (and some of the ones in
 * use here — the printer, eye and receipt — have no emoji presentation at all
 * on several systems, so they showed as flat monochrome glyphs next to full
 * colour ones), and they don't pick up the theme accent.
 *
 * Same 24x24 stroke style as the sidebar icons, and `currentColor` throughout
 * so `.help-card-icon` controls the colour.
 */

const PATHS: Record<string, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
      <path d="M21 9v6h-4a3 3 0 0 1 0-6h4z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  exchange: (
    <>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  bank: (
    <>
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v8M10 10v8M14 10v8M19 10v8" />
      <path d="M3 21h18" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M6 15h12v6H6z" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h8V3" />
      <rect x="8" y="13" width="8" height="6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h11l-2.5 4L17 12H6" />
    </>
  ),
  invoice: (
    <>
      <path d="M6 2h9l4 4v16H6z" />
      <path d="M15 2v5h4" />
      <path d="M9 12h7M9 16h7" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 7" />
      <path d="M17.5 14.5A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  trendUp: (
    <>
      <path d="M3 17l6-6 4 4 7-7" />
      <path d="M15 8h5v5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  family: (
    <>
      <circle cx="7" cy="8" r="3" />
      <circle cx="17" cy="8" r="3" />
      <path d="M2 20a5 5 0 0 1 10 0" />
      <path d="M12 20a5 5 0 0 1 10 0" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5H5v2a3 3 0 0 0 3 3" />
      <path d="M16 5h3v2a3 3 0 0 1-3 3" />
      <path d="M12 13v4" />
      <path d="M9 21h6l-1-4h-4z" />
    </>
  ),
  star: <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.4l6-.8z" />,
  medal: (
    <>
      <circle cx="12" cy="15" r="6" />
      <path d="M9 3h6l-2 6h-2z" />
      <path d="m12 13 .8 1.7 1.9.3-1.4 1.3.3 1.9-1.6-.9-1.6.9.3-1.9-1.4-1.3 1.9-.3z" />
    </>
  ),
  report: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 13v4M12 10v7M16 15v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9" />
      <path d="M17 12v4M20 12v3" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  // Three jars at different fill levels — Save / Spend / Give.
  jars: (
    <>
      <rect x="2.5" y="8" width="5" height="12" rx="1.5" />
      <rect x="9.5" y="8" width="5" height="12" rx="1.5" />
      <rect x="16.5" y="8" width="5" height="12" rx="1.5" />
      <path d="M2.5 12h5M9.5 15h5M16.5 17h5" />
      <path d="M3.5 8V6h3v2M10.5 8V6h3v2M17.5 8V6h3v2" />
    </>
  ),
  // Chores read better as a ticked checklist than as a broom, which at 26px
  // was just a diagonal stroke.
  broom: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="m7.5 9 1.5 1.5L12 7.5" />
      <path d="m7.5 16 1.5 1.5L12 14.5" />
      <path d="M14 9.5h3M14 16.5h3" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 2h14v20l-2.3-1.6L14.4 22l-2.4-1.6L9.6 22l-2.3-1.6L5 22z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m6 6 12 12" />
    </>
  ),
  userSwitch: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M17 6h4v4" />
      <path d="M21 6a6 6 0 0 1-3 9" />
    </>
  ),
};

export function HelpIcon({ name }: { name: string }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

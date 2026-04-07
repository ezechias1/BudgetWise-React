// Chart.js color helpers — ported from js/app.js `chartColors()` (line 2235).
// Reads body.classList so the theme matches the current dark/light state.

export function isLight(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('light');
}

export function chartColors() {
  const light = isLight();
  return {
    text: light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.4)',
    textStrong: light ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)',
    grid: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)',
    legendText: light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)',
    tick: light ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)',
  };
}

/** Shared tooltip config used by every chart in the app. */
export function chartTooltip() {
  const light = isLight();
  return {
    backgroundColor: light ? 'rgba(26,26,46,0.9)' : 'rgba(0,0,0,0.8)',
    titleColor: '#fff',
    bodyColor: 'rgba(255,255,255,0.8)',
    borderColor: light ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    padding: 12,
    cornerRadius: 10,
    titleFont: { family: 'Inter', weight: 600 as const },
    bodyFont: { family: 'Inter' },
  };
}

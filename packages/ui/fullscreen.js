// packages/ui/fullscreen.js - a corner button that puts a venue screen (stage dashboard, public Galaxy) into true full
// screen, hiding the browser's address bar, tabs and toolbars (D-51). It fades away after a few seconds without mouse
// movement so the display stays clean, comes back on any movement or tap, and "F" toggles it from the keyboard. Where
// the Fullscreen API is missing (e.g. iPhone Safari) the button is not shown. Self-contained: styles are injected once.

const STYLE_ID = 'ui-fullscreen-style';
const IDLE_MS = 3000;
const ICON_ENTER = 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
const ICON_EXIT = 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5';

const CSS = `
.ui-fs-btn { position: fixed; top: max(14px, env(safe-area-inset-top)); right: max(14px, env(safe-area-inset-right)); z-index: 60;

  width: 52px; height: 52px; display: grid; place-items: center; border-radius: 50%; cursor: pointer; padding: 0;
  color: #fff; background: rgba(20, 16, 62, .72); border: 2px solid rgba(231, 223, 255, .35);
  box-shadow: 0 6px 16px rgba(5, 8, 30, .5); backdrop-filter: blur(6px); transition: opacity .4s ease, transform .2s ease; }
.ui-fs-btn--left { right: auto; left: max(14px, env(safe-area-inset-left)); }
.ui-fs-btn:hover { transform: scale(1.06); border-color: #B6FF5C; }
.ui-fs-btn:focus-visible { outline: 3px solid #B6FF5C; outline-offset: 3px; }
.ui-fs-btn.is-idle { opacity: 0; pointer-events: none; }
.ui-fs-btn svg { width: 26px; height: 26px; }
@media (prefers-reduced-motion: reduce) { .ui-fs-btn { transition: none; } }
`;

function fsElement(doc) { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }
function fsEnabled(doc) { return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled); }

/** Mounts the button on `doc.body` in the top `corner` ('right' | 'left'). Returns { dispose } (a no-op when full screen is not supported). */
export function mountFullscreenButton({ doc = typeof document !== 'undefined' ? document : null, enterLabel = 'Full screen', exitLabel = 'Exit full screen', corner = 'right' } = {}) {
  if (!doc || !doc.body || !fsEnabled(doc)) return { dispose() {} };
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style'); style.id = STYLE_ID; style.textContent = CSS; doc.head.appendChild(style);
  }
  const NS = 'http://www.w3.org/2000/svg';
  const btn = doc.createElement('button');
  btn.type = 'button'; btn.className = corner === 'left' ? 'ui-fs-btn ui-fs-btn--left' : 'ui-fs-btn';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.4'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const path = doc.createElementNS(NS, 'path'); svg.appendChild(path); btn.appendChild(svg);
  doc.body.appendChild(btn);

  const sync = () => {
    const on = !!fsElement(doc);
    path.setAttribute('d', on ? ICON_EXIT : ICON_ENTER);
    btn.setAttribute('aria-label', on ? exitLabel : enterLabel);
    btn.title = `${on ? exitLabel : enterLabel} (F)`;
  };
  const toggle = () => {
    const el = doc.documentElement;
    if (fsElement(doc)) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
  };
  let idle = 0;
  const wake = () => { btn.classList.remove('is-idle'); clearTimeout(idle); idle = setTimeout(() => { if (doc.activeElement !== btn) btn.classList.add('is-idle'); }, IDLE_MS); };
  const onKey = (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) { e.preventDefault(); toggle(); }
  };
  btn.addEventListener('click', toggle);
  btn.addEventListener('focus', wake);
  doc.addEventListener('fullscreenchange', sync); doc.addEventListener('webkitfullscreenchange', sync);
  doc.addEventListener('pointermove', wake, { passive: true }); doc.addEventListener('pointerdown', wake, { passive: true });
  doc.addEventListener('keydown', onKey);
  sync(); wake();
  return {
    dispose() {
      clearTimeout(idle); btn.remove();
      doc.removeEventListener('fullscreenchange', sync); doc.removeEventListener('webkitfullscreenchange', sync);
      doc.removeEventListener('pointermove', wake); doc.removeEventListener('pointerdown', wake); doc.removeEventListener('keydown', onKey);
    },
  };
}

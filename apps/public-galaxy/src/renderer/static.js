// Static reduced-effects renderer (fallback tier 3, P-07): one composed frame, no animation loop.
// Used for `?mode=static`, prefers-reduced-motion (when the operator did not force a live renderer) and when
// both live renderers fail. Composition: nebula + star layer 1 + orbit rings + Souls at `simple` detail.
// galaxy.js re-renders it once per snapshot / accepted Float (Souls appear with no transition).
import { createCanvas2dRenderer } from './canvas2d.js';

export function createStaticRenderer(opts = {}) {
  const inner = createCanvas2dRenderer({ ...opts, staticMode: true });
  return {
    kind: 'static',
    canvas: inner.canvas,
    resize: inner.resize,
    /** Draws a single frame from a scene draw list computed at t = 0 (no twinkle, no drift, no entrances). */
    render(f) {
      const still = { ...f, stars: f.stars.slice(0, 1), entrances: [], souls: f.souls.map(s => ({ ...s, detail: s.detail === 'full' ? 'simple' : s.detail })).concat(f.entrances.map(e => ({ ...e, detail: 'simple', scale: 1, alpha: 1 }))) };
      inner.render(still);
    },
    dispose: inner.dispose,
    onLost() {},
  };
}

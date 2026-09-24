// Soul sprite atlas: renderSoulSvg -> data: URL -> Image -> offscreen canvas, packed in 48..192 px cells
// (scene.js#atlasCellFor: 1.5 x the device size so the v2 die-cut and speckles stay crisp) and cached by
// soulId + detail + badge (+ cell). Browser-only (Image/canvas); imported by canvas2d.js, webgl2.js, static.js and
// three.js. CSP: img-src 'self' data: blob: allows the data: URL rasterisation.
// Art direction v2: the atlas is always rasterised at detail 'simple' (the 'full' level needs SVG filters that blur
// at cell sizes and rasterise slowly); `maxDetail` caps every request, so phone thumbnails and the Galaxy match.
import { renderSoulSvg } from '../../../../packages/ui/soul-renderer.js';
import { ATLAS_CELLS, atlasCellFor } from './scene.js';

const ATLAS_SIZE = 2048;               // one 2048^2 RGBA page = 16 MB, well under the 64 MB budget
const MAX_PAGES = 3;
const DETAIL_RANK = { dot: 0, simple: 1, full: 2 };

export function capDetail(detail, maxDetail = 'simple') {
  const want = DETAIL_RANK[detail] ?? 1, cap = DETAIL_RANK[maxDetail] ?? 2;
  return want > cap ? maxDetail : detail;
}

export function createAtlas(opts = {}) {
  const pageSize = opts.pageSize || ATLAS_SIZE;
  const maxDetail = opts.maxDetail || 'simple';
  const pages = [];                     // { canvas, ctx, shelves: [{ y, h, x }] }
  const entries = new Map();            // key -> { page, x, y, w, h, ready, image }
  const pending = new Map();            // key -> Promise
  let version = 0;
  let placeholder = null;

  function newPage() {
    if (pages.length >= MAX_PAGES) return null;
    const canvas = document.createElement('canvas');
    canvas.width = pageSize; canvas.height = pageSize;
    const page = { canvas, ctx: canvas.getContext('2d'), shelves: [], nextY: 0, index: pages.length };
    pages.push(page);
    return page;
  }

  /** Shelf packing: one shelf per cell height; returns { page, x, y }. */
  function allocate(size) {
    for (const page of pages) {
      let shelf = page.shelves.find(s => s.h === size && s.x + size <= pageSize);
      if (!shelf && page.nextY + size <= pageSize) { shelf = { y: page.nextY, h: size, x: 0 }; page.shelves.push(shelf); page.nextY += size; }
      if (shelf) { const slot = { page, x: shelf.x, y: shelf.y }; shelf.x += size; return slot; }
    }
    const page = newPage();
    if (!page) return null;
    return allocate(size);
  }

  function keyFor(soulId, detail, badge, cell) { return `${soulId}|${detail}|${badge || ''}|${cell}`; }

  function rasterise(svg, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('soul rasterise failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      img.width = size; img.height = size;
    });
  }

  /**
   * Returns the atlas entry for a Soul, requesting rasterisation on first use. `entry.ready` is false until the
   * image has landed on the page; renderers then draw a placeholder dot (same size, palette-neutral).
   */
  function get(soul, detail, devicePx) {
    const d = capDetail(detail, maxDetail);
    const cell = atlasCellFor(devicePx);
    const key = keyFor(soul.soulId, d, soul.badge, cell);
    let entry = entries.get(key);
    if (entry) return entry;
    const slot = allocate(cell);
    entry = { key, page: slot ? slot.page.index : -1, canvas: slot ? slot.page.canvas : null, x: slot ? slot.x : 0, y: slot ? slot.y : 0, w: cell, h: cell, ready: false, failed: !slot, detail: d };
    entries.set(key, entry);
    if (!slot) return entry;
    const svg = renderSoulSvg(soul.config, { size: cell, detail: d, badge: soul.badge || null, reducedMotion: true, idPrefix: `pg-${String(soul.soulId).replace(/[^A-Za-z0-9_-]/g, '')}-${d}-${cell}` });
    const p = rasterise(svg, cell).then(img => {
      slot.page.ctx.clearRect(slot.x, slot.y, cell, cell);
      slot.page.ctx.drawImage(img, slot.x, slot.y, cell, cell);
      entry.ready = true; version++;
    }).catch(() => { entry.failed = true; }).finally(() => pending.delete(key));
    pending.set(key, p);
    return entry;
  }

  /** Warm the cache for a list of Souls at a detail and size (returns a promise resolved when all landed). */
  function preload(souls, detail, devicePx) {
    for (const s of souls) get(s, detail, devicePx);
    return Promise.allSettled([...pending.values()]);
  }

  /** Small neutral glow disc used while a sprite is still rasterising (never palette-specific). */
  function getPlaceholder() {
    if (placeholder) return placeholder;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(220,230,255,0.9)'); g.addColorStop(0.4, 'rgba(180,200,255,0.35)'); g.addColorStop(1, 'rgba(180,200,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    placeholder = c;
    return c;
  }

  return {
    get, preload, getPlaceholder,
    get version() { return version; },
    get pages() { return pages; },
    get size() { return entries.size; },
    pageSize, maxDetail,
    cells: ATLAS_CELLS,
    cellFor: atlasCellFor,
    clear() { entries.clear(); pages.length = 0; version++; },
  };
}

/** Pre-rendered additive star sprite (soft disc) for Canvas 2D star layers. */
export function makeStarSprite(color = '#DCE6FF', size = 32) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, color); g.addColorStop(0.25, color); g.addColorStop(0.55, hexToRgba(color, 0.35)); g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return c;
}

export function hexToRgba(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Load nebula.svg into an Image once (drawn with drawImage / uploaded as a texture). */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed: ' + url));
    img.src = url;
  });
}

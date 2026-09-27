// Canvas 2D renderer (fallback tier 2, P-07). Draws the same scene as webgl2.js from scene.frame() draw lists:
// the space backdrop (stage 15, D-36: the Blender plate, the constellation lines and their stars, the meteors - all
// still here, space.js at rest; a plain dark sky without space.json), pre-rendered star sprites (additive), dashed
// orbit rings, Soul sprites from the atlas (normal alpha), entrance trail / glow (additive), the say-hi visit, the
// meteors in front and a soft foreground vignette. The canvas element is sized to the Galaxy region only, so nothing
// can be painted at x >= panelX (safe zone).
import { makeStarSprite, hexToRgba } from './atlas.js';
import { backdropPlacement, constellationPlacement, constellationStars, meteorPose } from './space.js';
import { PALETTES, resolveSoul } from '../../../../packages/ui/soul-renderer.js';

export function createCanvas2dRenderer({ container, atlas, space = null, background = '#0B0F1F', dpr = 1, staticMode = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'galaxy__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) throw new Error('canvas2d unavailable');
  container.appendChild(canvas);
  const starSprites = new Map();
  let width = 1, height = 1;
  let disposed = false;

  function starSprite(color) {
    let s = starSprites.get(color);
    if (!s) { s = makeStarSprite(color || '#DCE6FF', 32); starSprites.set(color, s); }
    return s;
  }

  function resize(w, h) {
    width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  }

  // ---- space (still): the plate, the constellation lines and stars, the meteors behind / in front of the Souls ----
  const spec = space && space.spec ? space.spec : null;
  const simg = (space && space.images) || {};
  const aspect = (img) => img.width / img.height || 1;
  function drawMeteors(front) {
    if (!spec) return;
    spec.meteors.forEach((m, i) => {
      const img = (simg.meteors || [])[i];
      if (!img || m.front !== front) return;
      const p = meteorPose(m, width, height, 0, { reducedMotion: true });
      const h = p.size, w = h * aspect(img);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rotDeg * Math.PI) / 180); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
    });
  }
  function drawSpace() {
    if (!spec) return;
    ctx.globalAlpha = 1;
    if (simg.backdrop) { const b = backdropPlacement(spec, width, height, 0, { reducedMotion: true, aspect: aspect(simg.backdrop) }); ctx.drawImage(simg.backdrop, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h); }
    const plate = constellationPlacement(spec, width, height, 0, { reducedMotion: true, aspect: simg.constellations ? aspect(simg.constellations) : undefined });
    if (simg.constellations) ctx.drawImage(simg.constellations, plate.x - plate.w / 2, plate.y - plate.h / 2, plate.w, plate.h);
    ctx.globalCompositeOperation = 'lighter';
    const sprite = starSprite('#EEF2FF');
    for (const s of constellationStars(spec, plate, height, 0, { reducedMotion: true })) { const d = s.r * 6; ctx.globalAlpha = s.a; ctx.drawImage(sprite, s.x - d / 2, s.y - d / 2, d, d); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawMeteors(false);
  }

  function drawStars(f) {
    ctx.globalCompositeOperation = 'lighter';
    for (const layer of f.stars) {
      const sprite = starSprite(layer.color);
      for (const p of layer.points) {
        const d = Math.max(2, p.r * 3.2);
        ctx.globalAlpha = Math.min(1, p.a * 1.3);
        ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRings(f) {
    if (!f.rings.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(169,190,255,0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 10]);
    for (const r of f.rings) {
      ctx.beginPath(); ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSprite(item, detail, size, alpha, scale) {
    const entry = atlas.get(item, detail, size * dpr);
    const d = size * (scale || 1);
    ctx.globalAlpha = alpha;
    if (entry.ready && entry.canvas) ctx.drawImage(entry.canvas, entry.x, entry.y, entry.w, entry.h, item.x - d / 2, item.y - d / 2, d, d);
    else { const ph = atlas.getPlaceholder(); ctx.drawImage(ph, item.x - d * 0.35, item.y - d * 0.35, d * 0.7, d * 0.7); }
    ctx.globalAlpha = 1;
  }

  function glowColor(item) {
    const s = resolveSoul(item.config);
    return s.pal ? s.pal.glow : PALETTES[0].glow;
  }

  function drawGlow(item, strength) {
    if (strength <= 0) return;
    const r = item.size * 0.9;
    const g = ctx.createRadialGradient(item.x, item.y, r * 0.1, item.x, item.y, r);
    const c = glowColor(item);
    g.addColorStop(0, hexToRgba(c, 0.35 * strength)); g.addColorStop(1, hexToRgba(c, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(item.x, item.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawEntrances(f) {
    for (const e of f.entrances) {
      if (e.trail && e.trail.length && f.level.entranceTrail) {
        ctx.globalCompositeOperation = 'lighter';
        const c = glowColor(e);
        for (const tpt of e.trail) { ctx.fillStyle = hexToRgba(c, Math.max(0, tpt.alpha)); ctx.beginPath(); ctx.arc(tpt.x, tpt.y, e.size * 0.18, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      }
      drawGlow(e, e.glow || 0);
      drawSprite(e, 'full', e.size, e.alpha, e.scale);
    }
  }

  /** The Soul visiting the front to say hi (stage 15): its sprite at the drawn size (a cell to match) and a soft glow. */
  function drawVisits(f) {
    for (const v of f.visits || []) {
      const big = { ...v, size: v.size * (v.scale || 1) };
      drawGlow(big, 0.6);
      drawSprite(big, 'full', big.size, v.alpha ?? 1, 1);
    }
  }

  function drawClusters(f) {
    if (!f.clusters.length) return;
    ctx.font = `600 ${Math.round(14 * f.layout.scale + 6)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const c of f.clusters) {
      drawSprite(c, 'dot', c.size, 1, 1);
      if (c.label) { ctx.fillStyle = '#B4BCE0'; ctx.fillText(c.label, c.x, c.y + c.size / 2 + 2); }
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.15, width / 2, height / 2, Math.max(width, height) * 0.7);
    g.addColorStop(0, 'rgba(165,148,255,0.10)'); g.addColorStop(1, 'rgba(165,148,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }

  function render(f) {
    if (disposed) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    drawSpace();
    drawStars(f);
    drawRings(f);
    for (const item of f.souls) drawSprite(item, item.detail, item.size, item.alpha, item.scale);
    drawClusters(f);
    drawEntrances(f);
    drawVisits(f);
    drawMeteors(true);
    if (!staticMode) drawVignette();
  }

  return {
    kind: staticMode ? 'static' : 'canvas2d', canvas, resize, render,
    dispose() { disposed = true; if (canvas.parentNode) canvas.parentNode.removeChild(canvas); },
    onLost() { /* Canvas 2D has no context loss event */ },
  };
}

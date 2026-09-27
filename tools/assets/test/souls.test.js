// Stage 3.2 hard checks for the Arise Soul renderer, cohort assets, scene assets and manifest. Run: node --test tools/assets/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSoulSvg, soulAltText, soulOrbitSlot, PALETTES, BODY_PATHS, TRAITS, ORBIT_RINGS, ORBIT_CAPACITY, hash32, BADGE_LABEL, BADGE_CENTER } from '../../../packages/ui/soul-renderer.js';
import { SILHOUETTE, BOUNDS, EYES, ORB } from '../../../packages/ui/soul-baseline-shape.js';
import { SOUL_TRAITS, validateSoulConfig, soulConfigFromSeed } from '../../../packages/game-rules/src/soul.js';
import { parseManifest, sha256, MANIFEST_FIELDS } from '../lib/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAX_FULL_BYTES = 6 * 1024;
const CONST = [{ domain: 'Design', weight: 0.4 }, { domain: 'Cloud', weight: 0.3 }, { domain: 'Development', weight: 0.15 }, { domain: 'User Experience', weight: 0.1 }, { domain: 'Data & Analytics', weight: 0.05 }];
const sample = { seed: 'abc123', body: 0, palette: 1, eyes: 0, antenna: 0, mouth: 0, glow: 0, constellation: CONST, driftPhase: 0.42 };

test('trait vocabulary matches the locked game-rules vocabulary', () => {
  for (const k of Object.keys(SOUL_TRAITS)) assert.deepEqual([...TRAITS[k]], [...SOUL_TRAITS[k]], k);
  assert.equal(PALETTES.length, 8);
  assert.deepEqual(PALETTES.map((p) => p.name), [...TRAITS.palette]);
  assert.deepEqual(Object.keys(BODY_PATHS), [...TRAITS.body]);
});

test('same config renders byte-identical SVG', () => {
  const a = renderSoulSvg(sample, { badge: 'bingo-star' });
  const b = renderSoulSvg(JSON.parse(JSON.stringify(sample)), { badge: 'bingo-star' });
  assert.equal(a, b);
  assert.equal(renderSoulSvg(sample, { detail: 'simple' }), renderSoulSvg(sample, { detail: 'simple' }));
  assert.equal(renderSoulSvg(sample, { detail: 'dot' }), renderSoulSvg(sample, { detail: 'dot' }));
});

test('all 6x8x6x6x4x3 trait combinations render, are complete SVGs and stay under 6 KB at full detail', () => {
  let count = 0, max = 0;
  for (let b = 0; b < 6; b++) for (let p = 0; p < 8; p++) for (let e = 0; e < 6; e++) for (let a = 0; a < 6; a++) for (let m = 0; m < 4; m++) for (let g = 0; g < 3; g++) {
    const cfg = { seed: `c${count}`, body: b, palette: p, eyes: e, antenna: a, mouth: m, glow: g, constellation: CONST, driftPhase: (count % 100) / 100 };
    const svg = renderSoulSvg(cfg, { badge: count % 7 === 0 ? 'bingo-star' : null });
    const bytes = Buffer.byteLength(svg);
    max = Math.max(max, bytes);
    assert.ok(bytes <= MAX_FULL_BYTES, `combo ${count} is ${bytes} bytes`);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith('</svg>'));
    assert.ok(svg.includes('role="img"') && svg.includes('aria-label="Arise Soul,'));
    count++;
  }
  assert.equal(count, 20736);
  assert.ok(max <= MAX_FULL_BYTES);
});

test('accepts trait names as well as indices and clamps out-of-range indices', () => {
  assert.equal(renderSoulSvg({ ...sample, body: 'bell', palette: 'mint', eyes: 'wink' }), renderSoulSvg({ ...sample, body: 1, palette: 4, eyes: 4 }));
  assert.doesNotThrow(() => renderSoulSvg({ seed: 'x', body: 99, palette: -1, eyes: 'nope' }));
  assert.doesNotThrow(() => renderSoulSvg(null));
  assert.doesNotThrow(() => renderSoulSvg({}));
});

test('body silhouettes stay inside the viewBox with margin (no clipping)', () => {
  // v3 draws the baseline character (D-27): its silhouette, die-cut (5 units) and shadow stay inside the viewBox
  const nums = SILHOUETTE.match(/-?(?:\d+\.?\d*|\.\d+)/g).map(Number);
  assert.ok(nums.length > 60 && /^M[-\d. ]+(c[-\d. ]+)+z$/.test(SILHOUETTE), 'baseline silhouette uses only M/c/z');
  assert.ok(BOUNDS.x0 - 5 >= 24 && BOUNDS.x1 + 5 <= 176, 'baseline x within margin');
  assert.ok(BOUNDS.y0 - 5 >= 12 && BOUNDS.y1 + 5 + 6 <= 196, 'baseline y within margin (antenna orb on top, shadow below)');
  // legacy v2 bodies (exported for backward compatibility, no longer drawn)
  for (const [name, d] of Object.entries(BODY_PATHS)) {
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    assert.ok(Math.min(...xs) >= 24 && Math.max(...xs) <= 176, `${name} x out of margin`);
    assert.ok(Math.min(...ys) >= 24 && Math.max(...ys) <= 176, `${name} y out of margin`);
    assert.ok(/^M[\d. C]+Z$/.test(d), `${name} uses only M/C/Z`);
  }
});

test('alt text never mentions Platform, Role, rank or capability', () => {
  const banned = /platform|role|rank|level|score|senior|junior|strong|weak|best|top/i;
  for (let b = 0; b < 6; b++) for (let p = 0; p < 8; p++) for (let e = 0; e < 6; e++) {
    const t = soulAltText({ body: b, palette: p, eyes: e }, 'bingo-star');
    assert.ok(!banned.test(t), t);
    // v3 describes what is drawn: the baseline character in its palette (body/eyes traits are not drawn, D-27)
    assert.match(t, /^Arise Soul, [a-z]+ colour, with round button eyes and a glowing antenna orb\. Bingo Star badge: completed a line this round$/);
  }
  assert.equal(soulAltText(sample), 'Arise Soul, lagoon colour, with round button eyes and a glowing antenna orb');
});

test('badge is present only when requested, is labelled, and sits away from the face', () => {
  const without = renderSoulSvg(sample);
  const withBadge = renderSoulSvg(sample, { badge: 'bingo-star' });
  assert.ok(!without.includes(BADGE_LABEL));
  assert.ok(withBadge.includes(`aria-label="${BADGE_LABEL}"`) && withBadge.includes(`<title>${BADGE_LABEL}</title>`));
  assert.ok(withBadge.includes('aria-label="Arise Soul, lagoon colour, with round button eyes and a glowing antenna orb. Bingo Star badge'));
  // gold star with a white outline, upper right (BADGE_CENTER); the baseline's eyes and antenna orb must stay clear
  const m = withBadge.match(/<g role="img" aria-label="[^"]+" transform="translate\((\d+) (\d+)\)">/);
  assert.ok(m, 'badge group');
  const [cx, cy, r] = [Number(m[1]), Number(m[2]), BADGE_CENTER.r];
  assert.deepEqual([cx, cy], [BADGE_CENTER.cx, BADGE_CENTER.cy]);
  for (const e of EYES) {
    const dist = Math.hypot(cx - e.cx, cy - e.cy);
    assert.ok(dist > e.ring.rx + r + 10, `badge overlaps an eye (dist ${dist})`);
  }
  assert.ok(Math.hypot(cx - ORB.cx, cy - ORB.cy) > ORB.r + r + 10, 'badge overlaps the antenna orb');
  assert.ok(cx - r > BOUNDS.x1 + 1, 'badge sits right of the figure');
  assert.ok(cx + r <= 200 && cy - r >= 0);
  assert.ok(r <= 14, 'badge is small');
  assert.ok(withBadge.includes('fill="#F6C453" stroke="#fff"'), 'gold star, white die-cut');
  assert.ok(renderSoulSvg(sample, { detail: 'simple', badge: 'bingo-star' }).includes(BADGE_LABEL));
  assert.ok(!renderSoulSvg(sample, { detail: 'dot', badge: 'bingo-star' }).includes(BADGE_LABEL), 'dot has no badge');
});

test('simple and dot detail levels work and are lighter than full (simple keeps the sticker look without filters)', () => {
  const full = renderSoulSvg(sample), simple = renderSoulSvg(sample, { detail: 'simple' }), dot = renderSoulSvg(sample, { detail: 'dot' });
  assert.ok(simple.length < full.length && dot.length < simple.length);
  assert.ok(dot.length < 1024);
  assert.ok(!simple.includes('<filter') && !simple.includes('<animate'));
  assert.ok(simple.includes('clip-path=') && simple.includes('stroke="#fff" stroke-width="5"'), 'simple: clipped drips + 3 px die-cut');
  assert.ok(dot.includes('<circle') && dot.includes('radialGradient'));
  assert.ok(simple.includes('data-detail="simple"') && dot.includes('data-detail="dot"'));
});

test('reducedMotion removes all animation; motion adds a deterministic phase', () => {
  const still = renderSoulSvg(sample, { reducedMotion: true });
  assert.ok(!still.includes('<animate'));
  const moving = renderSoulSvg(sample, { reducedMotion: false });
  assert.ok(moving.includes('<animate') && moving.includes('begin="-2s"'));
});

test('gradient/filter ids are namespaced by idPrefix so many Souls can be inlined', () => {
  const a = renderSoulSvg(sample, { idPrefix: 'a1' }), b = renderSoulSvg(sample, { idPrefix: 'b2' });
  const ids = (s) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids(a).every((id) => id.startsWith('a1-')));
  assert.ok(ids(b).every((id) => id.startsWith('b2-')));
  assert.ok(ids(a).every((id) => !ids(b).includes(id)));
  assert.ok(ids(renderSoulSvg(sample)).every((id) => id.startsWith('soul-abc123-')));
});

test('D-27: palette and glow variants are visually distinct; body/eyes/antenna/mouth stay in the config but are not drawn', () => {
  for (const kind of Object.keys(TRAITS)) {
    const outs = TRAITS[kind].map((_, i) => renderSoulSvg({ ...sample, [kind]: i }, { reducedMotion: true, idPrefix: 'x' }));
    const drawn = kind === 'palette' || kind === 'glow';
    for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) {
      if (drawn) assert.notEqual(outs[i], outs[j], `${kind} ${i} vs ${j}`);
      else assert.equal(outs[i], outs[j], `${kind} ${i} vs ${j}: not drawn on the baseline`);
    }
  }
});

test('palettes are equal-value: body fills share one luminance band and all Souls use the same silhouette scale', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const fills = PALETTES.map((p) => lum(p.fill));
  assert.ok(Math.min(...fills) >= 0.44 && Math.max(...fills) <= 0.62, `fill band ${fills.map((v) => v.toFixed(2))}`);
  const outlines = PALETTES.map((p) => lum(p.outline));
  assert.ok(Math.max(...outlines) - Math.min(...outlines) <= 0.1, 'outline band');
  for (const p of PALETTES) assert.ok(lum(p.highlight) > 0.8, `${p.name} highlight is light`);
  // same figure, glow radius and body stroke for every combination
  for (let p = 0; p < 8; p++) for (let g = 0; g < 3; g++) {
    const svg = renderSoulSvg({ ...sample, palette: p, glow: g }, { reducedMotion: true });
    assert.ok(svg.includes(`d="${SILHOUETTE}"`), 'same silhouette scale (one character)');
    assert.ok(svg.includes('<circle cx="100" cy="108" r="86"'), 'same glow radius');
    assert.ok(svg.includes('stroke-width="2.2"'), 'same outline weight');
    assert.ok(svg.includes('stroke-width="10" stroke-linejoin="round" filter='), 'same die-cut weight');
  }
});

test('constellation data stays in the config but never changes the drawing (D-27: only palette, glow and badge vary)', () => {
  const one = renderSoulSvg({ ...sample, constellation: [{ domain: 'Cloud', weight: 1 }] }, { reducedMotion: true });
  const five = renderSoulSvg({ ...sample, constellation: CONST }, { reducedMotion: true });
  const none = renderSoulSvg({ ...sample, constellation: [] }, { reducedMotion: true });
  assert.equal(five, none);
  assert.equal(one, none);
  assert.doesNotThrow(() => renderSoulSvg({ ...sample, constellation: Array.from({ length: 12 }, (_, i) => ({ domain: `D${i}`, weight: 0.1 })) }));
});

test('soulOrbitSlot is deterministic and within ring capacity', () => {
  for (let count of [1, 5, 20, 100, 300, 450, 588, 900]) {
    for (let i = 0; i < 200; i++) {
      const id = `soul-${i}-${count}`;
      const a = soulOrbitSlot(id, count), b = soulOrbitSlot(id, count);
      assert.deepEqual(a, b);
      assert.ok(a.ring >= 0 && a.ring < ORBIT_RINGS.length);
      assert.ok(Number.isInteger(a.slot) && a.slot >= 0 && a.slot < ORBIT_RINGS[a.ring].capacity);
      assert.equal(a.capacity, ORBIT_RINGS[a.ring].capacity);
      assert.ok(a.angle >= 0 && a.angle <= Math.PI * 2);
      // only rings opened by count are used
      let cum = 0, active = 0;
      while (active < ORBIT_RINGS.length && cum < count) { cum += ORBIT_RINGS[active].capacity; active++; }
      assert.ok(a.ring < active);
    }
  }
  assert.equal(ORBIT_CAPACITY, 588);
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('a'), hash32('b'));
});

// ---------- generated assets ----------
const manifestPath = join(ROOT, 'assets', 'manifest', 'assets.yaml');

test('manifest exists, has every workflow 5.2 field, and checksums/sizes match the files on disk', () => {
  assert.ok(existsSync(manifestPath), 'run node tools/assets/build-souls.js && node tools/assets/build-scene.js');
  const { entries } = parseManifest(readFileSync(manifestPath, 'utf8'));
  assert.ok(entries.length >= 30);
  const ids = new Set();
  for (const e of entries) {
    for (const f of MANIFEST_FIELDS) assert.ok(f in e, `${e.id} missing ${f}`);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`); ids.add(e.id);
    assert.equal(e.license, 'internal-original');
    assert.equal(e.approved_by, null);
    if (e.kind === 'model') assert.ok(e.triangle_count > 0, `${e.id} triangles`); else assert.equal(e.triangle_count, 0);
    assert.ok(existsSync(join(ROOT, e.source_file)), `${e.id} source ${e.source_file}`);
    assert.ok(existsSync(join(ROOT, e.generator_script)), `${e.id} generator`);
    const file = join(ROOT, e.runtime_file);
    assert.ok(existsSync(file), `${e.id} runtime file ${e.runtime_file}`);
    assert.equal(e.checksum, sha256(readFileSync(file)), `${e.id} checksum`);
    assert.equal(e.texture_memory_bytes, statSync(file).size, `${e.id} size`);
    if (e.fallback_file) assert.ok(existsSync(join(ROOT, e.fallback_file)), `${e.id} fallback`);
    for (const l of e.lods) assert.ok(existsSync(join(ROOT, l)), `${e.id} lod ${l}`);
    assert.equal(e.bounds.length, 3); assert.equal(e.pivot.length, 3);
  }
});

test('cohort: 24 neutral seeds, valid configs, files equal a fresh render (determinism), alt text clean', () => {
  const cohort = JSON.parse(readFileSync(join(ROOT, 'assets', 'souls', 'cohort.json'), 'utf8'));
  assert.equal(cohort.members.length, 24);
  const forbidden = ['platformId', 'roleId', 'platform', 'role', 'size', 'rank', 'brightness', 'isWinner'];
  for (const m of cohort.members) {
    assert.equal(validateSoulConfig(m.config).ok, true);
    for (const k of forbidden) assert.ok(!(k in m.config), `${k} leaked into config`);
    assert.ok(!/platform|role/i.test(m.alt));
    const full = readFileSync(join(ROOT, 'assets', 'souls', 'cohort', `${m.seed}.svg`), 'utf8');
    assert.equal(full, renderSoulSvg(m.config, { size: 160, badge: m.badge, detail: 'full', idPrefix: `s${m.seed}` }) + '\n');
    assert.ok(Buffer.byteLength(full) <= MAX_FULL_BYTES + 1);
    for (const f of [`fallback/${m.seed}-simple.svg`, `fallback/${m.seed}-dot.svg`, `thumbnails/${m.seed}-64.svg`]) assert.ok(existsSync(join(ROOT, 'assets', 'souls', f)), f);
    assert.deepEqual(soulConfigFromSeed(m.seed, {}).body, m.config.body, 'seed -> body is stable');
  }
  // diversity: cohort should exercise several bodies and palettes
  assert.ok(new Set(cohort.members.map((m) => m.config.body)).size >= 4);
  assert.ok(new Set(cohort.members.map((m) => m.config.palette)).size >= 5);
  assert.equal(cohort.members.filter((m) => m.badge === 'bingo-star').length, 3);
  const sheet = readFileSync(join(ROOT, 'assets', 'souls', 'sheet.html'), 'utf8');
  assert.ok(sheet.includes('<svg') && sheet.includes('neutral test cohort'));
});

test('scene assets: star layers normalised, orbit rings mirror the renderer, safe zone is the right 35 %', () => {
  for (let i = 1; i <= 3; i++) {
    const L = JSON.parse(readFileSync(join(ROOT, 'assets', 'scene', `starfield-layer-${i}.json`), 'utf8'));
    assert.equal(L.layer, i); assert.ok(L.stars.length > 50);
    for (const s of L.stars) { assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1 && s.r > 0 && s.b > 0 && s.b <= 1); }
  }
  const rings = JSON.parse(readFileSync(join(ROOT, 'assets', 'scene', 'orbit-rings.json'), 'utf8'));
  assert.deepEqual(rings.rings.map((r) => [r.ring, r.radius, r.capacity]), ORBIT_RINGS.map((r) => [r.ring, r.radius, r.capacity]));
  assert.equal(rings.totalCapacity, ORBIT_CAPACITY);
  const cfg = JSON.parse(readFileSync(join(ROOT, 'assets', 'scene', 'scene-config.json'), 'utf8'));
  assert.equal(cfg.safeZone.galaxyWidthPx, 1248); assert.equal(cfg.safeZone.panelX, 1248); assert.equal(cfg.safeZone.panelWidthPx, 672);
  assert.ok(cfg.performance.high && cfg.performance.medium && cfg.performance.low);
  assert.ok(cfg.performance.medium.maxSouls >= 450, 'medium level must hold the 450-Soul soak');
  assert.equal(cfg.camera.shake, 'forbidden');
  const nebula = readFileSync(join(ROOT, 'assets', 'scene', 'nebula.svg'), 'utf8');
  assert.ok(nebula.includes('viewBox="0 0 1248 1080"') && nebula.includes('clip-path'));
});

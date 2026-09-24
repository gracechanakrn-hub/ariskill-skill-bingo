// Stage ambient backdrop (stage 9.3, decision D-22): a full-screen Three.js scene BEHIND the tiles - violet nebula
// plane, two twinkling star layers, a sparse drift of gold/violet fireflies and dark foliage silhouettes in the
// bottom corners. Purely decorative (aria-hidden canvas): the tiles keep their opaque surfaces, so legibility never
// depends on this layer. Three.js is imported lazily from the vendored copy (no CDN, CSP `default-src 'self'`).
// Budget: rendered at 0.5 device pixels, capped at 30 fps, paused while the tab is hidden; a single static frame
// under reduced motion; no canvas at all (the CSS gradient on <body> stays) when WebGL is unavailable or anything
// throws. Every layout is derived from a seeded PRNG so the sky is identical on every load and in every capture.
// Art direction v2 (sticker sheet sky): an aurora band - a teal -> lime ribbon across the upper sky - drawn additively
// over the nebula, drifting at 0.01 rad/s, with its added light capped at AURORA_LUMINANCE_CAP (Rec. 709 Y) so the sky
// never brightens past a dark band; the tiles keep opaque surfaces so tile luminance is independent of it anyway. When
// WebGL is off the CSS gradient on <body> (app.css) already carries a static aurora ribbon.
// Pure helpers (createRng, starField, fireflyField, foliageBlobs, auroraField, auroraSample, frameDue) have no DOM
// access and are unit tested.

export const THREE_MODULE_URL = '/packages/vendor/three/index.js';
export const BACKDROP_FPS = 30;
export const BACKDROP_PIXEL_RATIO = 0.5;
export const BACKDROP_SEED = 20260922;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32): same seed -> same sky. Returns a function producing floats in [0, 1). */
export function createRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when the next frame should render: keeps the loop at `fps` (with a 2 ms tolerance for rAF jitter). */
export function frameDue(lastMs, nowMs, fps = BACKDROP_FPS) {
  if (lastMs === null || lastMs === undefined) return true;
  return nowMs - lastMs >= 1000 / fps - 2;
}

/**
 * A star layer: positions in clip space (x, y in [-1, 1]), per-star size (px at 1x), phase and tint.
 * `tint` mixes cool white with a little violet/gold so the sky is not uniformly white.
 */
export function starField(count, seed, { sizeMin = 1.2, sizeMax = 2.4 } = {}) {
  const rng = createRng(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = rng() * 2 - 1;
    positions[i * 3 + 1] = rng() * 2 - 1;
    positions[i * 3 + 2] = 0;
    sizes[i] = sizeMin + rng() * (sizeMax - sizeMin);
    phases[i] = rng();
    const kind = rng();
    if (kind < 0.72) { colors[i * 3] = 0.92; colors[i * 3 + 1] = 0.94; colors[i * 3 + 2] = 1.0; }        // cool white
    else if (kind < 0.9) { colors[i * 3] = 0.80; colors[i * 3 + 1] = 0.73; colors[i * 3 + 2] = 1.0; }    // violet
    else { colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.90; colors[i * 3 + 2] = 0.66; }                    // warm gold
  }
  return { positions, sizes, phases, colors };
}

/**
 * Fireflies: sparse, warm gold (2/3) and violet (1/3). Kept above the footer band (y > -0.82) so the presenter
 * controls never sit on a glow, and biased to the left/right thirds where the tile gutters are widest.
 */
export function fireflyField(count, seed) {
  const rng = createRng(seed);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = rng() * 2 - 1;
    positions[i * 3 + 1] = -0.82 + rng() * 1.8;
    positions[i * 3 + 2] = 0;
    seeds[i] = rng();
    sizes[i] = 9 + rng() * 10;
    if (rng() < 0.66) { colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.80; colors[i * 3 + 2] = 0.34; } // gold (--color-core family)
    else { colors[i * 3] = 0.80; colors[i * 3 + 1] = 0.66; colors[i * 3 + 2] = 1.0; }              // violet (--color-accent family)
  }
  return { positions, seeds, sizes, colors };
}

/**
 * Foliage silhouette blobs for one bottom corner, in texture UV space (0..1, origin bottom-left = the corner).
 * Density falls off with distance from the corner so the silhouette reads as a soft bush/fern edge, not a wall.
 */
export function foliageBlobs(seed, count = 110) {
  const rng = createRng(seed);
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 0.5;                 // quarter circle from the corner
    const dist = Math.pow(rng(), 0.55) * 0.92;           // more mass near the corner
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist * 0.85;
    const r = 0.045 + rng() * 0.11 * (1 - dist * 0.55);  // smaller towards the outer edge
    blobs.push({ x, y, rx: r, ry: r * (0.55 + rng() * 0.7), rot: rng() * Math.PI, alpha: 0.55 + rng() * 0.45 * (1 - dist) });
  }
  // a few tapered fronds reaching outwards
  const fronds = [];
  for (let i = 0; i < 9; i++) {
    const angle = 0.08 + rng() * (Math.PI * 0.5 - 0.16);
    fronds.push({ angle, length: 0.45 + rng() * 0.5, width: 0.012 + rng() * 0.02, bend: (rng() - 0.5) * 0.5 });
  }
  return { blobs, fronds };
}

// ---------------------------------------------------------------------------------------------------------------
// Aurora band (art direction v2): teal -> lime ribbons across the upper sky, slow drift, capped additive light
// ---------------------------------------------------------------------------------------------------------------
export const AURORA_DRIFT_RAD_PER_S = 0.01;
/** Cap on the light the aurora may add (Rec. 709 luminance of the contribution, 0..1). */
export const AURORA_LUMINANCE_CAP = 0.22; // measured band peak <= ~0.13 linear in every frame -> body text #F2F4FF stays >= 4.5:1 even over the sky
export const AURORA_RIBBONS = 3;
/**
 * Aurora light colours. The band is blended additively over the violet nebula (about #25124B), so the light is the
 * sticker token colour minus that base: adding k * (token - base) lands exactly on lerp(base, token, k) - the hue
 * stays teal / lime instead of drifting to blue-grey, and the cap bounds the added light as before.
 */
export const AURORA_TEAL = Object.freeze([0.165, 0.820, 0.470]); // --sticker-aurora-teal #4FE3C1 minus the sky base
export const AURORA_LIME = Object.freeze([0.570, 0.930, 0.070]); // --sticker-aurora-lime #B6FF5C minus the sky base

/**
 * Seeded aurora layout: `count` ribbons in the upper sky (centre v in [0.70, 0.86] - behind the status strip and the
 * two tile gaps at 1080p), each with its own wave, width, drift multiplier and gain. Same seed -> same aurora.
 */
export function auroraField(seed, count = AURORA_RIBBONS) {
  const rng = createRng(seed);
  const ribbons = [];
  for (let i = 0; i < count; i++) {
    ribbons.push({
      y: 0.70 + rng() * 0.16,        // ribbon centre (v, 0 = bottom, 1 = top)
      amp: 0.025 + rng() * 0.045,    // vertical wave amplitude
      freq: 2.2 + rng() * 2.4,       // wave radians across the width
      phase: rng() * Math.PI * 2,
      width: 0.05 + rng() * 0.06,    // gaussian half-width in v
      speed: 0.6 + rng() * 0.8,      // multiplier on the shared drift (0.6-1.4 x 0.01 rad/s)
      gain: 0.8 + rng() * 0.4,       // ribbon cores reach the cap and are clamped flat (soft, not a hot line)
    });
  }
  return { ribbons, teal: AURORA_TEAL, lime: AURORA_LIME, drift: AURORA_DRIFT_RAD_PER_S, cap: AURORA_LUMINANCE_CAP };
}

/** Rec. 709 relative luminance of a linear RGB triple. */
export function auroraLuminance([r, g, b]) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * Reference implementation of the aurora fragment shader (kept in sync by hand; the tests exercise this one):
 * the light added at (u, v) in [0, 1]^2 at time t (seconds), each channel in [0, 1] and luminance <= field.cap.
 * Zero below v = 0.5 (the sky under the tiles and the footer band stays untouched).
 */
export function auroraSample(field, u, v, t = 0) {
  const sky = smoothstep(0.50, 0.66, v) * smoothstep(1.0, 0.94, v);
  let r = 0, g = 0, b = 0;
  if (sky > 0) {
    for (const rb of field.ribbons) {
      const phase = rb.phase + t * field.drift * rb.speed;
      const yc = rb.y + rb.amp * Math.sin(u * rb.freq + phase);
      const d = (v - yc) / rb.width;
      const curtain = 0.72 + 0.28 * Math.sin(u * 11.0 + phase * 3.0 + rb.freq);
      const g0 = Math.exp(-d * d) * rb.gain * curtain * sky;
      const m = smoothstep(0.1, 0.9, u + 0.12 * Math.sin(u * 4.0 + phase));
      r += (field.teal[0] + (field.lime[0] - field.teal[0]) * m) * g0;
      g += (field.teal[1] + (field.lime[1] - field.teal[1]) * m) * g0;
      b += (field.teal[2] + (field.lime[2] - field.teal[2]) * m) * g0;
    }
  }
  const y = auroraLuminance([r, g, b]);
  if (y > field.cap) { const k = field.cap / y; r *= k; g *= k; b *= k; }
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
}

/** GLSL twin of auroraSample for `count` ribbons (uniform arrays uRibbonA = y, amp, freq, phase; uRibbonB = width, speed, gain). */
export function auroraFragmentShader(count = AURORA_RIBBONS) {
  return /* glsl */`
precision mediump float;
#define RIBBONS ${Math.max(1, count | 0)}
uniform float uTime; uniform float uDrift; uniform float uCap; uniform float uOpacity;
uniform vec3 uTeal; uniform vec3 uLime;
uniform vec4 uRibbonA[RIBBONS];
uniform vec3 uRibbonB[RIBBONS];
varying vec2 vUv;
void main() {
  float u = vUv.x, v = vUv.y;
  float sky = smoothstep(0.50, 0.66, v) * smoothstep(1.0, 0.94, v);
  vec3 col = vec3(0.0);
  for (int i = 0; i < RIBBONS; i++) {
    vec4 a = uRibbonA[i]; vec3 b = uRibbonB[i];
    float phase = a.w + uTime * uDrift * b.y;
    float yc = a.x + a.y * sin(u * a.z + phase);
    float d = (v - yc) / b.x;
    float curtain = 0.72 + 0.28 * sin(u * 11.0 + phase * 3.0 + a.z);
    float g0 = exp(-d * d) * b.z * curtain * sky;
    float m = smoothstep(0.1, 0.9, u + 0.12 * sin(u * 4.0 + phase));
    col += mix(uTeal, uLime, m) * g0;
  }
  float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (y > uCap) col *= uCap / y;
  gl_FragColor = vec4(col * uOpacity, 1.0); /* additive: the colour is the light added, capped above */
}`;
}

/** WebGL probe with no side effects on the page; returns false when a context cannot be created. */
export function webglAvailable(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.createElement !== 'function') return false;
  try {
    const c = doc.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------------------
// Shaders (no lighting, no post-processing; positions are already clip space so no camera matrices are needed)
// ---------------------------------------------------------------------------------------------------------------
const NEBULA_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const NEBULA_FRAG = /* glsl */`
precision mediump float;
uniform float uTime; uniform float uAspect;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float t = uTime * 0.012;
  vec3 base = mix(vec3(0.040, 0.022, 0.120), vec3(0.085, 0.048, 0.210), uv.y * 0.55 + 0.25);
  float n1 = fbm(p * 1.5 + vec2(t, -t * 0.6));
  float n2 = fbm(p * 2.9 - vec2(t * 0.7, t * 0.4) + 5.0);
  float b1 = smoothstep(1.05, 0.0, distance(p, vec2(0.36 * uAspect + sin(t * 3.0) * 0.02, 0.74)));
  float b2 = smoothstep(1.15, 0.0, distance(p, vec2(0.80 * uAspect, 0.22 + cos(t * 2.4) * 0.015)));
  float b3 = smoothstep(0.70, 0.0, distance(p, vec2(0.58 * uAspect, 0.55)));
  vec3 magenta = vec3(0.46, 0.15, 0.58);
  vec3 blue = vec3(0.16, 0.22, 0.60);
  vec3 violet = vec3(0.34, 0.20, 0.70);
  vec3 col = base;
  col += magenta * b1 * (0.30 + 0.55 * n1) * 0.62;
  col += blue * b2 * (0.28 + 0.60 * n2) * 0.55;
  col += violet * b3 * (0.20 + 0.50 * n1) * 0.35;
  col += violet * pow(n1 * n2, 1.6) * 1.1;
  float v = smoothstep(1.25, 0.30, distance(uv, vec2(0.5)));
  col *= mix(0.78, 1.0, v);
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = /* glsl */`
attribute float aSize; attribute float aPhase; attribute vec3 aColor;
uniform float uTime; uniform float uPixelRatio; uniform float uMotion; uniform float uSpeed;
varying float vAlpha; varying vec3 vColor;
void main() {
  float tw = 0.62 + 0.38 * sin(uTime * uSpeed * (0.6 + aPhase * 0.5) + aPhase * 6.2831);
  tw = mix(0.82, tw, uMotion);
  vAlpha = tw; vColor = aColor;
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = max(1.0, aSize * uPixelRatio * (0.85 + 0.15 * tw));
}`;

const STAR_FRAG = /* glsl */`
precision mediump float;
uniform float uOpacity;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r); a = a * a;
  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
}`;

const FIREFLY_VERT = /* glsl */`
attribute float aSeed; attribute float aSize; attribute vec3 aColor;
uniform float uTime; uniform float uPixelRatio; uniform float uMotion; uniform float uAspect;
varying float vAlpha; varying vec3 vColor;
void main() {
  float s = aSeed * 6.2831;
  vec2 drift = vec2(
    (sin(uTime * 0.10 + s) * 0.022 + sin(uTime * 0.031 + s * 2.1) * 0.018) / uAspect,
    cos(uTime * 0.08 + s * 1.3) * 0.020 + sin(uTime * 0.021 + s * 0.7) * 0.012);
  vec2 p = position.xy + drift * uMotion;
  float pulse = 0.55 + 0.45 * sin(uTime * (0.9 + aSeed * 0.6) + s);
  vAlpha = mix(0.70, pulse, uMotion);
  vColor = aColor;
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = max(2.0, aSize * uPixelRatio * (0.9 + 0.1 * pulse));
}`;

const FIREFLY_FRAG = /* glsl */`
precision mediump float;
uniform float uOpacity;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = min(1.0, length(d) * 2.0);
  float glow = pow(1.0 - r, 2.2);
  float core = pow(1.0 - r, 9.0);
  vec3 col = mix(vColor, vec3(1.0, 0.98, 0.92), core * 0.7);
  gl_FragColor = vec4(col, (glow * 0.55 + core * 0.45) * vAlpha * uOpacity);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Procedural foliage texture (Canvas 2D, deterministic) used as an alpha mask on a tinted plane
// ---------------------------------------------------------------------------------------------------------------
function paintFoliage(canvas, seed) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  const { blobs, fronds } = foliageBlobs(seed);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  // fronds first (behind the leaf mass)
  for (const f of fronds) {
    const x0 = 0, y0 = size;
    const x1 = Math.cos(f.angle) * f.length * size, y1 = size - Math.sin(f.angle) * f.length * size;
    const cx = (x0 + x1) / 2 + Math.sin(f.angle) * f.bend * size, cy = (y0 + y1) / 2 + Math.cos(f.angle) * f.bend * size;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = f.width * size;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
    for (let k = 1; k <= 6; k++) {
      const tt = k / 7;
      const px = (1 - tt) * (1 - tt) * x0 + 2 * (1 - tt) * tt * cx + tt * tt * x1;
      const py = (1 - tt) * (1 - tt) * y0 + 2 * (1 - tt) * tt * cy + tt * tt * y1;
      const leaf = f.width * size * (2.6 - tt * 1.4);
      ctx.beginPath(); ctx.ellipse(px, py, leaf * 1.6, leaf * 0.7, f.angle + (k % 2 ? 0.9 : -0.9), 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const b of blobs) {
    ctx.globalAlpha = b.alpha;
    ctx.beginPath();
    ctx.ellipse(b.x * size, size - b.y * size, b.rx * size, b.ry * size, b.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------------------------------------------
/**
 * Mounts the backdrop canvas as the first child of `host` (the <body>), behind the app root.
 * Returns a controller { mode: 'webgl' | 'css', setReducedMotion(bool), dispose() } - never throws.
 * `loadThree` is injectable for tests; the default lazily imports the vendored module.
 */
export async function mountBackdrop(host, { reducedMotion = false, loadThree = () => import(THREE_MODULE_URL), win = typeof window !== 'undefined' ? window : null } = {}) {
  const noop = { mode: 'css', setReducedMotion() {}, dispose() {} };
  if (!host || !win || !webglAvailable(host.ownerDocument)) return noop;
  const doc = host.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.className = 'stage-backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  let THREE;
  let renderer;
  try {
    THREE = await loadThree();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power', stencil: false, depth: false });
  } catch {
    canvas.remove();
    return noop;
  }
  try {
    renderer.setPixelRatio(BACKDROP_PIXEL_RATIO);
    renderer.setClearColor(0x0b0621, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    const motion = { value: reducedMotion ? 0 : 1 };
    const aspect = { value: 16 / 9 };
    const time = { value: 0 };
    const pixelRatio = { value: BACKDROP_PIXEL_RATIO * 2 }; // point sizes are authored at 1x; the canvas is 0.5x so halve

    // Nebula plane
    const nebula = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uTime: time, uAspect: aspect }, vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG, depthTest: false, depthWrite: false,
    }));
    nebula.frustumCulled = false; nebula.renderOrder = 0; scene.add(nebula);

    // Aurora band: additive plane between the nebula and the stars (renderOrder 0.5), same time uniform so reduced
    // motion (time frozen at 0) yields one static frame. Layout from the seeded field, light capped in the shader.
    const field = auroraField(BACKDROP_SEED + 6);
    const aurora = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: {
        uTime: time, uDrift: { value: field.drift }, uCap: { value: field.cap }, uOpacity: { value: 1.0 },
        uTeal: { value: new THREE.Vector3(...field.teal) }, uLime: { value: new THREE.Vector3(...field.lime) },
        uRibbonA: { value: field.ribbons.map((r) => new THREE.Vector4(r.y, r.amp, r.freq, r.phase)) },
        uRibbonB: { value: field.ribbons.map((r) => new THREE.Vector3(r.width, r.speed, r.gain)) },
      },
      vertexShader: NEBULA_VERT, fragmentShader: auroraFragmentShader(field.ribbons.length),
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    aurora.frustumCulled = false; aurora.renderOrder = 0.5; scene.add(aurora);

    // Stars: far (many, small, faint) and near (fewer, larger)
    const makeStars = (field, speed, opacity, order) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(field.sizes, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(field.phases, 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(field.colors, 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: time, uPixelRatio: pixelRatio, uMotion: motion, uSpeed: { value: speed }, uOpacity: { value: opacity } },
        vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = order; scene.add(pts);
      return pts;
    };
    makeStars(starField(520, BACKDROP_SEED + 1, { sizeMin: 1.6, sizeMax: 2.8 }), 0.7, 0.65, 1);
    makeStars(starField(150, BACKDROP_SEED + 2, { sizeMin: 2.8, sizeMax: 4.8 }), 1.0, 0.9, 2);

    // Fireflies
    const ff = fireflyField(38, BACKDROP_SEED + 3);
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(ff.positions, 3));
    ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ff.seeds, 1));
    ffGeo.setAttribute('aSize', new THREE.BufferAttribute(ff.sizes, 1));
    ffGeo.setAttribute('aColor', new THREE.BufferAttribute(ff.colors, 3));
    const fireflies = new THREE.Points(ffGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: time, uPixelRatio: pixelRatio, uMotion: motion, uAspect: aspect, uOpacity: { value: 1.0 } },
      vertexShader: FIREFLY_VERT, fragmentShader: FIREFLY_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    fireflies.frustumCulled = false; fireflies.renderOrder = 4; scene.add(fireflies);

    // Foliage silhouettes (bottom-left drawn, bottom-right mirrored with a different seed)
    const foliage = [];
    for (const [i, seed] of [[0, BACKDROP_SEED + 4], [1, BACKDROP_SEED + 5]]) {
      const tex = doc.createElement('canvas'); tex.width = 512; tex.height = 512;
      paintFoliage(tex, seed);
      const texture = new THREE.CanvasTexture(tex);
      texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, color: 0x07031a, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false }));
      mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.userData.side = i; scene.add(mesh); foliage.push(mesh);
    }
    // Reduced-motion frames still bob nothing; foliage never moves.
    const layoutFoliage = (w, h) => {
      const hPx = h * 0.40, wPx = hPx * 1.45;
      const nw = (wPx * 2) / w, nh = (hPx * 2) / h;
      for (const m of foliage) {
        const left = m.userData.side === 0;
        m.scale.set(left ? nw : -nw, nh, 1);
        m.position.set(left ? -1 + nw / 2 : 1 - nw / 2, -1 + nh / 2, 0);
      }
    };

    // Size / resize
    const resize = () => {
      const w = Math.max(1, win.innerWidth), h = Math.max(1, win.innerHeight);
      renderer.setSize(w, h, false);
      aspect.value = w / h;
      layoutFoliage(w, h);
    };
    resize();

    // Frame loop: 30 fps cap, paused when hidden, single frame under reduced motion
    let raf = 0;
    let last = null;
    let t0 = null;
    let disposed = false;
    const render = () => renderer.render(scene, camera);
    const frame = (ts) => {
      raf = 0;
      if (disposed) return;
      if (motion.value === 0) return;               // reduced motion: the frame already drawn stays
      raf = win.requestAnimationFrame(frame);
      if (!frameDue(last, ts)) return;
      last = ts;
      if (t0 === null) t0 = ts;
      time.value = (ts - t0) / 1000;
      render();
    };
    const start = () => { if (!raf && !disposed && !doc.hidden) raf = win.requestAnimationFrame(frame); };
    const stop = () => { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } };
    const onVisibility = () => { if (doc.hidden) stop(); else start(); };
    const mq = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMedia = (e) => { const attr = doc.documentElement.getAttribute('data-reduced-motion'); if (attr !== 'true' && attr !== 'false') controller.setReducedMotion(e.matches); };

    host.insertBefore(canvas, host.firstChild);
    render();                                         // first frame immediately (static frame for reduced motion)
    win.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVisibility);
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', onMedia);
    if (!reducedMotion) start();

    const controller = {
      mode: 'webgl',
      setReducedMotion(enabled) {
        motion.value = enabled ? 0 : 1;
        if (enabled) { stop(); time.value = 0; render(); }
        else { last = null; start(); }
      },
      dispose() {
        disposed = true; stop();
        win.removeEventListener('resize', resize);
        doc.removeEventListener('visibilitychange', onVisibility);
        if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMedia);
        scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        renderer.dispose();
        canvas.remove();
      },
    };
    return controller;
  } catch {
    try { renderer.dispose(); } catch { /* ignore */ }
    canvas.remove();
    return noop;
  }
}

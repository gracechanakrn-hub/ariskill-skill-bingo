// Three.js renderer (primary tier, D-22 / stage 9.1). Vendored library imported by absolute path only
// (`/packages/vendor/three/*`): no CDN, no import map, no build step. galaxy.js loads this module lazily so an
// import failure falls through to the raw WebGL2 / Canvas 2D / static renderers.
//
// Composition (back to front, all in the Galaxy region only - the canvas never extends past panelX):
//   nebula shader plane (domain-warped noise, violet / blue / magenta, low contrast)
//   three star layers as Points (per-star twinkle phase, parallax to the camera drift, additive)
//   faint orbit rings (dashed LineLoops, additive)
//   fireflies (Points, per-particle phase, warm gold + violet, additive; warm tint on winner)
//   aurora band (aurora.js: teal -> lime ribbon over the upper third, additive, capped, 0.01 rad/s drift)
//   Soul halos (additive palette light BEHIND each sticker, bloomed)
//   clusters above 300 Souls (neutral glow sprite; the count label lives in a DOM overlay)
//   entrance trail / burst particles (short-lived additive points)
//   forest silhouettes (procedural alpha textures from forest.js, slight parallax)
// then EffectComposer: RenderPass(sky) -> UnrealBloomPass (off on `low`) -> RenderPass(overlay, no clear) -> OutputPass.
// The overlay scene is drawn AFTER bloom so the stickers stay flat, crisp print on the glowing sky (art direction v2):
//   Souls (instanced atlas quads at detail 'simple', die-cut hull + winner outline flash in the fragment shader)
//   Float entrances of decorated Souls (the live 3D figure from the impostor stage, same sticker shader)
//   doodads (rocket / UFO / planet / comet / stars from packages/ui/doodads.js, high tier only, doodads-layout.js)
// Decorated (v2 / v3) Souls (D-29, D-31): the impostor stage (impostor.js) renders the phone's 3D Soul - shared soul3d
// rig on the body of the Soul's variant (the v3 body for a v3 Soul), lights, tone mapping - live for each Float
// entrance's hero moment, and bakes settled decorated Souls into their atlas cells after each frame (afterFrame), so the
// Galaxy shows the same decorated Soul as the phone; GLTFLoader and the models load only when the first decorated Soul
// appears. v1 Souls keep their 2D sprites; so does a Soul whose body variant could not load.
// BR-17: nothing here tints, scales or reorders a Soul by anything but config / badge / soulId.
import * as THREE from '/packages/vendor/three/index.js';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from '/packages/vendor/three/addons.js';
import { resolveSoul, PALETTES } from '../../../../packages/ui/soul-renderer.js';
import { doodadSvg } from '../../../../packages/ui/doodads.js';
import { qualitySettings, pixelRatioFor, bloomStrength, pulseValue, BLOOM_PULSE, outlineFlash, hullPx, HULL } from './three-quality.js';
import { FOREST_LAYERS, forestLayout, paintForest } from './forest.js';
import { seededRandom } from './forest.js';
import { activeRingCount } from './scene.js';
import { AURORA, AURORA_GLSL, auroraPhase, auroraTierGain } from './aurora.js';
import { DOODAD_SET, DOODAD_RULES, doodadLayout, doodadExclusions, doodadOffset, doodadRect, rectsIntersect } from './doodads-layout.js';
import { createImpostorStage } from './impostor.js';
import { IMPOSTOR } from './impostor-plan.js';

export const THREE_RENDERER_KIND = 'three';
const FOREST_REF = { width: 1248, height: 1080 };
const PARTICLE_MAX = 2400;
const NEBULA_OVERSCAN = 1.1;   // the nebula plane is 10 % larger than the region (parallax headroom)
const DOODAD_CELL = 128;      // doodad atlas cell (the 64 px viewBox drawn at 104 px, rotation baked in)
const ATLAS_UPLOAD_MS = 200;  // at most ~5 atlas page re-uploads per second while cells land

const NEBULA_VS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const NEBULA_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime; uniform float uAspect; uniform vec3 uBase; uniform vec3 uViolet; uniform vec3 uBlue; uniform vec3 uMagenta;
uniform float uAuroraPhase; uniform vec3 uTeal; uniform vec3 uLime; uniform float uAuroraCap; uniform float uRightFade; uniform float uCentre; uniform float uHalfWidth; uniform float uSkyLumCap; uniform float uOverscan;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
` + AURORA_GLSL + /* glsl */`
void main(){
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.010;
  vec2 q = vec2(fbm(p * 1.5 + vec2(t, -t * 0.7)), fbm(p * 1.5 + vec2(5.2 - t * 0.5, 1.3 + t)));
  vec2 r = vec2(fbm(p * 2.1 + 3.5 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p * 2.1 + 3.5 * q + vec2(8.3, 2.8) - t * 0.4));
  float n = fbm(p * 1.7 + 2.6 * r);
  float band = smoothstep(0.34, 0.78, n);
  vec3 col = uBase;
  col = mix(col, uViolet, band * 0.70);
  col = mix(col, uBlue, smoothstep(0.32, 0.72, q.y) * 0.42 * (1.0 - band));
  col = mix(col, uMagenta, smoothstep(0.50, 0.92, r.x) * 0.42);
  float vign = smoothstep(1.3, 0.3, distance(vUv, vec2(0.5, 0.5)) * 1.7);
  col = mix(uBase * 0.8, col, 0.5 + 0.5 * vign);
  // aurora band (aurora.js) added here so the SUM can be clamped: the sky never exceeds uSkyLumCap luminance
  vec2 ruv = (vUv - 0.5) * uOverscan + 0.5;                       // plane uv -> region uv
  col += auroraLight(ruv, uAspect, uAuroraPhase, uTeal, uLime, uAuroraCap, uRightFade, uCentre, uHalfWidth);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= min(1.0, uSkyLumCap / max(lum, 1e-4));
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VS = /* glsl */`
attribute float aR; attribute float aB; attribute float aT;
uniform vec2 uRes; uniform vec2 uOffset; uniform float uTime; uniform float uAmp; uniform float uPeriod; uniform float uScale; uniform float uPixelRatio; uniform float uRipple;
varying float vA;
void main(){
  vec2 px = position.xy * uRes + uOffset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(px.x, -px.y, 0.0, 1.0);
  float tw = 1.0 + uAmp * sin(6.2831853 * (uTime / uPeriod + aT));
  vA = min(1.0, aB * tw * uRipple * 1.35);
  gl_PointSize = max(2.0, aR * 3.4 * uScale) * uPixelRatio;
}`;
const STAR_FS = /* glsl */`
precision mediump float;
uniform vec3 uColor; varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.2, r); a *= a; gl_FragColor = vec4(uColor * a * vA, a * vA); }`;

const FIREFLY_VS = /* glsl */`
attribute float aPhase; attribute float aSpeed; attribute float aSize; attribute float aWarm;
uniform vec2 uRes; uniform vec2 uOffset; uniform float uTime; uniform float uScale; uniform float uPixelRatio; uniform float uWarm;
varying float vA; varying vec3 vCol;
void main(){
  float t = uTime * aSpeed + aPhase * 6.2831853;
  vec2 drift = vec2(sin(t) * 0.6 + sin(t * 0.37 + aPhase * 3.0) * 0.4, cos(t * 0.8) * 0.5 + sin(t * 0.23) * 0.5) * 34.0 * uScale;
  float rise = fract(position.y - uTime * 0.0045 * aSpeed + aPhase);
  vec2 px = vec2(position.x * uRes.x, rise * uRes.y) + drift + uOffset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(px.x, -px.y, 0.0, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * (0.9 + aSpeed * 0.4) + aPhase * 12.0);
  float edge = smoothstep(0.0, 0.06, rise) * smoothstep(1.0, 0.94, rise);
  vA = (0.32 + 0.68 * tw * tw) * edge * (1.0 + 0.45 * uWarm);
  vCol = mix(vec3(0.62, 0.42, 1.0), vec3(1.0, 0.60, 0.20), clamp(aWarm + uWarm * 0.75, 0.0, 1.0));
  gl_PointSize = aSize * uScale * uPixelRatio * (1.0 + 0.25 * uWarm);
}`;
const FIREFLY_FS = /* glsl */`
precision mediump float;
varying float vA; varying vec3 vCol;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.15, r); a *= a; gl_FragColor = vec4(vCol * a * vA, a * vA); }`;

const SPRITE_VS = /* glsl */`
attribute vec2 iCenter; attribute float iSize; attribute vec4 iUv; attribute vec4 iTint; attribute vec2 iFx;
varying vec2 vUv; varying vec4 vTint; varying vec2 vFx;
void main(){
  vec2 w = vec2(iCenter.x, -iCenter.y) + position.xy * iSize;
  vUv = mix(iUv.xy, iUv.zw, uv); vTint = iTint; vFx = iFx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 0.0, 1.0);
}`;
// Sticker print: the atlas cell already carries the v2 die-cut; a screen-space hull (max alpha over 8 taps at
// vFx.x texels, the 2D analogue of the 3D spec's 1.06 inverted hull) keeps that white band readable at any sprite
// size, low-alpha texels (the flat offset shadow) are dropped so the sky shows through, and vFx.y (0..1) is the
// winner outline flash: the hull widens and turns gold for 250 ms.
const STICKER_FS = /* glsl */`
precision mediump float;
uniform sampler2D uMap; uniform float uTexel; uniform vec3 uFlashColor;
varying vec2 vUv; varying vec4 vTint; varying vec2 vFx;
void main(){
  vec4 c = texture2D(uMap, vUv);
  float r = vFx.x * (1.0 + vFx.y) * uTexel;
  float m = c.a;
  if (r > 0.0) {
    float d = 0.7071 * r;
    m = max(m, texture2D(uMap, vUv + vec2( r, 0.0)).a); m = max(m, texture2D(uMap, vUv + vec2(-r, 0.0)).a);
    m = max(m, texture2D(uMap, vUv + vec2(0.0,  r)).a); m = max(m, texture2D(uMap, vUv + vec2(0.0, -r)).a);
    m = max(m, texture2D(uMap, vUv + vec2( d,  d)).a); m = max(m, texture2D(uMap, vUv + vec2(-d,  d)).a);
    m = max(m, texture2D(uMap, vUv + vec2( d, -d)).a); m = max(m, texture2D(uMap, vUv + vec2(-d, -d)).a);
  }
  float hull = smoothstep(0.45, 0.75, m);
  float a = smoothstep(0.30, 0.60, c.a);
  vec3 hullColor = mix(vec3(1.0), uFlashColor, vFx.y);
  vec3 rgb = mix(hullColor, c.rgb, a);
  float outA = max(a, hull);
  gl_FragColor = vec4(rgb * vTint.rgb, outA * vTint.a);
}`;
const SPRITE_FS_NORMAL = /* glsl */`
precision mediump float;
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vTint;
void main(){ vec4 c = texture2D(uMap, vUv); gl_FragColor = vec4(c.rgb * vTint.rgb, c.a * vTint.a); }`;
const SPRITE_FS_ADDITIVE = /* glsl */`
precision mediump float;
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vTint;
void main(){ vec4 c = texture2D(uMap, vUv); float a = c.a * vTint.a; gl_FragColor = vec4(vTint.rgb * a, a); }`;

function lin(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }

function discCanvas(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, size * 0.03, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(0.7, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}

function canvasTexture(canvas, { flipY = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = flipY; t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** One draw call for up to `capacity` textured quads (Souls per atlas page, halos, particles, clusters). */
function createSpriteBatch({ texture, additive, capacity, renderOrder, fragmentShader = null, uniforms = {} }) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.getIndex()); geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('uv', base.getAttribute('uv'));
  const center = new Float32Array(capacity * 2), size = new Float32Array(capacity), uvr = new Float32Array(capacity * 4), tint = new Float32Array(capacity * 4), fx = new Float32Array(capacity * 2);
  const attrs = {
    iCenter: new THREE.InstancedBufferAttribute(center, 2), iSize: new THREE.InstancedBufferAttribute(size, 1),
    iUv: new THREE.InstancedBufferAttribute(uvr, 4), iTint: new THREE.InstancedBufferAttribute(tint, 4), iFx: new THREE.InstancedBufferAttribute(fx, 2),
  };
  for (const [k, a] of Object.entries(attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, ...uniforms }, vertexShader: SPRITE_VS, fragmentShader: fragmentShader || (additive ? SPRITE_FS_ADDITIVE : SPRITE_FS_NORMAL),
    transparent: true, depthTest: false, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, premultipliedAlpha: !!additive,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = renderOrder; mesh.visible = false;
  geo.instanceCount = 0;
  let n = 0;
  return {
    mesh,
    begin() { n = 0; },
    push(x, y, s, u0, v0, u1, v1, r, g, b, a, hull = 0, flash = 0) {
      if (n >= capacity || a <= 0) return;
      center[n * 2] = x; center[n * 2 + 1] = y; size[n] = s;
      uvr[n * 4] = u0; uvr[n * 4 + 1] = v0; uvr[n * 4 + 2] = u1; uvr[n * 4 + 3] = v1;
      tint[n * 4] = r; tint[n * 4 + 1] = g; tint[n * 4 + 2] = b; tint[n * 4 + 3] = a;
      fx[n * 2] = hull; fx[n * 2 + 1] = flash;
      n++;
    },
    get material() { return mat; },
    end() {
      geo.instanceCount = n; mesh.visible = n > 0;
      if (n) for (const a of Object.values(attrs)) a.needsUpdate = true;
    },
    get count() { return n; },
    dispose() { geo.dispose(); mat.dispose(); base.dispose(); },
  };
}

/**
 * Rasterises the doodad set once into a strip atlas (one DOODAD_CELL cell per entry, rotation baked in).
 * `cells[i]` holds the uv rect for DOODAD_SET[i]; `ready` resolves when every SVG landed. No image assets.
 */
function buildDoodadAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = DOODAD_CELL * DOODAD_SET.length; canvas.height = DOODAD_CELL;
  const ctx = canvas.getContext('2d');
  const cells = DOODAD_SET.map((_, i) => ({ x: i * DOODAD_CELL, y: 0, w: DOODAD_CELL, h: DOODAD_CELL }));
  const inner = 104;
  const jobs = DOODAD_SET.map((spec, i) => new Promise((resolve) => {
    const svg = doodadSvg(spec.name, inner);
    if (!svg) { resolve(false); return; }
    const img = new Image();
    img.onload = () => {
      const c = cells[i];
      ctx.save(); ctx.translate(c.x + c.w / 2, c.y + c.h / 2); ctx.rotate((spec.rotDeg * Math.PI) / 180);
      ctx.drawImage(img, -inner / 2, -inner / 2, inner, inner); ctx.restore();
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }));
  return { canvas, cells, ready: Promise.all(jobs) };
}

export function createThreeRenderer({ container, atlas, starLayers = [], background = '#0B0F1F', dpr = 1, quality = 'high', seed = 'arise-galaxy-2026', pulseMs = 400, reducedMotion = false, onLost = null } = {}) {
  if (typeof document === 'undefined') throw new Error('three renderer needs a DOM');
  const canvas = document.createElement('canvas');
  canvas.className = 'galaxy__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', premultipliedAlpha: true, stencil: false, depth: false });
  } catch (err) { throw new Error('three: WebGL unavailable (' + (err && err.message) + ')'); }
  const gl = renderer.getContext();
  if (!gl) throw new Error('three: no WebGL context');
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(new THREE.Color(background), 1);
  renderer.autoClear = true;
  container.appendChild(canvas);
  const labels = document.createElement('div');
  labels.className = 'galaxy__labels'; labels.setAttribute('aria-hidden', 'true');
  container.appendChild(labels);
  const labelEls = new Map();

  const scene = new THREE.Scene();      // sky: bloomed
  const overlay = new THREE.Scene();    // stickers: drawn after bloom, never bloomed
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
  camera.position.z = 10;
  let width = 1, height = 1, disposed = false, lost = false;
  let currentQuality = null, pr = 1;

  // ---- nebula ----
  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uAspect: { value: 1.155 }, uBase: { value: new THREE.Color('#0D0822') }, uViolet: { value: new THREE.Color('#2B1660') }, uBlue: { value: new THREE.Color('#132A66') }, uMagenta: { value: new THREE.Color('#4E1A63') },
      // aurora band (upper third, additive, capped: aurora.js) lives in the same fragment so the sum is clamped
      uAuroraPhase: { value: 0 }, uTeal: { value: new THREE.Color(AURORA.teal) }, uLime: { value: new THREE.Color(AURORA.lime) }, uAuroraCap: { value: AURORA.intensityCap },
      uRightFade: { value: AURORA.rightFade }, uCentre: { value: AURORA.band.centre }, uHalfWidth: { value: AURORA.band.halfWidth }, uSkyLumCap: { value: AURORA.skyLumCap }, uOverscan: { value: NEBULA_OVERSCAN },
    },
    vertexShader: NEBULA_VS, fragmentShader: NEBULA_FS, depthTest: false, depthWrite: false,
  }));
  nebula.frustumCulled = false; nebula.renderOrder = 0;
  scene.add(nebula);
  const auroraU = nebula.material.uniforms;

  // ---- stars ----
  const starMeshes = starLayers.map((layer, i) => {
    const n = layer.stars.length;
    const pos = new Float32Array(n * 3), aR = new Float32Array(n), aB = new Float32Array(n), aT = new Float32Array(n);
    layer.stars.forEach((s, k) => { pos[k * 3] = s.x; pos[k * 3 + 1] = s.y; aR[k] = s.r; aB[k] = s.b; aT[k] = s.t; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1)); geo.setAttribute('aB', new THREE.BufferAttribute(aB, 1)); geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() }, uTime: { value: 0 }, uAmp: { value: 0 }, uPeriod: { value: layer.twinklePeriodSeconds || 9 }, uScale: { value: 1 }, uPixelRatio: { value: 1 }, uRipple: { value: 1 }, uColor: { value: new THREE.Color(layer.color || '#DCE6FF') } },
      vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 2 + i;
    scene.add(pts);
    return { pts, layer };
  });

  // ---- orbit rings ----
  const ringGroup = new THREE.Group(); ringGroup.renderOrder = 10; scene.add(ringGroup);
  const ringMat = new THREE.LineDashedMaterial({ color: new THREE.Color('#A9BEFF'), dashSize: 5, gapSize: 11, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  let ringKey = '';
  function buildRings(rings) {
    const key = rings.map(r => `${r.rx.toFixed(1)}:${r.ry.toFixed(1)}`).join('|');
    if (key === ringKey) return; ringKey = key;
    for (const child of [...ringGroup.children]) { ringGroup.remove(child); child.geometry.dispose(); }
    for (const r of rings) {
      const segs = 160; const pts = [];
      for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; pts.push(new THREE.Vector3(r.rx * Math.cos(a), -r.ry * Math.sin(a), 0)); }
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
      line.computeLineDistances(); line.frustumCulled = false; line.renderOrder = 10;
      ringGroup.add(line);
    }
  }

  // ---- fireflies ----
  const FF_MAX = 320;
  const ffRnd = seededRandom(`${seed}:fireflies`);
  const ffPos = new Float32Array(FF_MAX * 3), ffPhase = new Float32Array(FF_MAX), ffSpeed = new Float32Array(FF_MAX), ffSize = new Float32Array(FF_MAX), ffWarm = new Float32Array(FF_MAX);
  for (let i = 0; i < FF_MAX; i++) {
    ffPos[i * 3] = ffRnd(); ffPos[i * 3 + 1] = Math.pow(ffRnd(), 0.8); ffPhase[i] = ffRnd(); ffSpeed[i] = 0.25 + ffRnd() * 0.6;
    ffSize[i] = 3.2 + ffRnd() * 4.6; ffWarm[i] = ffRnd() < 0.62 ? 0.75 + ffRnd() * 0.25 : ffRnd() * 0.25;
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3)); ffGeo.setAttribute('aPhase', new THREE.BufferAttribute(ffPhase, 1)); ffGeo.setAttribute('aSpeed', new THREE.BufferAttribute(ffSpeed, 1)); ffGeo.setAttribute('aSize', new THREE.BufferAttribute(ffSize, 1)); ffGeo.setAttribute('aWarm', new THREE.BufferAttribute(ffWarm, 1));
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() }, uTime: { value: 0 }, uScale: { value: 1 }, uPixelRatio: { value: 1 }, uWarm: { value: 0 } },
    vertexShader: FIREFLY_VS, fragmentShader: FIREFLY_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat); fireflies.frustumCulled = false; fireflies.renderOrder = 20; scene.add(fireflies);

  // ---- sprite batches ----
  const glowTex = canvasTexture(discCanvas(128), { flipY: false });
  const halo = createSpriteBatch({ texture: glowTex, additive: true, capacity: 1400, renderOrder: 30 });
  const clusterBatch = createSpriteBatch({ texture: glowTex, additive: true, capacity: 600, renderOrder: 34 });
  const particleBatch = createSpriteBatch({ texture: glowTex, additive: true, capacity: PARTICLE_MAX + 64, renderOrder: 60 });
  scene.add(halo.mesh, clusterBatch.mesh, particleBatch.mesh);
  const soulBatches = []; const pageTex = []; let atlasVersion = -1;
  const flashColor = new THREE.Color('#F6C453'); // --sticker-gold
  // While cells keep landing (impostor bakes a few per frame, sprite decodes) a 2048^2 page would be re-uploaded
  // (16 MB) every frame; new cells are batched into one upload per ATLAS_UPLOAD_MS instead. New pages upload at once.
  let lastUploadAt = -Infinity;
  function ensureAtlas(now = performance.now()) {
    if (atlas.version === atlasVersion && soulBatches.length === atlas.pages.length) return;
    if (soulBatches.length === atlas.pages.length && now - lastUploadAt < ATLAS_UPLOAD_MS) return;
    lastUploadAt = now;
    atlasVersion = atlas.version;
    atlas.pages.forEach((p, i) => {
      if (!pageTex[i]) {
        pageTex[i] = canvasTexture(p.canvas, { flipY: false });
        soulBatches[i] = createSpriteBatch({ texture: pageTex[i], additive: false, capacity: 1024, renderOrder: 40 + i, fragmentShader: STICKER_FS, uniforms: { uTexel: { value: 1 / atlas.pageSize }, uFlashColor: { value: flashColor } } });
        overlay.add(soulBatches[i].mesh);
      } else pageTex[i].needsUpdate = true;
    });
  }

  // ---- decorated Souls: the 3D impostor stage (lazy: nothing loads until a decorated Soul asks) and the live entrance quads ----
  const impostors = createImpostorStage({ THREE });   // attached to the atlas once this renderer is fully built (below)
  let liveTex = null, heroBatch = null;
  function ensureLive() {
    if (heroBatch || !impostors.canvas) return;
    liveTex = canvasTexture(impostors.canvas, { flipY: false });
    heroBatch = createSpriteBatch({ texture: liveTex, additive: false, capacity: 16, renderOrder: 48, fragmentShader: STICKER_FS, uniforms: { uTexel: { value: 1 / IMPOSTOR.stage }, uFlashColor: { value: flashColor } } });
    overlay.add(heroBatch.mesh);
  }

  // ---- doodads (high tier only; strip atlas built once, stickers drawn in the overlay) ----
  const doodadAtlas = buildDoodadAtlas();
  const doodadTex = canvasTexture(doodadAtlas.canvas, { flipY: false });
  let doodadReady = false;
  doodadAtlas.ready.then(() => { doodadTex.needsUpdate = true; doodadReady = true; });
  const doodadBatch = createSpriteBatch({ texture: doodadTex, additive: false, capacity: DOODAD_SET.length, renderOrder: 36 });
  overlay.add(doodadBatch.mesh);
  let doodadHomes = [], doodadKey = '';
  const doodadState = DOODAD_SET.map(() => ({ x: NaN, y: NaN, alpha: 0 }));
  function updateDoodads(f, t, dt) {
    doodadBatch.begin();
    if (f.quality !== 'high' || !doodadReady) { doodadBatch.end(); return; }
    const L = f.layout;
    const ringIdx = Math.max(0, activeRingCount(f.count) - 1);
    const ring = f.rings[ringIdx];
    const outer = ring ? { rx: ring.rx, ry: ring.ry } : { rx: 0.22 * L.halfH * 1.35, ry: 0.22 * L.halfH };
    const key = `${ringIdx}|${width}x${height}`;
    if (key !== doodadKey) { doodadKey = key; doodadHomes = doodadLayout({ seed, width, height, outer, quality: 'high' }); }
    const zones = doodadExclusions({ clusters: f.clusters });
    const ease = 1 - Math.pow(1 - DOODAD_RULES.settleLerp, dt * 60);
    const aw = doodadAtlas.canvas.width, ah = doodadAtlas.canvas.height;
    doodadHomes.forEach((d, i) => {
      const st = doodadState[i];
      if (!Number.isFinite(st.x)) { st.x = d.x; st.y = d.y; }
      st.x += (d.x - st.x) * ease; st.y += (d.y - st.y) * ease;
      const off = doodadOffset(d, t, reducedMotion, L.scale);
      const x = st.x + off.dx + cam.dx * 0.6, y = st.y + off.dy + cam.dy * 0.6;
      const rect = doodadRect(d, x, y);
      const show = d.visible && !zones.some(z => rectsIntersect(rect, z));
      st.alpha += ((show ? 1 : 0) - st.alpha) * Math.min(1, dt * 4);
      if (st.alpha <= 0.01) return;
      const c = doodadAtlas.cells[i];
      doodadBatch.push(x, y, d.size, c.x / aw, (c.y + c.h) / ah, (c.x + c.w) / aw, c.y / ah, 1, 1, 1, st.alpha);
    });
    doodadBatch.end();
  }
  let cam = { dx: 0, dy: 0 };

  // ---- forest frame ----
  const forestPlanes = FOREST_LAYERS.map((layer, i) => {
    const c = document.createElement('canvas'); c.width = FOREST_REF.width; c.height = FOREST_REF.height;
    paintForest(c, forestLayout(seed, FOREST_REF.width, FOREST_REF.height, i), i);
    const mat = new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true, opacity: layer.alpha, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false; mesh.renderOrder = 80 + i;
    scene.add(mesh);
    return { mesh, layer };
  });

  // ---- particles (entrance trail, winner burst) ----
  const P = { x: new Float32Array(PARTICLE_MAX), y: new Float32Array(PARTICLE_MAX), vx: new Float32Array(PARTICLE_MAX), vy: new Float32Array(PARTICLE_MAX), life: new Float32Array(PARTICLE_MAX), max: new Float32Array(PARTICLE_MAX), size: new Float32Array(PARTICLE_MAX), r: new Float32Array(PARTICLE_MAX), g: new Float32Array(PARTICLE_MAX), b: new Float32Array(PARTICLE_MAX), a: new Float32Array(PARTICLE_MAX) };
  let pCount = 0;
  const pRnd = seededRandom(`${seed}:particles`);
  const trailPrev = new Map();   // entrance soulId -> last emitted position (distance-based emission)
  function spawn(x, y, vx, vy, life, size, r, g, b, peak = 1) {
    if (pCount >= PARTICLE_MAX) return;
    const i = pCount++;
    P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy; P.life[i] = life; P.max[i] = life; P.size[i] = size; P.r[i] = r; P.g[i] = g; P.b[i] = b; P.a[i] = peak;
  }
  /** Emits trail motes every ~16 px along the segment the entrance travelled since the last frame (fps-independent). */
  function emitTrail(id, x, y, size, r, g, b, scale) {
    const prev = trailPrev.get(id);
    trailPrev.set(id, { x, y });
    if (!prev) return;
    const d = Math.hypot(x - prev.x, y - prev.y);
    const n = Math.min(8, Math.floor(d / (16 * scale)));
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / n;
      const px = prev.x + (x - prev.x) * t + (pRnd() - 0.5) * size * 0.5, py = prev.y + (y - prev.y) * t + (pRnd() - 0.5) * size * 0.5;
      spawn(px, py, (pRnd() - 0.5) * 50 * scale, (pRnd() - 0.3) * 50 * scale, 0.45 + pRnd() * 0.4, size * (0.25 + pRnd() * 0.3), r, g, b, 0.55);
    }
  }
  function stepParticles(dt) {
    const drag = Math.pow(0.35, dt);
    for (let i = 0; i < pCount; i++) {
      P.life[i] -= dt;
      if (P.life[i] <= 0) { const l = --pCount; for (const k of Object.keys(P)) P[k][i] = P[k][l]; i--; continue; }
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.vx[i] *= drag; P.vy[i] *= drag;
    }
  }
  function drawParticles() {
    for (let i = 0; i < pCount; i++) {
      const a = P.life[i] / P.max[i];
      particleBatch.push(P.x[i], P.y[i], P.size[i] * (0.5 + 0.5 * a), 0, 0, 1, 1, P.r[i], P.g[i], P.b[i], Math.min(1, a * 1.15) * P.a[i]);
    }
  }

  // ---- composer ----
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.6);
  const overlayPass = new RenderPass(overlay, camera);
  overlayPass.clear = false;            // composes the stickers over the bloomed sky in the same buffer
  const outputPass = new OutputPass();
  composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(overlayPass); composer.addPass(outputPass);
  let pulseAt = NaN, pulsePeak = 0, pulseDur = pulseMs, warmAt = NaN;
  const pulsed = new Set();
  let flashIds = new Set(), flashAt = NaN, lastFlashDrawn = 0;

  const glowCache = new Map();
  function glowOf(item) {
    const key = String(item.soulId);
    let c = glowCache.get(key);
    if (!c) { const s = resolveSoul(item.config); c = lin(s.pal ? s.pal.glow : PALETTES[0].glow); glowCache.set(key, c); }
    return c;
  }

  function applyQuality(q) {
    currentQuality = q;
    const s = qualitySettings(q);
    pr = pixelRatioFor(q, dpr);
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    bloomPass.enabled = !!s.bloom;
    if (s.bloom) { bloomPass.radius = s.bloom.radius; bloomPass.threshold = s.bloom.threshold; bloomPass.strength = s.bloom.strength; }
    ffGeo.setDrawRange(0, Math.min(FF_MAX, s.fireflies));
    auroraU.uAuroraCap.value = AURORA.intensityCap * auroraTierGain(q);
    forestPlanes.forEach((fp, i) => { fp.mesh.visible = i >= FOREST_LAYERS.length - s.forestLayers; });
    for (const sm of starMeshes) sm.pts.material.uniforms.uPixelRatio.value = pr;
    ffMat.uniforms.uPixelRatio.value = pr;
    resize(width, height);
  }

  function resize(w, h) {
    width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false); composer.setSize(width, height);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    camera.left = 0; camera.right = width; camera.top = 0; camera.bottom = -height; camera.updateProjectionMatrix();
    nebula.scale.set(width * NEBULA_OVERSCAN, height * NEBULA_OVERSCAN, 1); nebula.material.uniforms.uAspect.value = width / height;
    const fs = Math.max(width / FOREST_REF.width, height / FOREST_REF.height) * 1.05;
    for (const fp of forestPlanes) fp.mesh.scale.set(FOREST_REF.width * fs, FOREST_REF.height * fs, 1);
    for (const sm of starMeshes) sm.pts.material.uniforms.uRes.value.set(width, height);
    ffMat.uniforms.uRes.value.set(width, height);
  }

  function drawSoul(item, detail, alpha, scale, glow, now, entering = false, live = null) {
    const size = item.size * (scale || 1);
    const [r, g, b] = glowOf(item);
    const flash = flashIds.size && flashIds.has(String(item.soulId)) ? outlineFlash(flashAt, now) : 0;
    if (flash > 0) lastFlashDrawn = flash;
    // palette light behind the sticker (bloomed); the sticker itself is drawn crisp in the overlay pass
    halo.push(item.x, item.y + size * 0.04, size * 2.1, 0, 0, 1, 1, r, g, b, (0.30 + 0.34 * glow + 0.25 * flash) * alpha);
    // entrances ask first (priority 1): a decorated Soul's impostor is baked before it settles
    const entry = atlas.get(item, detail, item.size * pr, { priority: entering ? 1 : 0 });
    if (live && heroBatch) {
      heroBatch.push(item.x, item.y, size, live.u0, live.v0, live.u1, live.v1, 1, 1, 1, alpha, hullPx(size) * (live.size / size), flash);
      return;
    }
    if (entry.ready && entry.page >= 0 && soulBatches[entry.page]) {
      const ps = atlas.pageSize;
      const hullTexels = hullPx(size) * (entry.w / size);
      soulBatches[entry.page].push(item.x, item.y, size, entry.x / ps, (entry.y + entry.h) / ps, (entry.x + entry.w) / ps, entry.y / ps, 1, 1, 1, alpha, hullTexels, flash);
    } else halo.push(item.x, item.y, size * 0.8, 0, 0, 1, 1, 0.8, 0.85, 1, 0.5 * alpha);
  }

  function updateLabels(clusters) {
    const seen = new Set();
    for (const c of clusters) {
      if (!c.label) continue;
      seen.add(c.key);
      let el = labelEls.get(c.key);
      if (!el) { el = document.createElement('span'); el.className = 'galaxy__label'; labels.appendChild(el); labelEls.set(c.key, el); }
      if (el.textContent !== c.label) el.textContent = c.label;
      el.style.transform = `translate(${Math.round(c.x)}px, ${Math.round(c.y + c.size / 2 + 2)}px)`;
    }
    for (const [k, el] of labelEls) if (!seen.has(k)) { el.remove(); labelEls.delete(k); }
  }

  let lastNow = 0;
  function render(f) {
    if (disposed || lost) return;
    if (f.quality !== currentQuality) applyQuality(f.quality);
    const now = performance.now();
    ensureAtlas(now);
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    const t = f.timeSec || 0, L = f.layout;
    cam = f.camera;
    // nebula + parallax
    nebula.material.uniforms.uTime.value = t;
    nebula.position.set(width / 2 + cam.dx * 0.1, -(height / 2 + cam.dy * 0.1), 0);
    // aurora: 0.01 rad/s drift (still under reduced motion); it rides the nebula plane's parallax
    auroraU.uAuroraPhase.value = auroraPhase(t, reducedMotion);
    if (Number.isFinite(flashAt) && now - flashAt > 1000) { flashIds = new Set(); flashAt = NaN; }
    // stars
    starMeshes.forEach((sm, i) => {
      const on = i < f.level.starLayers; sm.pts.visible = on; if (!on) return;
      const u = sm.pts.material.uniforms;
      u.uTime.value = t; u.uAmp.value = f.level.twinkle && !reducedMotion ? sm.layer.twinkleAmplitude || 0 : 0; u.uScale.value = L.scale;
      u.uRipple.value = 1 + 0.10 * (f.ripple || 0);
      u.uOffset.value.set(cam.dx * (reducedMotion ? 0 : sm.layer.parallax), cam.dy * (reducedMotion ? 0 : sm.layer.parallax));
    });
    // rings
    ringGroup.visible = f.rings.length > 0;
    if (f.rings.length) { buildRings(f.rings); ringGroup.position.set(f.rings[0].cx, -f.rings[0].cy, 0); }
    // fireflies
    const warm = Number.isFinite(warmAt) ? Math.min(1, (now - warmAt) / 200) * pulseValue(1, warmAt, 2600, now) : 0;
    ffMat.uniforms.uTime.value = reducedMotion ? 0 : t; ffMat.uniforms.uScale.value = L.scale; ffMat.uniforms.uWarm.value = warm;
    ffMat.uniforms.uOffset.value.set(cam.dx * 0.8, cam.dy * 0.8);
    // souls
    for (const b of soulBatches) b.begin();
    halo.begin(); clusterBatch.begin(); particleBatch.begin();
    for (const item of f.souls) drawSoul(item, item.detail, item.alpha ?? 1, item.scale ?? 1, 0, now);
    for (const c of f.clusters) {
      // neutral lilac glow, identical for every cluster (only the DOM count label differs)
      clusterBatch.push(c.x, c.y, c.size * 1.7, 0, 0, 1, 1, 0.72, 0.62, 1, 0.34);
      clusterBatch.push(c.x, c.y, c.size * 0.6, 0, 0, 1, 1, 0.9, 0.86, 1, 0.5);
    }
    updateLabels(f.clusters);
    // entrances (a decorated Soul is the live 3D figure while the stage is ready; the rest keep their atlas sprite)
    const active = new Set();
    const live = f.entrances.length && impostors.state === 'ready' ? impostors.renderEntrances(f.entrances, pr, { reducedMotion }) : null;
    if (live && live.size) { ensureLive(); if (liveTex) liveTex.needsUpdate = true; }
    if (heroBatch) heroBatch.begin();
    for (const e of f.entrances) {
      active.add(e.soulId);
      const glow = e.glow || 0;
      const [r, g, b] = glowOf(e);
      if (f.level.entranceTrail && !reducedMotion) {
        if (e.trail) for (const tp of e.trail) particleBatch.push(tp.x, tp.y, e.size * 1.2, 0, 0, 1, 1, r, g, b, Math.min(0.5, Math.max(0, tp.alpha) * 1.4));
        if (e.phase === 'arc') emitTrail(e.soulId, e.x, e.y, e.size, r, g, b, L.scale);
      }
      if (e.phase === 'pulse' && !pulsed.has(e.soulId) && !reducedMotion) { pulsed.add(e.soulId); pulseAt = now; pulsePeak = BLOOM_PULSE.entrance; pulseDur = pulseMs; }
      drawSoul(e, 'full', e.alpha ?? 1, e.scale ?? 1, glow, now, true, live ? live.get(String(e.soulId)) || null : null);
    }
    if (heroBatch) heroBatch.end();
    for (const id of pulsed) if (!active.has(id)) pulsed.delete(id);
    for (const id of trailPrev.keys()) if (!active.has(id)) trailPrev.delete(id);
    stepParticles(dt); drawParticles();
    for (const b of soulBatches) b.end();
    halo.end(); clusterBatch.end(); particleBatch.end();
    updateDoodads(f, t, dt);
    // forest parallax
    for (const fp of forestPlanes) {
      const p = reducedMotion ? 0 : fp.layer.parallax;
      fp.mesh.position.set(width / 2 + cam.dx * p, -(height / 2 + cam.dy * p), 0);
    }
    // bloom (single, decaying pulses only: never repeats faster than the entrance queue / winner cadence)
    if (bloomPass.enabled) bloomPass.strength = bloomStrength(f.quality, pulseValue(pulsePeak, pulseAt, pulseDur, now));
    composer.render();
  }

  /** Outline flash on the winning Souls (once, 250 ms). Souls not yet floated simply have nothing to flash. */
  function flash(soulIds) {
    if (disposed || lost || reducedMotion || !Array.isArray(soulIds) || !soulIds.length) return false;
    flashIds = new Set(soulIds.map(String)); flashAt = performance.now();
    return true;
  }

  function winner(layout, opts = {}) {
    if (disposed || lost || reducedMotion) return;
    if (opts && Array.isArray(opts.soulIds)) flash(opts.soulIds);
    const L = layout || { cx: width / 2, cy: height / 2, scale: height / 1080 };
    const gold = lin('#F5C84B'), lilac = lin('#CDBBFF'), amber = lin('#FFA24A');
    // one soft central glow (no flash: a single 0.7 s fade) plus motes radiating outward
    spawn(L.cx, L.cy, 0, 0, 0.7, 360 * L.scale, gold[0], gold[1], gold[2], 0.6);
    for (let i = 0; i < 220; i++) {
      const a = pRnd() * Math.PI * 2, sp = (140 + pRnd() * 420) * L.scale;
      const c = i % 5 === 0 ? lilac : i % 2 ? gold : amber;
      spawn(L.cx + Math.cos(a) * 12, L.cy + Math.sin(a) * 12, Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + pRnd() * 0.7, (9 + pRnd() * 16) * L.scale, c[0], c[1], c[2]);
    }
    warmAt = performance.now();
    pulseAt = warmAt; pulsePeak = BLOOM_PULSE.winner; pulseDur = 800;
  }

  function handleLost(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    lost = true;
    if (typeof onLost === 'function') onLost();
  }
  canvas.addEventListener('webglcontextlost', handleLost, false);

  applyQuality(quality);
  atlas.setImpostors(impostors); // only now: a renderer that failed to build never leaves its stage on the shared atlas

  /** After the frame (galaxy.js, outside the measured render): bake queued v2 / v3 impostors for about `budgetMs`. */
  function afterFrame(budgetMs) { if (!disposed && !lost) impostors.pump(budgetMs); }
  /** A round just ended: load the impostor stage now so the coming Float entrances are 3D from their first frame. */
  function prewarm() { if (!disposed && !lost) impostors.warm(); }

  return {
    kind: THREE_RENDERER_KIND, canvas, resize, render, winner, flash, afterFrame, prewarm,
    /** Rehearsal instrumentation: doodad homes / visibility, the atlas cells in use and the impostor stage. */
    debug() { return { doodads: doodadHomes.map((d, i) => ({ name: d.name, x: Math.round(doodadState[i].x), y: Math.round(doodadState[i].y), size: d.size, visible: d.visible, alpha: Number(doodadState[i].alpha.toFixed(2)) })), aurora: { cap: auroraU.uAuroraCap.value, skyLumCap: auroraU.uSkyLumCap.value, phase: auroraU.uAuroraPhase.value }, hull: HULL, flash: { ids: [...flashIds], at: flashAt, value: outlineFlash(flashAt, performance.now()), lastDrawn: lastFlashDrawn }, impostors: { ...impostors.stats, pending: impostors.pending } }; },
    get lost() { return lost; },
    get quality() { return currentQuality; },
    /** Rehearsal instrumentation: simulate a context loss so the canvas2d hand-over can be checked. */
    loseContext() { try { renderer.forceContextLoss(); } catch { /* ignore */ } },
    onLost(fn) { onLost = fn; },
    dispose() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', handleLost);
      if (atlas.impostors === impostors) atlas.setImpostors(null); // later cells (canvas2d / static) use the 2D composition
      impostors.dispose();
      if (heroBatch) heroBatch.dispose();
      if (liveTex) liveTex.dispose();
      try { composer.dispose(); } catch { /* ignore */ }
      for (const b of [halo, clusterBatch, particleBatch, doodadBatch, ...soulBatches]) b.dispose();
      for (const tx of pageTex) tx.dispose();
      doodadTex.dispose();
      glowTex.dispose(); nebula.geometry.dispose(); nebula.material.dispose(); ffGeo.dispose(); ffMat.dispose(); ringMat.dispose();
      for (const sm of starMeshes) { sm.pts.geometry.dispose(); sm.pts.material.dispose(); }
      for (const fp of forestPlanes) { fp.mesh.geometry.dispose(); fp.mesh.material.map.dispose(); fp.mesh.material.dispose(); }
      try { renderer.dispose(); if (!lost) renderer.forceContextLoss(); } catch { /* ignore */ }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (labels.parentNode) labels.parentNode.removeChild(labels);
    },
  };
}

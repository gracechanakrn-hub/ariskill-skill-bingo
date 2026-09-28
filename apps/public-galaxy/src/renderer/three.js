// Three.js renderer (primary tier, D-22 / stage 9.1). Vendored library imported by absolute path only
// (`/packages/vendor/three/*`): no CDN, no import map, no build step. galaxy.js loads this module lazily so an
// import failure falls through to the raw WebGL2 / Canvas 2D / static renderers.
//
// Composition (back to front, all in the Galaxy region only - the canvas never extends past panelX):
//   space backdrop (stage 15, D-36: a Blender plate from /assets/space via space.js, drifting and breathing very
//   slowly with the camera parallax; a plain dark sky without space.json), the constellation lines (shimmering) and
//   their stars (each twinkling on its own), the meteors behind the orbit
//   three star layers as Points (per-star twinkle phase, parallax to the camera drift, additive)
//   faint orbit rings (dashed LineLoops, additive), the occasional falling star
//   Soul halos (additive palette light BEHIND each sticker, bloomed)
//   clusters above 300 Souls (neutral glow sprite; the count label lives in a DOM overlay)
//   entrance trail / burst particles (short-lived additive points)
// then EffectComposer: RenderPass(sky) -> UnrealBloomPass (off on `low`) -> RenderPass(overlay, no clear) -> OutputPass.
// The overlay scene is drawn AFTER bloom so the stickers stay flat, crisp print on the glowing sky (art direction v2):
//   Souls far to near (stage 15, D-36: depth sets their size and haze; instanced atlas quads at detail 'simple', drawn
//   in runs so a Soul acting live from the impostor stage keeps its place in the depth order; no white die-cut, only
//   the winner's gold outline flash in the fragment shader)
//   Float entrances of decorated Souls (the live 3D figure from the impostor stage, same sticker shader)
//   the Soul visiting the front to say hi (live, front-most, with a soft aura)
//   the meteors in front, at the corners and edges where Souls never go
// Decorated (v2 / v3) Souls (D-29, D-31): the impostor stage (impostor.js) renders the phone's 3D Soul - shared soul3d
// rig on the body of the Soul's variant (the v3 body for a v3 Soul), lights, tone mapping - live for each Float
// entrance's hero moment, for the say-hi visit and for the Souls doing an idle micro action (stage 15), and bakes
// settled decorated Souls into their atlas cells after each frame (afterFrame), so the Galaxy shows the same decorated
// Soul as the phone; GLTFLoader and the models load only when the first decorated Soul appears. v1 Souls keep their 2D
// sprites; so does a Soul whose body variant could not load, and any live item that finds no free tile.
// BR-17: nothing here tints, scales or reorders a Soul by anything but config / badge / soulId.
import * as THREE from '/packages/vendor/three/index.js';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from '/packages/vendor/three/addons.js';
import { resolveSoul, PALETTES } from '../../../../packages/ui/soul-renderer.js';
import { qualitySettings, pixelRatioFor, bloomStrength, pulseValue, BLOOM_PULSE, WINNER_LOOK, outlineFlash, hullPx, HULL } from './three-quality.js';
import { seededRandom } from './forest.js';
import { activeRingCount, DEPTH } from './scene.js';
import { backdropPlacement, constellationPlacement, constellationStars, meteorPose, fallingStarAt } from './space.js';
import { createImpostorStage } from './impostor.js';
import { IMPOSTOR } from './impostor-plan.js';

export const THREE_RENDERER_KIND = 'three';
/** Glow of the Soul visiting the front (its soft aura; entrances glow from their own pulse). */
const VISIT_GLOW = 0.5;
const PARTICLE_MAX = 2400;
const ATLAS_UPLOAD_MS = 200;  // at most ~5 atlas page re-uploads per second while cells land

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

const SPRITE_VS = /* glsl */`
attribute vec2 iCenter; attribute float iSize; attribute vec4 iUv; attribute vec4 iTint; attribute vec2 iFx;
varying vec2 vUv; varying vec4 vTint; varying vec2 vFx;
void main(){
  vec2 w = vec2(iCenter.x, -iCenter.y) + position.xy * iSize;
  vUv = mix(iUv.xy, iUv.zw, uv); vTint = iTint; vFx = iFx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 0.0, 1.0);
}`;
// Sticker print: the big screen's Souls have no white die-cut (stage 15, D-36: the atlas cells and the live tiles are
// drawn without it). The page textures are premultiplied, so the colour is recovered exactly at filtered edges (no dark
// or white fringe) and low-alpha texels are dropped so the sky shows through. vFx.x > 0 only during the winner outline
// flash: a screen-space hull (max alpha over 8 taps at vFx.x texels) in gold (vFx.y, 0..1) for 250 ms.
const STICKER_FS = /* glsl */`
precision mediump float;
uniform sampler2D uMap; uniform float uTexel; uniform vec3 uFlashColor;
varying vec2 vUv; varying vec4 vTint; varying vec2 vFx;
void main(){
  vec4 c = texture2D(uMap, vUv);
  vec3 base = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float a = smoothstep(0.30, 0.60, c.a);
  float r = vFx.x * (1.0 + vFx.y) * uTexel;
  vec3 rgb = base;
  float outA = a;
  if (r > 0.0) {
    float m = c.a, d = 0.7071 * r;
    m = max(m, texture2D(uMap, vUv + vec2( r, 0.0)).a); m = max(m, texture2D(uMap, vUv + vec2(-r, 0.0)).a);
    m = max(m, texture2D(uMap, vUv + vec2(0.0,  r)).a); m = max(m, texture2D(uMap, vUv + vec2(0.0, -r)).a);
    m = max(m, texture2D(uMap, vUv + vec2( d,  d)).a); m = max(m, texture2D(uMap, vUv + vec2(-d,  d)).a);
    m = max(m, texture2D(uMap, vUv + vec2( d, -d)).a); m = max(m, texture2D(uMap, vUv + vec2(-d, -d)).a);
    float hull = smoothstep(0.45, 0.75, m);
    rgb = mix(mix(vec3(1.0), uFlashColor, vFx.y), base, a);
    outA = max(a, hull * vFx.y);
  }
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

function canvasTexture(canvas, { flipY = true, premultiplied = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = flipY; t.generateMipmaps = false; t.premultiplyAlpha = premultiplied;
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
    get full() { return n >= capacity; },
    dispose() { geo.dispose(); mat.dispose(); base.dispose(); },
  };
}

export function createThreeRenderer({ container, atlas, starLayers = [], space = null, background = '#0B0F1F', dpr = 1, quality = 'high', seed = 'arise-galaxy-2026', pulseMs = 400, reducedMotion = false, onLost = null } = {}) {
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

  // ---- space (stage 15, D-36): the Blender plates of space.json; no file, a plain dark sky (the clear colour) ----
  const spec = space && space.spec ? space.spec : null;
  const spaceImages = (space && space.images) || {};
  const spaceTextures = [], spaceMeshes = [];
  /** A textured quad for one space image (null when the image is missing: that layer is left out). */
  function spacePlane(img, { renderOrder, parent = scene, transparent = true, additive = false, mipmaps = false }) {
    if (!img) return null;
    const map = new THREE.Texture(img);
    map.colorSpace = THREE.SRGBColorSpace; map.generateMipmaps = mipmaps; map.needsUpdate = true;
    map.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; map.magFilter = THREE.LinearFilter;
    if (mipmaps) map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map, transparent, depthTest: false, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    mesh.frustumCulled = false; mesh.renderOrder = renderOrder;
    parent.add(mesh);
    spaceTextures.push(map); spaceMeshes.push(mesh);
    return { mesh, aspect: img.width / img.height || 1 };
  }
  // D-57: the plates are rendered at 2x; mipmaps keep them clean when a 1080p screen shows them smaller
  const backdrop = spec ? spacePlane(spaceImages.backdrop, { renderOrder: 0, transparent: false, mipmaps: true }) : null;
  const constLines = spec ? spacePlane(spaceImages.constellations, { renderOrder: 1, mipmaps: true }) : null;
  // meteors: behind the orbit in the sky (bloomed), or in front of the Souls in the overlay (at the corners and edges)
  const meteors = spec ? spec.meteors.map((m, i) => { const q = spacePlane((spaceImages.meteors || [])[i], { renderOrder: m.front ? 70 : 5, parent: m.front ? overlay : scene, mipmaps: true }); return q ? { m, ...q } : null; }).filter(Boolean) : [];
  const fallingStar = spec && spec.fallingStars ? spacePlane(spaceImages.fallingStar, { renderOrder: 12, additive: true }) : null;
  if (fallingStar) fallingStar.mesh.visible = false;
  let spaceInfo = { layers: spaceMeshes.length, fallingStar: null };

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

  // ---- sprite batches ----
  const glowTex = canvasTexture(discCanvas(128), { flipY: false });
  const halo = createSpriteBatch({ texture: glowTex, additive: true, capacity: 1400, renderOrder: 30 });
  const clusterBatch = createSpriteBatch({ texture: glowTex, additive: true, capacity: 600, renderOrder: 34 });
  const particleBatch = createSpriteBatch({ texture: glowTex, additive: true, capacity: PARTICLE_MAX + 64, renderOrder: 60 });
  // the constellation stars: one twinkling glow each, on the lines (the lines image carries no stars)
  const constStars = createSpriteBatch({ texture: glowTex, additive: true, capacity: Math.max(1, spec ? spec.constellations.stars.length : 1), renderOrder: 1.5 });
  scene.add(halo.mesh, clusterBatch.mesh, particleBatch.mesh, constStars.mesh);
  const pageTex = []; let atlasVersion = -1;
  const flashColor = new THREE.Color('#F6C453'); // --sticker-gold
  // Sticker runs: the stickers are drawn in order (Souls far to near, then entrances, then the visit) in as few
  // instanced batches as possible - a new batch only where the texture changes (an atlas page, or the impostor stage's
  // live tiles), so a Soul acting live keeps its place in the depth order. The pool grows to the most runs a frame used.
  const runs = []; let runN = 0;
  function beginRuns() { runN = 0; }
  function pushSticker(tex, texel, x, y, s, u0, v0, u1, v1, a, hull, flash) {
    let b = runN ? runs[runN - 1] : null;
    if (!b || b.material.uniforms.uMap.value !== tex || b.full) {
      if (!runs[runN]) {
        runs[runN] = createSpriteBatch({ texture: tex, additive: false, capacity: 1024, renderOrder: 40, fragmentShader: STICKER_FS, uniforms: { uTexel: { value: texel }, uFlashColor: { value: flashColor } } });
        overlay.add(runs[runN].mesh);
      }
      b = runs[runN];
      b.material.uniforms.uMap.value = tex; b.material.uniforms.uTexel.value = texel;
      b.mesh.renderOrder = 40 + runN * 0.001;
      b.begin();
      runN++;
    }
    b.push(x, y, s, u0, v0, u1, v1, 1, 1, 1, a, hull, flash);
  }
  function endRuns() { runs.forEach((b, i) => { if (i >= runN) b.begin(); b.end(); }); }
  // While cells keep landing (impostor bakes a few per frame, sprite decodes) a 2048^2 page would be re-uploaded
  // (16 MB) every frame; new cells are batched into one upload per ATLAS_UPLOAD_MS instead. New pages upload at once.
  let lastUploadAt = -Infinity;
  function ensureAtlas(now = performance.now()) {
    if (atlas.version === atlasVersion && pageTex.length === atlas.pages.length) return;
    if (pageTex.length === atlas.pages.length && now - lastUploadAt < ATLAS_UPLOAD_MS) return;
    lastUploadAt = now;
    atlasVersion = atlas.version;
    atlas.pages.forEach((p, i) => {
      if (!pageTex[i]) pageTex[i] = canvasTexture(p.canvas, { flipY: false, premultiplied: true });
      else pageTex[i].needsUpdate = true;
    });
  }

  // ---- decorated Souls: the 3D impostor stage (lazy: nothing loads until a decorated Soul asks) and its live tiles ----
  const impostors = createImpostorStage({ THREE });   // attached to the atlas once this renderer is fully built (below)
  let liveTex = null;
  function ensureLive() { if (!liveTex && impostors.canvas) liveTex = canvasTexture(impostors.canvas, { flipY: false, premultiplied: true }); }

  let cam = { dx: 0, dy: 0 };

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
  // D-57: multisampled targets (the count follows the quality level, see applyQuality) smooth every edge drawn
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: qualitySettings(quality).msaa || 0 });
  const composer = new EffectComposer(renderer, composerTarget);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.6);
  const overlayPass = new RenderPass(overlay, camera);
  overlayPass.clear = false;            // composes the stickers over the bloomed sky in the same buffer
  const outputPass = new OutputPass();
  composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(overlayPass); composer.addPass(outputPass);
  let pulseAt = NaN, pulsePeak = 0, pulseDur = pulseMs;
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
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== (s.msaa || 0)) { rt.samples = s.msaa || 0; rt.dispose(); } // reallocated on next use
    bloomPass.enabled = !!s.bloom;
    if (s.bloom) { bloomPass.radius = s.bloom.radius; bloomPass.threshold = s.bloom.threshold; bloomPass.strength = s.bloom.strength; }
    for (const sm of starMeshes) sm.pts.material.uniforms.uPixelRatio.value = pr;
    resize(width, height);
  }

  function resize(w, h) {
    width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false); composer.setSize(width, height);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    camera.left = 0; camera.right = width; camera.top = 0; camera.bottom = -height; camera.updateProjectionMatrix();
    for (const sm of starMeshes) sm.pts.material.uniforms.uRes.value.set(width, height);
  }

  /**
   * One sticker: the palette light behind it (bloomed) and the sticker itself in the overlay, from its live tile when it
   * has one, else from its atlas cell (a placeholder glow until the cell lands). opts: { detail, alpha, scale, glow,
   * now, priority (1: bake ahead, an entrance), live (uv rect), cellScale (a visit asks for a cell at its drawn size),
   * count (the orbit's Soul count: caps the cell so the crowd fits the atlas pages, D-57) }.
   */
  function drawSoul(item, { detail, alpha = 1, scale = 1, glow = 0, now, priority = 0, live = null, cellScale = 1, count = 0 }) {
    const won = item.badge === 'bingo-star';            // a Bingo winner: bigger, in a gold glow (WINNER_LOOK, D-36)
    const size = item.size * (scale || 1) * (won ? WINNER_LOOK.scale : 1);
    const [r, g, b] = glowOf(item);
    const flash = flashIds.size && flashIds.has(String(item.soulId)) ? outlineFlash(flashAt, now) : 0;
    if (flash > 0) lastFlashDrawn = flash;
    // palette light behind the sticker (bloomed); the sticker itself is drawn crisp in the overlay pass. A winner's gold
    // glow lies under it, wider
    if (won) halo.push(item.x, item.y + size * 0.04, size * WINNER_LOOK.halo, 0, 0, 1, 1, ...WINNER_LOOK.rgb, (WINNER_LOOK.alpha + 0.25 * flash) * alpha);
    halo.push(item.x, item.y + size * 0.04, size * 2.1, 0, 0, 1, 1, r, g, b, (0.30 + 0.34 * glow + 0.25 * flash) * alpha);
    // the die-cut hull only shows as the winner's outline flash (the big screen has no white border)
    const hull = (texelsPerPx) => (flash > 0 ? hullPx(size) * texelsPerPx : 0);
    // the atlas cell, even while live: an entrance bakes its impostor ahead of settling (priority 1); a live visit needs
    // none (its orbit cell exists), and without a live tile it asks for a cell at its drawn size
    const entry = live && cellScale !== 1 ? null : atlas.get(item, detail, item.size * cellScale * pr, { priority, count });
    if (live && liveTex) { pushSticker(liveTex, 1 / IMPOSTOR.stage, item.x, item.y, size, live.u0, live.v0, live.u1, live.v1, alpha, hull(live.size / size), flash); return; }
    if (entry && entry.ready && entry.page >= 0 && pageTex[entry.page]) {
      const ps = atlas.pageSize;
      pushSticker(pageTex[entry.page], 1 / ps, item.x, item.y, size, entry.x / ps, (entry.y + entry.h) / ps, (entry.x + entry.w) / ps, entry.y / ps, alpha, hull(entry.w / size), flash);
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

  /**
   * The space layers at t (space.js): the backdrop's drift and breathing, the lines' shimmer, each star's twinkle, the
   * meteors' spin and drift loop, the falling star. Reduced motion: all still, no falling star; 'low': no falling star,
   * no spin.
   */
  function updateSpace(f, t) {
    constStars.begin();
    if (!spec) { constStars.end(); return; }
    const opts = { camera: reducedMotion ? null : f.camera, reducedMotion };
    if (backdrop) {
      const b = backdropPlacement(spec, width, height, t, { ...opts, aspect: backdrop.aspect });
      backdrop.mesh.position.set(b.x, -b.y, 0); backdrop.mesh.scale.set(b.w, b.h, 1);
    }
    const plate = constellationPlacement(spec, width, height, t, { ...opts, aspect: constLines ? constLines.aspect : undefined });
    if (constLines) { constLines.mesh.position.set(plate.x, -plate.y, 0); constLines.mesh.scale.set(plate.w, plate.h, 1); constLines.mesh.material.opacity = plate.alpha; }
    for (const st of constellationStars(spec, plate, height, t, opts)) constStars.push(st.x, st.y, st.r * 6, 0, 0, 1, 1, 0.93, 0.95, 1, st.a);
    constStars.end();
    for (const me of meteors) {
      const q = meteorPose(me.m, width, height, t, { ...opts, quality: f.quality });
      me.mesh.position.set(q.x, -q.y, 0); me.mesh.scale.set(q.size * me.aspect, q.size, 1); me.mesh.rotation.z = (-q.rotDeg * Math.PI) / 180;
    }
    if (fallingStar) {
      const fs = fallingStarAt(spec, width, height, t, { seed, reducedMotion, quality: f.quality });
      fallingStar.mesh.visible = !!fs && fs.alpha > 0;
      spaceInfo.fallingStar = fs ? { k: fs.k, alpha: Number(fs.alpha.toFixed(2)) } : null;
      if (fs) {
        // the streak's head (its right end) sits on the path; the sprite is centred half a length behind it
        const a = (fs.angleDeg * Math.PI) / 180;
        fallingStar.mesh.position.set(fs.x - Math.cos(a) * fs.length / 2, -(fs.y - Math.sin(a) * fs.length / 2), 0);
        fallingStar.mesh.scale.set(fs.length, fs.length / fallingStar.aspect, 1);
        fallingStar.mesh.rotation.z = -a;
        fallingStar.mesh.material.opacity = fs.alpha;
      }
    }
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
    updateSpace(f, t);
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
    // live 3D figures from the impostor stage: Float entrances, the say-hi visit and the Souls acting in orbit
    const visits = f.visits || [];
    const liveItems = [];
    for (const e of f.entrances) liveItems.push({ ...e, role: 'entrance' });
    for (const v of visits) liveItems.push({ ...v, role: 'visit' });
    for (const item of f.souls) if (item.act) liveItems.push({ ...item, role: 'performer' });
    const live = liveItems.length && impostors.state === 'ready' ? impostors.renderLive(liveItems, pr, { reducedMotion }) : null;
    if (live && live.size) { ensureLive(); if (liveTex) liveTex.needsUpdate = true; }
    const liveOf = (item) => (live ? live.get(String(item.soulId)) || null : null);
    // souls, far to near (an acting Soul from its live tile, in its place)
    beginRuns();
    halo.begin(); clusterBatch.begin(); particleBatch.begin();
    // orbit cells are baked at the nearest depth size (D-36), so a near Soul is as sharp as its live tile and one cell
    // serves the whole orbit
    for (const item of f.souls) drawSoul(item, { detail: item.detail, alpha: item.alpha ?? 1, scale: item.scale ?? 1, now, live: item.act ? liveOf(item) : null, cellScale: item.depth === undefined || item.detail === 'dot' ? 1 : DEPTH.scale[1], count: f.souls.length });
    for (const c of f.clusters) {
      // neutral lilac glow, identical for every cluster (only the DOM count label differs)
      clusterBatch.push(c.x, c.y, c.size * 1.7, 0, 0, 1, 1, 0.72, 0.62, 1, 0.34);
      clusterBatch.push(c.x, c.y, c.size * 0.6, 0, 0, 1, 1, 0.9, 0.86, 1, 0.5);
    }
    updateLabels(f.clusters);
    // entrances (a decorated Soul is the live 3D figure while the stage is ready; the rest keep their atlas sprite)
    const active = new Set();
    for (const e of f.entrances) {
      active.add(e.soulId);
      const glow = e.glow || 0;
      const [r, g, b] = glowOf(e);
      if (f.level.entranceTrail && !reducedMotion) {
        if (e.trail) for (const tp of e.trail) particleBatch.push(tp.x, tp.y, e.size * 1.2, 0, 0, 1, 1, r, g, b, Math.min(0.5, Math.max(0, tp.alpha) * 1.4));
        if (e.phase === 'arc') emitTrail(e.soulId, e.x, e.y, e.size, r, g, b, L.scale);
      }
      if (e.phase === 'pulse' && !pulsed.has(e.soulId) && !reducedMotion) { pulsed.add(e.soulId); pulseAt = now; pulsePeak = BLOOM_PULSE.entrance; pulseDur = pulseMs; }
      drawSoul(e, { detail: 'full', alpha: e.alpha ?? 1, scale: e.scale ?? 1, glow, now, priority: 1, live: liveOf(e) });
    }
    // the visit, front-most: out of the orbit to the front, waves hi (live), and back; a soft aura, no trail
    for (const v of visits) drawSoul(v, { detail: 'full', alpha: v.alpha ?? 1, scale: v.scale ?? 1, glow: VISIT_GLOW, now, priority: 1, live: liveOf(v), cellScale: v.scale ?? 1 });
    for (const id of pulsed) if (!active.has(id)) pulsed.delete(id);
    for (const id of trailPrev.keys()) if (!active.has(id)) trailPrev.delete(id);
    stepParticles(dt); drawParticles();
    endRuns();
    halo.end(); clusterBatch.end(); particleBatch.end();
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
    pulseAt = performance.now(); pulsePeak = BLOOM_PULSE.winner; pulseDur = 800;
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
    /** Rehearsal instrumentation: the space layers, the winner flash and the impostor stage. */
    debug() { return { space: { loaded: !!spec, ...spaceInfo, meteors: meteors.length }, hull: HULL, flash: { ids: [...flashIds], at: flashAt, value: outlineFlash(flashAt, performance.now()), lastDrawn: lastFlashDrawn }, impostors: { ...impostors.stats, pending: impostors.pending } }; },
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
      for (const b of runs) b.dispose();
      if (liveTex) liveTex.dispose();
      try { composer.dispose(); } catch { /* ignore */ }
      for (const b of [halo, clusterBatch, particleBatch, constStars]) b.dispose();
      for (const tx of pageTex) tx.dispose();
      glowTex.dispose(); ringMat.dispose();
      for (const m of spaceMeshes) { m.geometry.dispose(); m.material.dispose(); }
      for (const tx of spaceTextures) tx.dispose();
      for (const sm of starMeshes) { sm.pts.geometry.dispose(); sm.pts.material.dispose(); }
      try { renderer.dispose(); if (!lost) renderer.forceContextLoss(); } catch { /* ignore */ }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (labels.parentNode) labels.parentNode.removeChild(labels);
    },
  };
}

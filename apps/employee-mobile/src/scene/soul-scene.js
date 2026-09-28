// apps/employee-mobile/src/scene/soul-scene.js - the Soul reveal / Float hero scene (E8 -> E10) in vendored Three.js.
// Darkness -> a glowing orb forms in the centre (sprite + gathering motes) -> light gathers -> the Soul resolves as the
// baseline character (D-27, docs/art/soul-baseline.md), decorated since D-29 (docs/art/soul-decorations.md): the one
// sculpted GLB tinted per Soul from its vertex mask (v1 palette, or the v2 body gradient; drips, eye discs, groove
// ring, orb), glossy clay with a studio reflection, the antenna orb lit in the Soul's glow, the v2 face kit and 10
// skill charms, and a soft back glow in the glow colour. D-58: no white die-cut outline, no dashed / halo ring and no
// floor ring (they read as white borders); a Bingo winner wears the big screen's gold crown instead of the star
// medallion. A v3 Soul (stage 13, D-31, docs/art/soul-faces.md) stands on the v3 body (no orb, no button eyes; the
// soulBodyVariant of its config) with its face plate, eyes, refitted face kit and the antenna charm; when the v3 body
// cannot load the scene resolves null and the SVG stays.
// The figure, badge and pose come from packages/ui/soul3d (buildSoulRig), shared with the public Galaxy's Float
// entrance, so the big screen shows this same Soul. The charms and the face fade in with the features stage; a slow
// decoration download never holds the reveal (it joins when it lands, or the Soul stays the plain gradient Soul).
// The last reveal stage is the sticker "peel" (scale 0.92 -> 1, 6 deg tilt, one 250 ms outline flash); then the Soul
// settles into a slow bob above its floor glow. Float lifts it with a mote trail and fades. Timed by
// tokens/motion.json soulReveal / float (callers pass the durations); skip jumps to the end; one static frame under
// reduced motion. BR-17: size, brightness and motion are shared constants; nothing here reads Platform or Role (the
// crown follows the Bingo badge, as on the big screen). Low tier: lite GLB for the body, no clearcoat, no bloom. Model or module failure -> null
// (caller keeps the SVG).
import { loadThree } from './loader.js';
import { loadWinnerCrown } from '../../../../packages/ui/soul3d/winner.js';
import { detectQuality, pixelRatioFor, probeFrameTime } from './capability.js';
import { baselineParams, BASELINE, stageProgress, easeEmphasized, easeExit, stickerPeel, revealScale } from './soul-params.js';
import { loadSoulModels, soulBodyVariant, buildSoulRig, loadSoulDecor, makeGlowTexture, makeStudioEnvironment, applySoulToneMapping, addStudioLights, addGlowLight, LOOK } from './soul-model.js';

const INK = 0x0a0622;
const REST_Y = BASELINE.restY;
/** How long the scene waits for the decorations before it opens without them (they still join if they land later). */
export const DECOR_WAIT_MS = 700;

/**
 * createSoulScene(host, { config, badge, reduced, onFallback }) -> Promise<controller | null>
 * controller: { reveal({ durationMs }) -> Promise, skip(), float({ durationMs }) -> Promise, dispose() }
 * Resolves null when the tier is 'off' or the modules / models fail to load (caller keeps the SVG + CSS path).
 */
export async function createSoulScene(host, opts) {
  if (!host) return null;
  const quality = detectQuality();
  if (quality === 'off') return null;
  let mods, models;
  // the body of the config's variant: the v3 body for a v3 Soul (D-31), else the baseline
  // D-58: no white die-cut on the phone, so the separate outline (hull) model is not downloaded
  try { mods = await loadThree(); models = await loadSoulModels(mods, quality, { variant: soulBodyVariant(opts && opts.config), hull: false }); } catch { return null; }
  if (!models || !host.isConnected) return null;
  // Decorations (v2 / v3): usually cached by the prefetch on the result screen; otherwise wait briefly, then open without them.
  const decorP = loadSoulDecor(mods, opts && opts.config);
  // D-58: a winner wears the big screen's gold crown (34 KB GLB, fetched only for winners; the same crown built from
  // primitives stands in if it is slow or fails)
  const crownP = opts && opts.badge ? loadWinnerCrown(mods) : Promise.resolve(null);
  const [decor, crown] = await Promise.all([
    Promise.race([decorP, new Promise((r) => setTimeout(() => r(null), DECOR_WAIT_MS))]),
    Promise.race([crownP, new Promise((r) => setTimeout(() => r(null), DECOR_WAIT_MS))]),
  ]);
  if (!host.isConnected) return null;
  try { return build(host, mods, models, quality, { ...opts, decor, decorLate: decor ? null : decorP, crown }); } catch { return null; }
}

function css(hexInt, alpha = 1) { return `rgba(${(hexInt >> 16) & 255},${(hexInt >> 8) & 255},${hexInt & 255},${alpha})`; }

function build(host, { THREE, addons }, models, quality, { config, badge = null, reduced = false, onFallback = null, decor = null, decorLate = null, crown: crownGlb = null } = {}) {
  const P = baselineParams(config, badge);
  const high = quality === 'high';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK);
  scene.fog = new THREE.Fog(INK, 6, 12);
  const C = BASELINE.camera; // the reveal camera; the Galaxy's card camera keeps its eye (soul3d/studio.js cardCamera)
  const camera = new THREE.PerspectiveCamera(C.fov, 1, 0.1, 30);
  camera.position.set(0, C.y, C.z);
  camera.lookAt(0, C.lookY, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatioFor(quality, devicePixelRatio || 1));
  renderer.setClearColor(INK, 1);
  applySoulToneMapping(THREE, renderer);
  host.appendChild(renderer.domElement);

  let composer = null, bloom = null;
  if (high) {
    // D-57: the composer draws into its own targets, which the canvas antialias flag does not reach: 4x MSAA there
    composer = new addons.EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new addons.RenderPass(scene, camera));
    bloom = new addons.UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.3, LOOK.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new addons.OutputPass());
  }

  // ---- light (identical for every Soul): studio reflections for the clay + the Blender colour-render rig (warm key
  // upper left, cool fill right, lavender rim behind) + the palette glow rising from the ring ----
  const envTarget = makeStudioEnvironment(THREE, renderer, { size: high ? 256 : 128 }); // D-57: sharper reflections
  scene.environment = envTarget.texture;
  addStudioLights(THREE, scene);
  addGlowLight(THREE, scene, P.colors.glow);

  // ---- the Soul (packages/ui/soul3d buildSoulRig): soul (bob / lift / peel) > turn (3/4 yaw + sway) > figure (feet at
  // 0, fitHeight tall, with the charms and face kit, and for v3 the plate, eyes and antenna charm), and the Bingo Star in
  // `soul` so it stays upright at the upper right while the Soul sways ----
  const glowTex = makeGlowTexture(THREE, css(0xffffff, 1), css(P.colors.glow, 0.85));
  // D-58: no white die-cut outline; a winner wears the crown (like the big screen) instead of the star medallion
  const rig = buildSoulRig(THREE, { body: models.body, hull: models.hull, config, badge: P.badge ? 'bingo-star' : null, decor, quality, glowTexture: glowTex, dieCut: false, winnerCrown: P.badge ? (crownGlb || true) : false });
  const soul = rig.soul;
  soul.position.y = REST_Y;
  scene.add(soul);
  const turn = rig.turn;
  const figure = rig.figure;
  const L = figure.landmarks, fit = figure.fit;
  const orbPos = rig.toFigure(L.orb.centre);
  const HEIGHT = BASELINE.fitHeight;
  const star = rig.crown ? null : rig.badge;   // hidden under a crown
  const crownGroup = rig.crown ? rig.crown.group : null;
  let disposed = false;
  if (decorLate) decorLate.then((d) => { if (!disposed && d) rig.setDecor(d); }); // joins at the current feature opacity

  // Glow: a soft back glow in the Soul's glow colour for every Soul (D-58: the dashed ring and the halo ring read as white
  // borders on the phone and were removed; the trait still colours the glow).
  const halo = new THREE.Group();
  soul.add(halo);
  const HALO_PEAK = 0.24;
  const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: P.colors.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  { const s = new THREE.Sprite(haloMat); s.position.set(0, HEIGHT * 0.5, -0.7); s.scale.setScalar(HEIGHT * 1.15); halo.add(s); }

  // ---- floor glow + reveal orb + motes (D-58: the thin floor ring is gone - it read as a white oval under the Soul) ----
  const discMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: P.colors.glow });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), discMat);
  disc.rotation.x = -Math.PI / 2; disc.position.y = -0.01;
  scene.add(disc);
  const orbMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
  const orb = new THREE.Sprite(orbMat);
  const CENTER_Y = REST_Y + HEIGHT * 0.5;
  orb.position.set(0, CENTER_Y, 0.2);
  orb.scale.setScalar(0.01);
  scene.add(orb);

  const MOTES = high ? 150 : 80;
  const base = new Float32Array(MOTES * 3), riseXZ = new Float32Array(MOTES * 2), riseY = new Float32Array(MOTES), speed = new Float32Array(MOTES);
  const positions = new Float32Array(MOTES * 3), sizes = new Float32Array(MOTES);
  let seed = 11;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < MOTES; i++) {
    const u = rnd() * Math.PI * 2, v = Math.acos(2 * rnd() - 1), rad = 1.7 + rnd() * 1.3;
    base[i * 3] = Math.sin(v) * Math.cos(u) * rad; base[i * 3 + 1] = CENTER_Y + Math.cos(v) * rad * 0.7; base[i * 3 + 2] = Math.sin(v) * Math.sin(u) * rad * 0.6;
    riseXZ[i * 2] = (rnd() - 0.5) * 2.6; riseXZ[i * 2 + 1] = (rnd() - 0.5) * 1.6;
    riseY[i] = rnd() * 2.6; speed[i] = 0.12 + rnd() * 0.16;
    sizes[i] = 1.4 + rnd() * 2.4;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  moteGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const moteMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixelRatio: { value: renderer.getPixelRatio() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(P.colors.glow) } },
    vertexShader: 'attribute float aSize; uniform float uPixelRatio; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uPixelRatio*(6.5/-mv.z); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.1,d); gl_FragColor=vec4(mix(uColor,vec3(1.),.35*a),a*a*uOpacity); }',
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  scene.add(motes);

  // ---- timeline ----
  let phase = 'dark';            // dark -> reveal -> idle -> float -> done
  let revealStart = 0, revealDur = 2000, floatStart = 0, floatDur = 600;
  let resolveReveal = null, resolveFloat = null;
  let elapsed = 0, last = performance.now(), raf = 0;
  let cancelProbe = () => {};
  let stateGather = 0, stateFeat = 0;

  function resize() {
    const rect = host.getBoundingClientRect();
    const w = Math.max(64, Math.round(rect.width)), hgt = Math.max(64, Math.round(rect.height));
    renderer.setSize(w, hgt, false);
    if (composer) composer.setSize(w, hgt);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function updateMotes(floatT) {
    const pos = moteGeo.attributes.position;
    for (let i = 0; i < MOTES; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const g = 1 - 0.88 * stateGather;
      const gx = bx * g, gy = CENTER_Y + (by - CENTER_Y) * g, gz = bz * g;
      const rise = reduced ? 0 : elapsed * speed[i] * (floatT > 0 ? 4 : 1);
      const ry = ((riseY[i] + rise) % 2.6) - 0.15;
      const rx = riseXZ[i * 2] * (floatT > 0 ? 0.35 : 1), rz = riseXZ[i * 2 + 1] * (floatT > 0 ? 0.35 : 1);
      const f = stateFeat;
      pos.setXYZ(i, gx + (rx - gx) * f, gy + (ry - gy) * f + (floatT > 0 ? floatT * floatT * 2.4 : 0), gz + (rz - gz) * f);
    }
    pos.needsUpdate = true;
  }

  /** Body + die-cut follow the silhouette stage; orb light, badge and halo style follow the features stage. */
  function setFigureOpacity(bodyO, featO) {
    figure.setOpacity(bodyO, featO * bodyO);
    if (star) star.setOpacity(featO);
    haloMat.opacity = HALO_PEAK * featO;
  }

  function applyReveal(t) {
    const glowP = easeEmphasized(stageProgress('glow', t));
    const silP = easeEmphasized(stageProgress('silhouette', t));
    const featRaw = stageProgress('features', t);
    const featP = easeEmphasized(featRaw);
    stateGather = glowP; stateFeat = featP;
    const orbScale = 0.15 + 2.3 * glowP - 1.1 * silP;
    orb.scale.setScalar(Math.max(0.01, orbScale));
    orbMat.opacity = glowP * (1 - 0.86 * silP); // the gathered light fades to a faint core once the sticker has formed
    moteMat.uniforms.uOpacity.value = 0.25 + 0.6 * glowP;
    // Sticker peel: the silhouette forms at 0.92 with a 6 deg tilt, then peels flat to 1.0 with one outline flash.
    const peel = stickerPeel(featRaw);
    soul.scale.setScalar(revealScale(silP, featRaw));
    soul.rotation.z = silP * peel.tilt;
    figure.setOutline(1 + BASELINE.flashBoost * peel.flash);
    setFigureOpacity(silP, featP);
    if (star) star.group.scale.setScalar(0.3 + 0.7 * featP);
    if (crownGroup) crownGroup.scale.setScalar(featP); // the crown settles on with the features
    discMat.opacity = 0.45 * featP;
    if (bloom) bloom.strength = 0.28 + 0.5 * glowP * (1 - silP) + 0.12 * peel.flash;
  }

  function render() { if (composer) composer.render(); else renderer.render(scene, camera); }
  // A phone that misses the frame budget steps down before the flat Soul takes over (D-57, D-58): 1) 1.25 x and no glow
  // pass, 2) 1 x and no multisampling; only a phone still too slow at the lightest step gets the SVG.
  const LIGHTER = ['reduced', 'minimal'];
  let lightStep = 0;
  function lighten() {
    const level = LIGHTER[lightStep++];
    const pr = pixelRatioFor(level, devicePixelRatio || 1);
    renderer.setPixelRatio(pr);
    if (composer) {
      composer.setPixelRatio(pr); if (bloom) bloom.enabled = false;
      if (level === 'minimal') for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples) { rt.samples = 0; rt.dispose(); }
    }
    resize(); render();
  }
  /** D-58: the speed check runs once the reveal is over (its shader warm-up and mote burst are not the steady cost). */
  function startProbe() {
    const onProbe = (exceeded, mean) => {
      if (!exceeded || disposed) return;
      if (lightStep < LIGHTER.length) { lighten(); cancelProbe = probeFrameTime(onProbe); return; }
      if (typeof onFallback === 'function') onFallback(mean);
    };
    cancelProbe = probeFrameTime(onProbe);
  }

  function setPhase(next) { phase = next; host.dataset.phase = next; }
  function tick(now) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now; elapsed += dt;
    let floatT = 0;
    if (phase === 'reveal') {
      const t = Math.min(1, (now - revealStart) / revealDur);
      applyReveal(t);
      if (t >= 1) { setPhase('idle'); if (resolveReveal) { const r = resolveReveal; resolveReveal = null; r(); } }
    } else if (phase === 'float') {
      floatT = Math.min(1, (now - floatStart) / floatDur);
      const e = easeExit(floatT);
      soul.position.y = REST_Y + 3.4 * e;
      const fade = floatT < 0.55 ? 1 : 1 - (floatT - 0.55) / 0.45;
      setFigureOpacity(fade, fade);
      discMat.opacity = 0.45 * (1 - floatT);
      moteMat.uniforms.uOpacity.value = 0.9 * (1 - floatT * 0.6);
      if (floatT >= 1) { setPhase('done'); if (resolveFloat) { const r = resolveFloat; resolveFloat = null; r(); } }
    }
    if (phase === 'idle' && !reduced) {
      const B = BASELINE.bob;
      soul.position.y = REST_Y + B.amplitude * Math.sin(elapsed * Math.PI * 2 * B.hz + P.bobPhase);
      turn.rotation.y = BASELINE.yaw + B.swayRad * Math.sin(elapsed * 0.45 + P.bobPhase);
      if (star) star.group.rotation.y = 0.45 * Math.sin(elapsed * 0.8); // gentle wobble, always facing the camera
    }
    if (phase !== 'dark') updateMotes(floatT);
    render();
    if (phase === 'done') return;
    if (reduced && phase === 'idle') return; // static frame under reduced motion
    if (!document.hidden) raf = requestAnimationFrame(tick);
  }
  function onVisibility() { if (!document.hidden && !raf && !disposed && phase !== 'done') { last = performance.now(); raf = requestAnimationFrame(tick); } }
  document.addEventListener('visibilitychange', onVisibility);

  host.dataset.threeReady = 'true';
  applyReveal(0);
  render();

  return {
    reveal({ durationMs = 2000 } = {}) {
      return new Promise((resolve) => {
        resolveReveal = () => { resolve(); if (!disposed) startProbe(); };
        revealDur = Math.max(1, durationMs); revealStart = performance.now(); setPhase('reveal');
        last = revealStart;
        if (!raf) raf = requestAnimationFrame(tick);
      });
    },
    skip() { if (phase === 'reveal') { revealStart = performance.now() - revealDur; if (!raf) raf = requestAnimationFrame(tick); } },
    float({ durationMs = 600 } = {}) {
      return new Promise((resolve) => {
        if (phase === 'done') { resolve(); return; }
        if (phase === 'reveal') { applyReveal(1); }
        resolveFloat = resolve;
        floatDur = Math.max(1, durationMs); floatStart = performance.now(); setPhase('float');
        last = floatStart;
        if (!raf) raf = requestAnimationFrame(tick);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelProbe();
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (resolveReveal) { resolveReveal(); resolveReveal = null; }
      if (resolveFloat) { resolveFloat(); resolveFloat = null; }
      rig.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      glowTex.dispose();
      envTarget.dispose();
      scene.environment = null;
      if (composer) composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.threeReady;
      delete host.dataset.phase;
    },
  };
}

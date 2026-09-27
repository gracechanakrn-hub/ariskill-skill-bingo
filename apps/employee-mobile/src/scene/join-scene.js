// apps/employee-mobile/src/scene/join-scene.js - ambient sticker mascot behind the Join form (E1). Loaded lazily by
// views/join.js only when the Join screen mounts; disposed on unmount. The mascot is the baseline Arise Soul character
// (D-27, docs/art/soul-baseline.md; the brand character, which supersedes the old "faceless mascot" rule) from the
// lite GLB in the lilac palette: glossy clay, lit antenna orb + additive glow, white die-cut hull. It is nobody's Soul
// and carries no name, rank or label. Around it: two rings and ~300 motes, bloom only on the 'high' tier. Motion is a
// gentle idle bob + sway (no spin), a small pulse on tap and a lagging camera on pointer move; one settled frame
// under reduced motion. When WebGL, the modules or the model are unavailable the CSS orb stays.
import { loadThree } from './loader.js';
import { detectQuality, pixelRatioFor } from './capability.js';
import { mascotPalette, outlineWidth, BASELINE } from './soul-params.js';
import { loadSoulModel, buildSoulFigure, makeGlowTexture, makeStudioEnvironment, applySoulToneMapping, addStudioLights, LOOK } from './soul-model.js';

const PARTICLE_COUNT = 300;
const MASCOT_HEIGHT = 3.1;       // scene units: fills the join orb like the old gumdrop did
const MASCOT_YAW = 0.42;         // 3/4 view with the face turned toward the hero copy on the right

function isReduced() {
  try {
    const attr = document.documentElement.dataset.reducedMotion;
    if (attr === 'true') return true;
    if (attr === 'false') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

/**
 * createJoinSoulScene(host) -> { dispose() }. Never throws: when WebGL / the modules / the model are unavailable the
 * CSS orb stays. The renderer is created after the modules and the lite model resolve; `dispose()` before that
 * simply cancels the mount.
 */
export function createJoinSoulScene(host) {
  let disposed = false;
  let live = null;
  if (!host) return { dispose() {} };
  const quality = detectQuality();
  if (quality === 'off') return { dispose() {} };
  loadThree()
    .then((mods) => loadSoulModel(mods, 'lite').then((model) => ({ mods, model })))
    .then(({ mods, model }) => { if (!disposed && host.isConnected) live = build(host, mods, model, quality); })
    .catch(() => { /* CSS orb remains */ });
  return { dispose() { disposed = true; if (live) { live.dispose(); live = null; } } };
}

function build(host, { THREE, addons }, model, quality) {
  const reduced = isReduced();
  const high = quality === 'high';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0, 0.25, 6.2);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: high, powerPreference: 'low-power' });
  renderer.setPixelRatio(pixelRatioFor(quality, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  applySoulToneMapping(THREE, renderer, 0.72); // a touch darker than the Soul stage: the pale lilac keeps its hue on the violet sky
  host.appendChild(renderer.domElement);

  let composer = null, bloom = null;
  if (high) {
    composer = new addons.EffectComposer(renderer);
    composer.addPass(new addons.RenderPass(scene, camera));
    bloom = new addons.UnrealBloomPass(new THREE.Vector2(256, 256), reduced ? 0.2 : 0.3, 0.25, LOOK.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new addons.OutputPass());
  }

  const envTarget = makeStudioEnvironment(THREE, renderer, { size: 64 });
  scene.environment = envTarget.texture;

  const rig = new THREE.Group();
  rig.rotation.set(-0.06, 0, -0.17); // cancels the .join-orb CSS rotate(-10deg) so the mascot stands upright
  scene.add(rig);

  // ---- the mascot: baseline Soul, lite LOD, lilac palette, centred on the orb ----
  const glowTex = makeGlowTexture(THREE, 'rgba(255,255,255,1)', 'rgba(208,188,255,0.85)', 96);
  const figure = buildSoulFigure(THREE, {
    body: model, hull: model, palette: mascotPalette(), quality, fitHeight: MASCOT_HEIGHT,
    outline: outlineWidth(quality), orbGlowStrength: BASELINE.orbGlow, glowTexture: glowTex,
  });
  const turn = new THREE.Group();
  turn.rotation.y = MASCOT_YAW;
  turn.add(figure.root);
  const baseY = -MASCOT_HEIGHT * 0.5;
  turn.position.y = baseY;
  rig.add(turn);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x4fe3c1, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.82, 0.018, 8, 96), ringMaterial);
  ring.rotation.set(1.12, 0.08, -0.32);
  rig.add(ring);
  const ringTwo = new THREE.Mesh(ring.geometry, ringMaterial.clone());
  ringTwo.material.color.setHex(0xb6ff5c);
  ringTwo.material.opacity = 0.34;
  ringTwo.scale.setScalar(0.83);
  ringTwo.rotation.set(0.46, 0.72, 0.35);
  rig.add(ringTwo);

  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 2.15 + Math.pow(rnd(), 1.8) * 2.8;
    const a = rnd() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.sin(a) * r * 0.64;
    positions[i * 3 + 2] = (rnd() - 0.5) * 3.5;
    sizes[i] = 1.6 + rnd() * 2.8;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const particleMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixelRatio: { value: renderer.getPixelRatio() }, uOpacity: { value: 0.78 } },
    vertexShader: 'attribute float aSize; uniform float uPixelRatio; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uPixelRatio*(7./-mv.z); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform float uOpacity; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.08,d); gl_FragColor=vec4(mix(vec3(.31,.89,.76),vec3(.71,1.,.36),gl_PointCoord.y),a*a*uOpacity); }',
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Light: the same studio rig as the Soul scene (warm key upper left, cool fill, lavender rim) + a teal accent
  // behind so the lilac clay reads against the violet sky.
  addStudioLights(THREE, scene);
  const accent = new THREE.PointLight(0x4fe3c1, 14, 11, 2); accent.position.set(-2.4, 1.2, -2.5); scene.add(accent);

  const pointer = new THREE.Vector2();
  const cameraDrift = new THREE.Vector2();
  let energy = 0, elapsed = 0, raf = 0, last = performance.now(), disposed = false;

  function onPointerMove(event) {
    const rect = host.getBoundingClientRect();
    pointer.x = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    pointer.y = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  }
  function onPointerLeave() { pointer.set(0, 0); }
  function onPointerDown() { if (!reduced) energy = 1; }
  function onVisibility() { if (!document.hidden && !raf && !disposed) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  host.addEventListener('pointermove', onPointerMove, { passive: true });
  host.addEventListener('pointerleave', onPointerLeave, { passive: true });
  host.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  function resize() {
    const rect = host.getBoundingClientRect();
    const size = Math.max(96, Math.round(Math.max(rect.width, rect.height) * 1.44));
    renderer.setSize(size, size, false);
    if (composer) composer.setSize(size, size);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function render() { if (composer) composer.render(); else renderer.render(scene, camera); }

  function tick(now) {
    raf = 0;
    if (disposed || document.hidden) return;
    const delta = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    elapsed += delta;
    const settle = 1 - Math.pow(0.002, delta);
    cameraDrift.x += (pointer.x * 0.42 - cameraDrift.x) * settle;
    cameraDrift.y += (pointer.y * 0.28 - cameraDrift.y) * settle;
    camera.position.x = reduced ? 0 : cameraDrift.x;
    camera.position.y = 0.25 - (reduced ? 0 : cameraDrift.y);
    camera.position.z += ((reduced ? 6.1 : 5.7) - camera.position.z) * (1 - Math.pow(0.04, delta));
    camera.lookAt(0, 0, 0);
    if (!reduced) {
      // gentle idle: bob (0.25 Hz) + slow sway around the 3/4 view; a tap adds a short pulse and a little extra sway
      turn.position.y = baseY + 0.05 * Math.sin(elapsed * Math.PI * 2 * 0.25);
      turn.rotation.y = MASCOT_YAW + 0.22 * Math.sin(elapsed * 0.5) + energy * 0.25 * Math.sin(elapsed * 9);
      rig.rotation.x = -0.06 + Math.sin(elapsed * 0.7) * 0.03;
      ring.rotation.z -= delta * 0.12;
      ringTwo.rotation.z += delta * 0.09;
      particles.rotation.z -= delta * 0.025;
      particles.rotation.y += delta * 0.04;
      energy = Math.max(0, energy - delta * 1.7);
      turn.scale.setScalar(1 + energy * 0.06);
      if (bloom) bloom.strength = 0.35 + energy * 0.3;
    }
    render();
    // Reduced motion: one settled frame is enough (no ambient loop).
    if (reduced && elapsed > 1.2) return;
    raf = requestAnimationFrame(tick);
  }

  host.dataset.threeReady = 'true';
  raf = requestAnimationFrame(tick);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointerdown', onPointerDown);
      figure.dispose();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
      });
      glowTex.dispose();
      envTarget.dispose();
      scene.environment = null;
      if (composer) composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.threeReady;
    },
  };
}

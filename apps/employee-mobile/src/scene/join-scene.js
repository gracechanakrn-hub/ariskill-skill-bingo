// apps/employee-mobile/src/scene/join-scene.js - ambient sticker Soul behind the Join form (E1). Loaded lazily by
// views/join.js only when the Join screen mounts; disposed on unmount. Low cost: one lathe gumdrop in glossy clay
// (sticker art direction: clearcoat, peach sheen, seeded speckles, lit antenna orb, white die-cut hull), one fresnel
// aura, two rings, ~300 points, bloom only on the 'high' tier. The figure is the generic Arise mascot (lilac base, no
// face): it is nobody's Soul and carries no rank or label. Static (no rotation / drift) under reduced motion.
import { loadThree } from './loader.js';
import { detectQuality, pixelRatioFor } from './capability.js';
import { latheProfile, radiusAt, HEM_Y, HEAD_CENTER_Y, UNIT, speckleLayout, speckleCount, outlineScale } from './soul-params.js';

const PARTICLE_COUNT = 300;
const LILAC = 0x8b7cf0, PEACH = 0xffb27a, MINT = 0x7cf5c8, OUTLINE = 0xf2f2f6;
const JOIN_SEED = 'arise-join-orb';

function isReduced() {
  try {
    const attr = document.documentElement.dataset.reducedMotion;
    if (attr === 'true') return true;
    if (attr === 'false') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

/**
 * createJoinSoulScene(host) -> { dispose() }. Never throws: when WebGL / the modules are unavailable the CSS orb stays.
 * The renderer is created after the modules resolve; `dispose()` before that simply cancels the mount.
 */
export function createJoinSoulScene(host) {
  let disposed = false;
  let live = null;
  if (!host) return { dispose() {} };
  const quality = detectQuality();
  if (quality === 'off') return { dispose() {} };
  loadThree().then((mods) => { if (!disposed && host.isConnected) live = build(host, mods, quality); }).catch(() => { /* CSS orb remains */ });
  return { dispose() { disposed = true; if (live) { live.dispose(); live = null; } } };
}

function makeGlowTexture(THREE, size = 96) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,235,210,0.8)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function build(host, { THREE, addons }, quality) {
  const reduced = isReduced();
  const high = quality === 'high';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0, 0.25, 6.2);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: high, powerPreference: 'low-power' });
  renderer.setPixelRatio(pixelRatioFor(quality, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);

  let composer = null, bloom = null;
  if (high) {
    composer = new addons.EffectComposer(renderer);
    composer.addPass(new addons.RenderPass(scene, camera));
    bloom = new addons.UnrealBloomPass(new THREE.Vector2(256, 256), reduced ? 0.2 : 0.4, 0.2, 0.9);
    composer.addPass(bloom);
    composer.addPass(new addons.OutputPass());
  }

  const rig = new THREE.Group();
  rig.rotation.set(-0.08, -0.35, -0.06);
  scene.add(rig);

  // ---- sticker gumdrop: 'drop' lathe silhouette in glossy lilac clay, scaled to the old orb's footprint ----
  const profile = latheProfile('drop');
  const height = profile.reduce((m, p) => Math.max(m, p.y), 0);
  const FIG = 1.7;
  const figure = new THREE.Group();
  figure.scale.setScalar(FIG);
  figure.position.y = -height * FIG * 0.5;
  rig.add(figure);
  const lathe = new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p.r, p.y)), high ? 56 : 36);
  const clay = new THREE.MeshPhysicalMaterial({
    color: LILAC, emissive: LILAC, emissiveIntensity: 0.22, roughness: 0.35, metalness: 0,
    clearcoat: high ? 1 : 0, clearcoatRoughness: 0.15, sheen: 0.6, sheenColor: new THREE.Color(PEACH), sheenRoughness: 0.55,
  });
  const body = new THREE.Mesh(lathe, clay);
  figure.add(body);
  // die-cut hull (white back faces) scaled about mid-height
  const OS = outlineScale(quality);
  const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, toneMapped: false });
  const hull = new THREE.Mesh(lathe, outlineMat);
  hull.scale.setScalar(OS); hull.position.y = (1 - OS) * height / 2; hull.renderOrder = -1;
  figure.add(hull);
  // seeded speckles (mint / cyan / lilac), face band kept clear like the Souls even though this mascot has no face
  const headY = (HEM_Y - HEAD_CENTER_Y) * UNIT, headR = radiusAt(profile, headY);
  const speckleGeo = new THREE.SphereGeometry(1, high ? 14 : 10, high ? 10 : 8);
  const mats = new Map();
  for (const sp of speckleLayout(JOIN_SEED, profile, speckleCount(quality), { headY, headR })) {
    if (!mats.has(sp.color)) mats.set(sp.color, new THREE.MeshStandardMaterial({ color: sp.color, emissive: sp.color, emissiveIntensity: 0.3, roughness: 0.45 }));
    const m = new THREE.Mesh(speckleGeo, mats.get(sp.color));
    m.position.set(sp.r * Math.cos(sp.theta) * 0.985, sp.y, sp.r * Math.sin(sp.theta) * 0.985);
    m.lookAt(0, sp.y, 0);
    m.scale.set(sp.size, sp.size, sp.size * 0.55);
    figure.add(m);
  }
  // antenna: stalk + lit orb + additive glow sprite
  const stalkLen = 0.16, orbR = 0.075;
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, stalkLen, 10), clay);
  stalk.position.set(0, height + stalkLen / 2 - 0.02, 0);
  figure.add(stalk);
  const stalkHull = new THREE.Mesh(stalk.geometry, outlineMat);
  stalkHull.position.copy(stalk.position); stalkHull.scale.set(OS * 2.6, 1.02, OS * 2.6); stalkHull.renderOrder = -1;
  figure.add(stalkHull);
  const orbMat = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffe9c2, emissiveIntensity: 1.6, roughness: 0.3 });
  const orbGeo = new THREE.SphereGeometry(orbR, 18, 14);
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.set(0, height + stalkLen + orbR * 0.6, 0);
  figure.add(orb);
  const orbHull = new THREE.Mesh(orbGeo, outlineMat);
  orbHull.position.copy(orb.position); orbHull.scale.setScalar(OS * 1.12); orbHull.renderOrder = -1;
  figure.add(orbHull);
  const glowTex = makeGlowTexture(THREE);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe9c2, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.copy(orb.position); glow.scale.setScalar(orbR * 7);
  figure.add(glow);

  const auraMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(PEACH).lerp(new THREE.Color(MINT), 0.4) }, uPower: { value: 2.8 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 w=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uPower; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.-max(dot(normalize(vN),normalize(vV)),0.),uPower); gl_FragColor=vec4(uColor*f,f*.55); }',
  });
  const aura = new THREE.Mesh(lathe, auraMaterial);
  aura.scale.setScalar(1.03);
  figure.add(aura);

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

  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1259, 0.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
  keyLight.position.set(-2.5, 4.5, 3);
  scene.add(keyLight);
  const warm = new THREE.PointLight(PEACH, 8, 10, 2);
  warm.position.set(2.6, -0.6, 2.4);
  scene.add(warm);
  const accent = new THREE.PointLight(0x4fe3c1, 8, 11, 2);
  accent.position.set(-2.4, 1.2, -2.5);
  scene.add(accent);

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
      rig.rotation.y += delta * (0.16 + energy * 0.8);
      rig.rotation.x = -0.08 + Math.sin(elapsed * 0.7) * 0.035;
      figure.position.y = -height * FIG * 0.5 + 0.05 * Math.sin(elapsed * Math.PI * 2 * 0.25);
      particles.rotation.z -= delta * 0.025;
      particles.rotation.y += delta * 0.04;
      energy = Math.max(0, energy - delta * 1.7);
      const pulse = FIG * (1 + energy * 0.075);
      figure.scale.setScalar(pulse);
      if (bloom) bloom.strength = 0.4 + energy * 0.3;
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
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      glowTex.dispose();
      if (composer) composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.threeReady;
    },
  };
}

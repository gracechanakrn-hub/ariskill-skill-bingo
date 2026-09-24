// apps/employee-mobile/src/scene/soul-scene.js - the Soul reveal / Float hero scene (E8 -> E10) in vendored Three.js.
// Darkness -> a glowing orb forms in the centre (sprite + gathering motes) -> light gathers -> the Soul resolves as a
// 3D clay sticker built procedurally from its SoulConfig (lathe silhouette, palette base colour, glossy clearcoat +
// peach sheen, seeded speckles, warm fresnel rim, face decal rendered from the shared SVG renderer, antenna with an
// emissive orb + additive glow, feet / badge meshes) above a glowing ring with a slow bob. A white inverted-hull
// outline (back faces, unlit, ~1.06) makes the figure read as a die-cut sticker, and the last reveal stage is the
// sticker "peel" (scale 0.92 -> 1, 6 deg tilt, one 250 ms outline flash). Float lifts the Soul upward with a mote
// trail and fades. Timed by tokens/motion.json soulReveal / float (callers pass the durations); skip jumps to the
// end. Static (no bob, no drift) under reduced motion. All Souls share size and brightness (BR-17): nothing here
// reads Platform, Role or winner state (the badge is the only extra, as in the SVG). Low tier: no clearcoat, no
// bloom, fewer speckles. Art direction: docs/art/sticker-art-direction.md.
import { loadThree } from './loader.js';
import { detectQuality, pixelRatioFor, probeFrameTime } from './capability.js';
import { soulMeshParams, ANTENNA, stageProgress, easeEmphasized, easeExit, speckleLayout, speckleCount, outlineScale, stickerPeel, revealScale, PEEL } from './soul-params.js';
import { renderSoulSvg } from '/packages/ui/soul-renderer.js';

const INK = 0x0a0622;
const PEACH = 0xffb27a;      // --sticker-peach: sheen + warm rim
const OUTLINE = 0xf2f2f6;    // --sticker-outline (a hair under 1.0 so the hull itself never trips the bloom threshold)

/**
 * createSoulScene(host, { config, badge, reduced, onFallback }) -> Promise<controller | null>
 * controller: { reveal({ durationMs }) -> Promise, skip(), float({ durationMs }) -> Promise, dispose() }
 * Resolves null when the tier is 'off' or the modules fail to load (caller keeps the SVG + CSS path).
 */
export async function createSoulScene(host, opts) {
  if (!host) return null;
  const quality = detectQuality();
  if (quality === 'off') return null;
  let mods;
  try { mods = await loadThree(); } catch { return null; }
  if (!host.isConnected) return null;
  try { return build(host, mods, quality, opts); } catch { return null; }
}

function makeRadialTexture(THREE, inner, mid, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner); grad.addColorStop(0.28, mid); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function css(hexInt, alpha = 1) { return `rgba(${(hexInt >> 16) & 255},${(hexInt >> 8) & 255},${hexInt & 255},${alpha})`; }

/**
 * Face decal: the shared renderer's 'simple' Soul with body / glow / feet / heart / antenna removed (by layout bbox),
 * cropped to the head bulb, rasterised to a CanvasTexture. Async; the material is updated when the image decodes.
 */
function loadFaceTexture(THREE, config, params, onReady) {
  let url = null;
  try {
    const doc = new DOMParser().parseFromString(renderSoulSvg(config, { size: 200, badge: null, detail: 'simple', idPrefix: `face-${params.seed.replace(/[^A-Za-z0-9_-]/g, '')}` }), 'image/svg+xml');
    const svg = document.adoptNode(doc.documentElement);
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:200px;height:200px;visibility:hidden;pointer-events:none';
    holder.appendChild(svg);
    document.body.appendChild(holder);
    for (const el of Array.from(svg.children)) {
      if (el.tagName === 'defs') continue;
      let b;
      try { b = el.getBBox(); } catch { continue; }
      if (b.height > 60 || b.y > 118 || b.y + b.height < 58) el.remove();
    }
    const { x, y, size } = params.faceCrop;
    svg.setAttribute('viewBox', `${x} ${y} ${size} ${size}`);
    svg.setAttribute('width', '512'); svg.setAttribute('height', '512');
    const xml = new XMLSerializer().serializeToString(svg);
    holder.remove();
    url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 512;
      c.getContext('2d').drawImage(img, 0, 0, 512, 512);
      URL.revokeObjectURL(url);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      onReady(tex);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  } catch { if (url) URL.revokeObjectURL(url); }
}

function starShape(THREE, outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

function build(host, { THREE, addons }, quality, { config, badge = null, reduced = false, onFallback = null } = {}) {
  const P = soulMeshParams(config, badge);
  const high = quality === 'high';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK);
  scene.fog = new THREE.Fog(INK, 6, 12);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  camera.position.set(0, 1.05, 4.9);
  camera.lookAt(0, 0.98, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatioFor(quality, devicePixelRatio || 1));
  renderer.setClearColor(INK, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  host.appendChild(renderer.domElement);

  let composer = null, bloom = null;
  if (high) {
    composer = new addons.EffectComposer(renderer);
    composer.addPass(new addons.RenderPass(scene, camera));
    bloom = new addons.UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.25, 0.92);
    composer.addPass(bloom);
    composer.addPass(new addons.OutputPass());
  }

  // ---- lights (identical for every Soul): soft sky fill, big top-left key (the sticker's soft top highlight),
  // a warm peach rim from the lower right and the palette glow from below ----
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1259, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(-2.2, 4.2, 3); scene.add(key);
  const fill = new THREE.PointLight(P.colors.glow, 1.5, 5, 2); fill.position.set(0, -0.5, 1.4); scene.add(fill);
  const warm = new THREE.PointLight(PEACH, 3, 6, 2); warm.position.set(2.2, 1.0, 1.6); scene.add(warm);
  const back = new THREE.PointLight(0xf04adf, 3, 6, 2); back.position.set(1.6, 2.2, -2); scene.add(back);

  // ---- Soul body: lathe from the profile, sheared by lean, jelly bumps for bumpy silhouettes ----
  const soul = new THREE.Group();
  const REST_Y = 0.24;
  soul.position.y = REST_Y;
  scene.add(soul);
  const lathe = new THREE.LatheGeometry(P.profile.map((p) => new THREE.Vector2(p.r, p.y)), high ? 56 : 36);
  const bumpAt = (x, y, z) => 1 + P.bump * Math.sin(Math.atan2(z, x) * 4) * Math.sin(y * 7);
  {
    const pos = lathe.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = bumpAt(x, y, z);
      pos.setXYZ(i, x * f + P.lean * y, y, z * f);
    }
    lathe.computeVertexNormals();
  }
  // Glossy clay (sticker spec): palette base, clearcoat 1 / 0.15, roughness 0.35, peach sheen 0.6. Low tier: no clearcoat.
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: P.colors.fill, emissive: P.colors.fill, emissiveIntensity: 0.05, roughness: 0.35, metalness: 0,
    clearcoat: high ? 1 : 0, clearcoatRoughness: 0.15, sheen: 0.6, sheenColor: new THREE.Color(PEACH), sheenRoughness: 0.55,
    transparent: true, opacity: 0,
  });
  const body = new THREE.Mesh(lathe, bodyMat);
  soul.add(body);

  // Die-cut: white inverted hull (back faces, unlit) scaled about the body's mid-height. Drawn first so the body
  // depth-tests over it and only the rim beyond the silhouette shows.
  const OUTLINE_S = outlineScale(quality);
  const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, transparent: true, opacity: 0, fog: false, toneMapped: false });
  const hulls = [];
  const addHull = (geo, parent, { center = null, position = null, rotation = null, extra = null, shape = null } = {}) => {
    const m = new THREE.Mesh(geo, outlineMat);
    m.renderOrder = -1;
    m.userData.hull = { center: center ? center.clone() : null, base: position ? position.clone() : new THREE.Vector3(), extraScale: extra, shape: shape ? shape.clone() : new THREE.Vector3(1, 1, 1) };
    if (rotation) m.rotation.copy(rotation);
    parent.add(m);
    hulls.push(m);
    return m;
  };
  const midY = P.height / 2;
  addHull(lathe, soul, { center: new THREE.Vector3(P.lean * midY, midY, 0) });
  function applyHulls(flash) {
    const s = OUTLINE_S * (1 + PEEL.flashScaleBoost * flash);
    for (const m of hulls) {
      const h = m.userData.hull;
      const k = h.extraScale ? s * h.extraScale : s;
      if (h.extraScale && h.extraScale > 1.2) m.scale.set(k, 1 + (k - 1) * 0.25, k); // thin stalk: widen the radius, barely the length
      else m.scale.copy(h.shape).multiplyScalar(k);
      if (h.center) m.position.copy(h.center).multiplyScalar(1 - k).add(h.base); else m.position.copy(h.base);
    }
  }

  // Warm fresnel rim (peach) - the sticker's warm rim light.
  const rimMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(PEACH).lerp(new THREE.Color(P.colors.glow), 0.35) }, uPower: { value: 3.0 }, uOpacity: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 w=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uPower; uniform float uOpacity; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.-max(dot(normalize(vN),normalize(vV)),0.),uPower); gl_FragColor=vec4(uColor*f,f*uOpacity); }',
  });
  const rim = new THREE.Mesh(lathe, rimMat);
  rim.scale.setScalar(1.02);
  rim.renderOrder = 1;
  soul.add(rim);

  // Seeded speckles (<= 14 small flattened spheres from the same seed; the low tier draws fewer). Emissive-lit so
  // they read as the sticker's bubble speckles in mint / cyan / lilac, never as rank or status.
  const speckles = speckleLayout(P.seed, P.profile, speckleCount(quality), { headY: P.headY, headR: P.headR });
  const speckleMats = new Map();
  const speckleGeo = new THREE.SphereGeometry(1, high ? 14 : 10, high ? 10 : 8);
  const speckleGroup = new THREE.Group();
  soul.add(speckleGroup);
  for (const sp of speckles) {
    if (!speckleMats.has(sp.color)) speckleMats.set(sp.color, new THREE.MeshStandardMaterial({ color: sp.color, emissive: sp.color, emissiveIntensity: 0.5, roughness: 0.45, metalness: 0, transparent: true, opacity: 0 }));
    const m = new THREE.Mesh(speckleGeo, speckleMats.get(sp.color));
    const x0 = sp.r * Math.cos(sp.theta), z0 = sp.r * Math.sin(sp.theta);
    const f = bumpAt(x0, sp.y, z0) * 0.985;
    m.position.set(x0 * f + P.lean * sp.y, sp.y, z0 * f);
    m.lookAt(P.lean * sp.y, sp.y, 0);
    m.scale.set(sp.size, sp.size, sp.size * 0.55);
    m.renderOrder = 1;
    speckleGroup.add(m);
  }

  // Face decal on a curved patch hugging the head bulb (texture arrives async from the SVG renderer).
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const phiLen = 2.2, thetaLen = 1.9;
  const face = new THREE.Mesh(new THREE.SphereGeometry(P.headR * 0.985, 32, 24, Math.PI / 2 - phiLen / 2, phiLen, Math.PI / 2 - thetaLen / 2, thetaLen), faceMat);
  face.position.set(P.lean * P.headY, P.headY, 0);
  face.renderOrder = 2;
  face.visible = false;
  soul.add(face);
  loadFaceTexture(THREE, config, P, (tex) => { if (disposed) { tex.dispose(); return; } faceMat.map = tex; faceMat.needsUpdate = true; face.visible = true; });

  // Feet, antenna and badge (small meshes; features fade/scale in during the last reveal stage), each with a hull.
  const features = new THREE.Group();
  soul.add(features);
  const partMat = new THREE.MeshPhysicalMaterial({ color: P.colors.fill, emissive: P.colors.fill, emissiveIntensity: 0.05, roughness: 0.35, clearcoat: high ? 1 : 0, clearcoatRoughness: 0.15, sheen: 0.6, sheenColor: new THREE.Color(PEACH), transparent: true, opacity: 0 });
  // Antenna orb: lit from inside (emissive highlight) + an additive sprite glow; bloom (high tier) catches it.
  const tipMat = new THREE.MeshStandardMaterial({ color: P.colors.highlight, emissive: P.colors.highlight, emissiveIntensity: 1.6, roughness: 0.3, transparent: true, opacity: 0 });
  const footGeo = new THREE.SphereGeometry(0.12, 18, 12);
  for (const sx of [-0.2, 0.2]) {
    const pos = new THREE.Vector3(sx + P.lean * 0.02, 0.02, 0.05);
    const foot = new THREE.Mesh(footGeo, partMat); foot.scale.set(1, 0.6, 0.9); foot.position.copy(pos); features.add(foot);
    addHull(footGeo, features, { position: pos, shape: new THREE.Vector3(1, 0.6, 0.9) });
  }
  const glowTex = makeRadialTexture(THREE, css(0xffffff, 1), css(P.colors.glow, 0.85));
  let tipGlow = null;
  const ant = ANTENNA[P.antenna];
  if (ant) {
    const stalkGeo = new THREE.CylinderGeometry(0.018, 0.026, ant.stalk, 10);
    const stalkPos = new THREE.Vector3(P.lean * P.topY, P.topY + ant.stalk / 2 - 0.02, 0);
    const stalk = new THREE.Mesh(stalkGeo, partMat);
    stalk.position.copy(stalkPos);
    features.add(stalk);
    addHull(stalkGeo, features, { position: stalkPos, extra: 2.6 }); // thin part: widen the hull radius only
    const tipY = P.topY + ant.stalk;
    const tipX = P.lean * P.topY;
    const addTip = (geo, dx = 0) => {
      const pos = new THREE.Vector3(tipX + dx, tipY + ant.size * 0.6, 0);
      const m = new THREE.Mesh(geo, tipMat); m.position.copy(pos); features.add(m);
      addHull(geo, features, { position: pos, extra: 1.12 });
      return m;
    };
    if (ant.tip === 'sphere') addTip(new THREE.SphereGeometry(ant.size, 18, 14));
    else if (ant.tip === 'torus') addTip(new THREE.TorusGeometry(ant.size, ant.size * 0.28, 10, 32));
    else if (ant.tip === 'leaf') { const leaf = addTip(new THREE.SphereGeometry(ant.size, 16, 12)); leaf.scale.set(0.55, 1.1, 0.25); leaf.rotation.z = 0.35; }
    else if (ant.tip === 'spark') addTip(new THREE.OctahedronGeometry(ant.size, 0));
    else if (ant.tip === 'twin') { addTip(new THREE.SphereGeometry(ant.size, 14, 10), -0.09); addTip(new THREE.SphereGeometry(ant.size, 14, 10), 0.09); }
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: P.colors.highlight, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    tipGlow = new THREE.Sprite(glowMat);
    tipGlow.position.set(tipX, tipY + ant.size * 0.6, 0.02);
    tipGlow.scale.setScalar(ant.size * 7);
    features.add(tipGlow);
  }
  let star = null;
  if (P.badge) {
    const starMat = new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xf5c84b, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0 });
    const starGeo = new THREE.ExtrudeGeometry(starShape(THREE, 0.15, 0.065), { depth: 0.045, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
    const starPos = new THREE.Vector3(P.headR + 0.2 + P.lean * P.headY, P.headY + 0.34, 0.1);
    star = new THREE.Mesh(starGeo, starMat);
    star.position.copy(starPos);
    features.add(star);
    addHull(starGeo, features, { position: starPos, extra: 1.14 });
  }
  applyHulls(0);

  // ---- ring + orb + motes ----
  const ringMat = new THREE.MeshBasicMaterial({ color: P.colors.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.014, 8, 96), ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  const discMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: P.colors.glow });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), discMat);
  disc.rotation.x = -Math.PI / 2; disc.position.y = -0.01;
  scene.add(disc);
  const orbMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
  const orb = new THREE.Sprite(orbMat);
  const CENTER_Y = REST_Y + P.height * 0.55;
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
  let elapsed = 0, last = performance.now(), raf = 0, disposed = false;
  let cancelProbe = () => {};
  let stateGather = 0, stateFeat = 0, stateSil = 0;

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

  function updateMotes(dt, floatT) {
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

  function setFigureOpacity(bodyO, featO) {
    bodyMat.opacity = bodyO;
    outlineMat.opacity = bodyO;
    rimMat.uniforms.uOpacity.value = 0.5 * bodyO;
    for (const m of speckleMats.values()) m.opacity = bodyO;
    faceMat.opacity = featO;
    partMat.opacity = featO; tipMat.opacity = featO;
    if (tipGlow) tipGlow.material.opacity = 0.85 * featO;
    if (star) star.material.opacity = featO;
  }

  function applyReveal(t) {
    const glowP = easeEmphasized(stageProgress('glow', t));
    const silP = easeEmphasized(stageProgress('silhouette', t));
    const featRaw = stageProgress('features', t);
    const featP = easeEmphasized(featRaw);
    stateGather = glowP; stateSil = silP; stateFeat = featP;
    const orbScale = 0.15 + 2.3 * glowP - 1.1 * silP;
    orb.scale.setScalar(Math.max(0.01, orbScale));
    orbMat.opacity = glowP * (1 - 0.86 * silP); // the gathered light fades to a faint core once the sticker has formed
    moteMat.uniforms.uOpacity.value = 0.25 + 0.6 * glowP;
    // Sticker peel: the silhouette forms at 0.92 with a 6 deg tilt, then peels flat to 1.0 with one outline flash.
    const peel = stickerPeel(featRaw);
    soul.scale.setScalar(revealScale(silP, featRaw));
    soul.rotation.z = silP * peel.tilt;
    applyHulls(peel.flash);
    setFigureOpacity(silP, featP);
    if (star) star.scale.setScalar(0.3 + 0.7 * featP);
    ringMat.opacity = 0.75 * featP;
    discMat.opacity = 0.45 * featP;
    if (bloom) bloom.strength = 0.35 + 0.45 * glowP * (1 - 0.5 * silP) + 0.12 * peel.flash;
  }

  function render() { if (composer) composer.render(); else renderer.render(scene, camera); }

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
      ringMat.opacity = 0.75 * (1 - floatT); discMat.opacity = 0.45 * (1 - floatT);
      moteMat.uniforms.uOpacity.value = 0.9 * (1 - floatT * 0.6);
      if (floatT >= 1) { setPhase('done'); if (resolveFloat) { const r = resolveFloat; resolveFloat = null; r(); } }
    }
    if (phase === 'idle' && !reduced) {
      soul.position.y = REST_Y + 0.045 * Math.sin(elapsed * Math.PI * 2 * 0.28 + P.bobPhase);
      soul.rotation.y = 0.14 * Math.sin(elapsed * 0.45 + P.bobPhase);
      ringMat.opacity = 0.65 + 0.1 * Math.sin(elapsed * 1.2);
      if (star) star.rotation.y = 0.45 * Math.sin(elapsed * 0.8); // gentle wobble, always facing the camera
    }
    if (phase !== 'dark') updateMotes(dt, floatT);
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
        resolveReveal = resolve;
        revealDur = Math.max(1, durationMs); revealStart = performance.now(); setPhase('reveal');
        last = revealStart;
        if (!raf) raf = requestAnimationFrame(tick);
        cancelProbe = probeFrameTime((exceeded, mean) => { if (exceeded && typeof onFallback === 'function' && !disposed) onFallback(mean); });
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
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      glowTex.dispose();
      if (composer) composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.threeReady;
      delete host.dataset.phase;
    },
  };
}

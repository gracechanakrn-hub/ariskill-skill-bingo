// packages/ui/soul3d/studio.js - the one studio look of every 3D Soul (D-27, D-29 "Rendering: one Soul everywhere"):
// tone mapping, the Blender colour-render light rig, the procedural studio reflections, the framing constants of the
// phone reveal (SOUL_VIEW) and the square "card" camera the public Galaxy renders its Float entrance and its impostors
// with. The phone scene and the Galaxy both build their Souls from here, so a Soul looks the same on both screens.
// Needs Three.js objects (passed in); makeGlowTexture needs a DOM canvas, the rest is node-testable.
import { BOUNDS, MAPPING } from '../soul-baseline-shape.js';

export const PEACH = 0xffb27a;      // --sticker-peach: clay sheen
export const OUTLINE = 0xf2f2f6;    // --sticker-outline
/**
 * Look of the Blender colour renders (docs/art/soul-baseline.md): AgX view transform with the light energy of that
 * rig (area lights of ~900 / 260 / 700 W at ~5 m give the clay ~3x its albedo in radiance). `outlineLevel` is the
 * die-cut's linear level (reads as white through AgX); the bloom threshold sits above it so only the lit orb and
 * the clearcoat glints glow.
 */
export const LOOK = Object.freeze({ toneMapping: 'agx', exposure: 0.95, key: 5.5, fill: 1.6, rim: 4.5, hemi: 0.45, envBoxes: 3.5, outlineLevel: 2.8, bloomThreshold: 4 });

/**
 * Framing and motion of the Soul reveal (identical for every Soul, BR-17). The camera is the phone reveal's: a 32 deg
 * lens 4.9 units in front of a Soul that rests with its feet at `restY` and stands `fitHeight` tall.
 */
export const SOUL_VIEW = Object.freeze({
  fitHeight: 1.86,          // scene units the 2.29-unit model is scaled to: the old Souls' framing incl. the antenna
  yaw: -0.49,               // 3/4 view like the reference renders (camera azimuth 28 deg: face turned to the viewer's left)
  outline: Object.freeze({ high: 0.03, low: 0.028 }),   // die-cut width in model units (~1.03 of the half-width)
  flashBoost: 0.7,          // the one peel flash widens the die-cut by up to 70 % (250 ms half-sine, flash-safe)
  orbGlow: 4,               // orb emissive = glow x mask A x this (Blender: 2.2 under its brighter rig; see LOOK)
  badgeSize: 0.2,           // Bingo Star outer radius in model units
  badgeForward: 0.3,        // the star floats this far in front of badge_anchor so it never cuts into the head
  bob: Object.freeze({ amplitude: 0.045, hz: 0.28, swayRad: 0.14 }),
  camera: Object.freeze({ fov: 32, y: 1.08, z: 4.9, lookY: 1.02 }),
  restY: 0.24,              // the Soul's feet above the reveal floor ring
  glowLight: Object.freeze({ intensity: 4, distance: 5, decay: 2, y: -0.3, z: 1.3 }), // the ring's glow, rising from below
});

export function outlineWidth(quality) { return SOUL_VIEW.outline[quality] ?? SOUL_VIEW.outline.low; }

/** Share of a square card the figure (feet .. orb) fills: the flat Soul's figure in its 200 viewBox, so 2D and 3D Souls match in size (BR-17). */
export const CARD_FILL = (BOUNDS.y1 - BOUNDS.y0) / 200;

/**
 * The square card camera: the phone camera's eye (same distance and pitch, so the same perspective) narrowed to frame the
 * resting figure, feet at y = 0, at CARD_FILL of the height and centred like the flat Soul. Pure numbers:
 * { fov (deg), eye: [x, y, z], target: [x, y, z] }.
 */
export function cardCamera({ fitHeight = SOUL_VIEW.fitHeight, fill = CARD_FILL } = {}) {
  const c = SOUL_VIEW.camera;
  const centre = fitHeight / 2;
  const pitch = c.y - c.lookY;                               // the phone camera looks 0.06 units down over 4.9
  const fov = (2 * Math.atan((fitHeight / fill) / 2 / c.z) * 180) / Math.PI;
  return { fov, eye: [0, centre + pitch, c.z], target: [0, centre, 0] };
}

/** Radial glow sprite texture (white core -> tint -> transparent). Needs a DOM canvas. */
export function makeGlowTexture(THREE, inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.6)', size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner); grad.addColorStop(0.28, mid); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural studio environment for the clay reflections: a dark navy room with three soft boxes placed like the
 * Blender colour-render rig (warm key upper left front, cool fill right, lavender rim behind right) and a faint
 * floor bounce. Returns the PMREM render target (use .texture; dispose() with the scene).
 */
export function makeStudioEnvironment(THREE, renderer, { size = 128 } = {}) {
  const env = new THREE.Scene();
  const disposables = [];
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); env.add(m); disposables.push(geo, mat); return m; };
  add(new THREE.SphereGeometry(20, 24, 12), new THREE.MeshBasicMaterial({ color: 0x141a3c, side: THREE.BackSide }));
  const box = (hex, intensity, pos, w, h) => {
    const mat = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const m = add(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 1.1, 0);
  };
  const k = LOOK.envBoxes;
  box(0xfff4e8, 7.0 * k, [-2.6, 4.0, 3.4], 3.0, 2.4);   // key
  box(0xc9d6ff, 2.2 * k, [3.6, 1.8, 2.8], 2.4, 3.2);    // fill
  box(0xe6ddff, 5.0 * k, [1.4, 3.6, -3.6], 2.0, 1.6);   // rim
  box(0xffb27a, 0.6 * k, [0, -2.5, 1.5], 5.0, 2.0);     // warm floor bounce (peach, low)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02, 0.1, 60, { size });
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return target;
}

/**
 * Shared renderer look for the Soul scenes: AgX (LOOK.toneMapping) keeps the colour-render look; Khronos PBR Neutral
 * is the alternative that keeps the white drips / eye discs / die-cut reading as white on a dark sky.
 */
export function applySoulToneMapping(THREE, renderer, exposure = LOOK.exposure) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = LOOK.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = exposure;
}

/**
 * The studio light rig of the Blender colour renders (identical for every Soul): warm key upper left front, cool fill
 * right, lavender rim behind right, a low sky/ground fill. Intensities are three.js physical units (a directional
 * light of ~pi gives a white surface facing it its full albedo). Returns the lights (already added to `scene`).
 */
export function addStudioLights(THREE, scene, { key = LOOK.key, fill = LOOK.fill, rim = LOOK.rim, hemi = LOOK.hemi } = {}) {
  const lights = [
    new THREE.HemisphereLight(0xdfe6ff, 0x221447, hemi),
    Object.assign(new THREE.DirectionalLight(0xfff4e8, key), { name: 'key' }),
    Object.assign(new THREE.DirectionalLight(0xc9d6ff, fill), { name: 'fill' }),
    Object.assign(new THREE.DirectionalLight(0xe6ddff, rim), { name: 'rim' }),
  ];
  lights[1].position.set(-2.2, 3.6, 3.0);
  lights[2].position.set(3.0, 1.6, 2.4);
  lights[3].position.set(1.2, 3.2, -3.2);
  for (const l of lights) scene.add(l);
  return lights;
}

/**
 * The Soul's own glow rising from below (the reveal's floor ring light, in the Soul's glow colour). `feetY` is where
 * the resting Soul's feet are in the parent's space; the light keeps the phone offset from them.
 */
export function addGlowLight(THREE, parent, color, feetY = SOUL_VIEW.restY) {
  const G = SOUL_VIEW.glowLight;
  const light = new THREE.PointLight(color, G.intensity, G.distance, G.decay);
  light.position.set(0, G.y + (feetY - SOUL_VIEW.restY), G.z);
  parent.add(light);
  return light;
}

/** viewBox point of a model-space position on the flat Soul (front orthographic, docs/art/soul-baseline.md). */
export function modelToViewBox([x, y]) { return [MAPPING.cx + MAPPING.scale * x, MAPPING.y0 - MAPPING.scale * y]; }

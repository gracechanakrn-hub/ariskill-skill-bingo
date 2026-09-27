// packages/ui/soul3d/figure.js - the 3D sticker figure of one Soul, shared by the phone reveal / Float and the public
// Galaxy's Float entrance and impostors (D-27, D-29 "Rendering: one Soul everywhere", D-31):
//   - the one sculpted mesh with per-Soul vertex colours from its COLOR_0 mask (tint.js: a v1 palette, or the body
//     gradient of a decorated v2 / v3 Soul over each vertex's height, then the D-27 mask mixes),
//   - glossy clay: MeshPhysicalMaterial (clearcoat ~0.8, low roughness, peach sheen) lit by the studio environment,
//   - the antenna orb lit from inside in the glow colour (emissive weighted by mask A) + an optional additive glow
//     sprite; a v3 Soul has no orb (its antenna holds a charm): no orb emissive and no glow sprite,
//   - a white die-cut outline: the lite LOD as an inverted hull (back faces pushed out along the normals, unlit,
//     depth-write off so only the rim outside the body silhouette shows),
//   - decorations: the 10 charm models at their slots (placement.js basis, position and scale) and the face kit at
//     identity in model space; for v3 also the face plate and the eyes at identity and the antenna charm ("topper")
//     placed like a charm at its slot (whatever of them loaded: a missing piece is skipped, never the Soul). They keep
//     their own fixed colours and fade in with the features (setOpacity's orbO). Draw order (RENDER_ORDER): body <
//     charms and topper < plate < eyes < face kit.
// Needs Three.js objects (passed in) but no DOM: node-testable.
import { PALETTES, resolveSoul } from '../soul-renderer.js';
import { tintColors, tintGradientColors, orbGlow, hexToLinear } from './tint.js';
import { PEACH, OUTLINE, LOOK, SOUL_VIEW } from './studio.js';
import { vertexHeights } from './model.js';
import { hasDecor } from './decor.js';

/** renderOrder of the figure's parts: each decoration layer draws over the one before it (the blush is blended). */
export const RENDER_ORDER = Object.freeze({ glow: -2, hull: -1, body: 0, charm: 1, topper: 1, plate: 2, eyes: 3, face: 4 });

const SHARED = ['position', 'normal'];
/** Shares the cached index / position / normal buffers; adds this Soul's own attributes. */
function geometryFrom(THREE, model, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setIndex(model.geometry.index);
  g.setAttribute('position', model.geometry.attributes.position);
  g.setAttribute('normal', model.geometry.attributes.normal);
  for (const [name, attr] of Object.entries(extra)) g.setAttribute(name, attr);
  g.boundingBox = model.geometry.boundingBox.clone();
  g.boundingSphere = model.geometry.boundingSphere.clone();
  return g;
}
function placeLikeNode(obj, model) { obj.position.copy(model.position); obj.quaternion.copy(model.quaternion); obj.scale.copy(model.scale); }
/**
 * Frees this Soul's own geometry without freeing the cached model's buffers: three.js deletes the GPU buffers of every
 * attribute a disposed geometry holds, so the shared index / position / normal are detached first. A long-lived
 * renderer (the Galaxy's impostor stage) then keeps the uploaded baseline mesh across hundreds of Souls.
 */
function disposeOwn(g) { for (const name of SHARED) g.deleteAttribute(name); g.setIndex(null); g.dispose(); }

/**
 * A decoration instance: the cached template cloned (geometry and textures shared). With `ownMaterials` it gets its
 * own materials, so this Soul can fade it without touching another Soul's copy (the phone reveal); without, it keeps
 * the template's materials (always opaque: the Galaxy fades its sprite instead), so no shader program is released
 * and rebuilt per Soul. Returns { object, materials (own only) }.
 */
function instanceOf(template, renderOrder, ownMaterials = true) {
  const object = template.scene.clone(true);
  const materials = [];
  object.traverse((o) => {
    if (!o.isMesh) return;
    if (ownMaterials) {
      const own = (m) => {
        const c = m.clone();
        // clone() drops a per-instance shader patch (the plates' / eyes' emissive x vertex colour): keep the template's
        if (Object.hasOwn(m, 'onBeforeCompile')) c.onBeforeCompile = m.onBeforeCompile;
        if (Object.hasOwn(m, 'customProgramCacheKey')) c.customProgramCacheKey = m.customProgramCacheKey;
        c.userData.baseOpacity = m.opacity; c.transparent = true; materials.push(c); return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    }
    o.renderOrder = renderOrder;
  });
  return { object, materials };
}

/**
 * Colours of a figure from its inputs: an explicit `palette` (the join mascot, legacy callers) or the Soul `config`
 * (v1 palette, or the gradient of a decorated v2 / v3 Soul). Returns { look, v2 (decorated: gradient tint), v3 (no
 * orb), gradient, palette (hex: fill, highlight, outline, glow) }.
 */
export function figureColours({ config = null, palette = null } = {}) {
  if (palette) return { look: null, v2: false, v3: false, gradient: null, palette };
  const look = resolveSoul(config);
  const pal = look.pal || PALETTES[0];
  const decorated = look.version >= 2;
  return { look, v2: decorated, v3: look.version >= 3, gradient: decorated ? look.grad : null, palette: { fill: pal.fill, highlight: pal.highlight, outline: pal.outline, glow: pal.glow } };
}

/**
 * The sticker figure for one Soul. Origin at the feet (model floor), height = fitHeight scene units, facing +Z.
 * opts: { body, hull, config | palette, decor (loadSoulDecor result), quality: 'high'|'low', fitHeight, outline (model
 *         units), orbGlowStrength, glowTexture, clearcoat, decorMaterials: 'own' (fade with the features, default) | 'shared' }
 * A v3 config goes on the v3 body (model.js soulBodyVariant): no orb glow sprite and no orb emissive.
 * Returns { root, model, body, hull, orbSprite, charms, face, plate, eyes, topper, look, landmarks, fit, materials,
 *           setOpacity(o, orbO), setOutline(boost), setDecor(decor), dispose() }.
 */
export function buildSoulFigure(THREE, opts) {
  const { body, hull, quality = 'high', fitHeight = SOUL_VIEW.fitHeight, outline = 0.03, orbGlowStrength = 2.2, glowTexture = null, decorMaterials = 'own' } = opts;
  const ownDecor = decorMaterials !== 'shared';
  const high = quality === 'high';
  const colours = figureColours(opts);
  const palette = colours.palette;
  const orbStrength = colours.v3 ? 0 : orbGlowStrength; // a v3 antenna holds a charm, not a lit orb
  const L = body.landmarks;
  const root = new THREE.Group();
  const model = new THREE.Group();
  const fit = fitHeight / L.height;
  root.scale.setScalar(fit);
  model.position.y = -L.floor;
  root.add(model);

  // ---- tinted clay body: the v2 / v3 gradient on the vertex heights, else the palette fill ----
  const tint = colours.v2
    ? tintGradientColors(body.mask, body.heights || vertexHeights(body.geometry.attributes.position, body, L.floor), colours.gradient)
    : tintColors(body.mask, palette);
  const colors = new THREE.BufferAttribute(tint, 3);
  const glowW = new THREE.BufferAttribute(orbGlow(body.mask), 1);
  const bodyGeo = geometryFrom(THREE, body, { color: colors, soulGlow: glowW });
  const glowLin = hexToLinear(palette.glow);
  // one body shader for every Soul (v3 only zeroes the uniform), so a long-lived renderer keeps a single program
  const orbUniform = { value: new THREE.Vector3(glowLin[0] * orbStrength, glowLin[1] * orbStrength, glowLin[2] * orbStrength) };
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.34, metalness: 0,
    clearcoat: opts.clearcoat ?? (high ? 0.8 : 0), clearcoatRoughness: 0.12,
    sheen: 0.35, sheenColor: new THREE.Color(PEACH), sheenRoughness: 0.5,
    transparent: true, opacity: 1,
  });
  bodyMat.onBeforeCompile = (shader) => {
    shader.uniforms.uOrbGlow = orbUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float soulGlow;\nvarying float vSoulGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSoulGlow = soulGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uOrbGlow;\nvarying float vSoulGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uOrbGlow * vSoulGlow;');
  };
  bodyMat.customProgramCacheKey = () => 'arise-soul-baseline-orb-glow';
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  placeLikeNode(bodyMesh, body);
  bodyMesh.renderOrder = RENDER_ORDER.body;
  model.add(bodyMesh);

  // ---- die-cut: lite LOD as an inverted hull, normals pushed out by `outline` model units ----
  const hullGeo = geometryFrom(THREE, hull);
  const thicknessLocal = outline / hull.scale.x;   // the node scale carries the dequantisation
  const hullMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    uniforms: { uColor: { value: new THREE.Color(OUTLINE).multiplyScalar(LOOK.outlineLevel) }, uOpacity: { value: 1 }, uThickness: { value: thicknessLocal } },
    vertexShader: 'uniform float uThickness;\nvoid main() {\n\tvec3 p = position + normalize(normal) * uThickness;\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);\n}',
    fragmentShader: 'uniform vec3 uColor;\nuniform float uOpacity;\nvoid main() {\n\tgl_FragColor = vec4(uColor, uOpacity);\n\t#include <colorspace_fragment>\n}',
  });
  const hullMesh = new THREE.Mesh(hullGeo, hullMat);
  placeLikeNode(hullMesh, hull);
  hullMesh.renderOrder = RENDER_ORDER.hull;   // drawn first; the body then covers everything but the rim outside its silhouette
  model.add(hullMesh);

  // ---- orb glow: additive sprite in the glow colour just behind the orb, so the lit orb keeps its clay shading and
  // the light spills around it (the orb itself glows through the emissive mask above); none for a v3 Soul ----
  let orbSprite = null;
  if (glowTexture && !colours.v3) {
    orbSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: new THREE.Color(palette.glow), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    const c = L.orb.centre;
    orbSprite.position.set(c[0], c[1], c[2] - L.orb.radius * 1.1);
    orbSprite.scale.setScalar(L.orb.radius * 6);
    orbSprite.renderOrder = RENDER_ORDER.glow; // before the hull and the body: they cover its core, the halo shows around the orb
    model.add(orbSprite);
  }

  // ---- decorations (model space): charms and the v3 antenna charm at their slots; the face plate, the eyes and the
  // face kit at identity ----
  let charms = [], face = null, plate = null, eyes = null, topper = null, decorMats = [], decorOpacity = 1;
  function clearDecor() {
    for (const o of [...charms, face, plate, eyes, topper]) if (o) model.remove(o);
    for (const m of decorMats) m.dispose();
    charms = []; face = null; plate = null; eyes = null; topper = null; decorMats = [];
  }
  /** A charm model in a holder that carries its placement (the template keeps its own dequantising node inside). */
  function placed(template, place, name, renderOrder) {
    const { object, materials } = instanceOf(template, renderOrder, ownDecor);
    const holder = new THREE.Group();
    holder.name = name;
    holder.position.fromArray(place.position);
    holder.quaternion.fromArray(place.quaternion);
    holder.scale.setScalar(place.scale);
    holder.add(object);
    model.add(holder);
    decorMats.push(...materials);
    return holder;
  }
  /** A part authored in model space (face kit, plate, eyes), at identity. */
  function atIdentity(template, name, renderOrder) {
    const { object, materials } = instanceOf(template, renderOrder, ownDecor);
    object.name = name;
    model.add(object);
    decorMats.push(...materials);
    return object;
  }
  function setDecor(decor) {
    clearDecor();
    if (!hasDecor(decor)) return false; // a partial decoration draws what loaded
    for (const c of decor.charms || []) charms.push(placed(c.model, c.place, `charm:${c.slot}:${c.id}`, RENDER_ORDER.charm));
    if (decor.topper) topper = placed(decor.topper.model, decor.topper.place, `topper:${decor.topper.id}`, RENDER_ORDER.topper);
    if (decor.plate) plate = atIdentity(decor.plate, `plate:${decor.plate.id}`, RENDER_ORDER.plate);
    if (decor.eyes) eyes = atIdentity(decor.eyes, `eyes:${decor.eyes.id}`, RENDER_ORDER.eyes);
    if (decor.face) face = atIdentity(decor.face, `face:${decor.face.face}`, RENDER_ORDER.face);
    for (const m of decorMats) m.opacity = m.userData.baseOpacity * decorOpacity;
    return charms.length > 0 || !!(face || plate || eyes || topper);
  }
  if (opts.decor) setDecor(opts.decor);

  const baseThickness = thicknessLocal;
  return {
    root, model, body: bodyMesh, hull: hullMesh, orbSprite, look: colours.look, landmarks: L, fit,
    get charms() { return charms; },
    get face() { return face; },
    get plate() { return plate; },
    get eyes() { return eyes; },
    get topper() { return topper; },
    materials: { body: bodyMat, hull: hullMat },
    /** Figure opacity: body and hull at `o`; orb glow and the decorations (features) at `orbO`. */
    setOpacity(o, orbO = o) {
      bodyMat.opacity = o;
      hullMat.uniforms.uOpacity.value = o;
      orbUniform.value.set(glowLin[0] * orbStrength * orbO, glowLin[1] * orbStrength * orbO, glowLin[2] * orbStrength * orbO);
      if (orbSprite) orbSprite.material.opacity = 0.85 * orbO;
      decorOpacity = orbO;
      for (const m of decorMats) m.opacity = m.userData.baseOpacity * orbO;
    },
    /** Die-cut width multiplier (1 = rest) for the one peel flash. */
    setOutline(boost = 1) { hullMat.uniforms.uThickness.value = baseThickness * boost; },
    /** Attach (or replace) the decorations; a late loadSoulDecor result joins at the current feature opacity. */
    setDecor,
    dispose() {
      clearDecor();
      disposeOwn(bodyGeo); disposeOwn(hullGeo); bodyMat.dispose(); hullMat.dispose();
      if (orbSprite) orbSprite.material.dispose();
    },
  };
}

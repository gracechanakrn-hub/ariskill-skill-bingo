// packages/ui/soul3d/winner.js - the Bingo winner's crown on the big screen (stage 15, D-36): in the public Galaxy a
// winning Soul (badge 'bingo-star') wears a gold crown on its head instead of the small Bingo Star medallion, so the
// winner stands out in the crowd (the Galaxy also draws it 1.3x bigger in a gold glow). Only the Galaxy asks for it
// (buildSoulRig({ winnerCrown })); the phone keeps the medallion. The crown is a Blender GLB
// (tools/ai/blender/winner_crown.py -> assets/souls/winner/crown.glb, manifest id soul_winner_crown); until it has
// loaded, or when it cannot, the same crown is built here from primitives. Crown frame: origin at the centre of the
// band's base, +Y up, +Z front; CROWN_PLACE sets it on the head in model space (glTF: +Y up, +Z front). Gold, no white
// die-cut (the big screen has none).
import { assetUrl } from '../asset-map.js';

export const WINNER_CROWN_ID = 'soul_winner_crown';
/** The crown on the dome of the head (the head is ~0.33 wide at y 1.55), tilted a little like a worn crown. */
export const CROWN_PLACE = Object.freeze({ position: Object.freeze([0.015, 1.49, -0.005]), rotationZ: -0.07 });
export const CROWN_RETRY_MS = 30000;
/** Draw after the body and its decorations, like the medallion. */
const CROWN_RENDER_ORDER = 4;

const crowns = new Map();     // url -> Promise<scene | null>, one load per session
const failedAt = new Map();   // url -> when it last failed (retried after CROWN_RETRY_MS)

/**
 * The crown GLB's scene, loaded once per session: mods = { THREE, addons: { GLTFLoader } }. Resolves null - the
 * procedural crown stands in - when the asset map has no crown, there is no loader, or the file fails to load (tried
 * again CROWN_RETRY_MS later). Never rejects.
 */
export function loadWinnerCrown(mods, { url = assetUrl(WINNER_CROWN_ID), now = Date.now, retryAfterMs = CROWN_RETRY_MS } = {}) {
  const Loader = mods && mods.addons && mods.addons.GLTFLoader;
  if (!url || typeof Loader !== 'function') return Promise.resolve(null);
  if (crowns.has(url)) return crowns.get(url);
  if (failedAt.has(url) && now() - failedAt.get(url) < retryAfterMs) return Promise.resolve(null);
  const p = new Promise((resolve) => {
    try { new Loader().load(url, (gltf) => resolve((gltf && gltf.scene) || null), undefined, () => resolve(null)); } catch { resolve(null); }
  }).then((scene) => {
    if (!scene) { failedAt.set(url, now()); crowns.delete(url); } else failedAt.delete(url);
    return scene;
  });
  crowns.set(url, p);
  return p;
}

function goldMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ color: 0xf6c453, metalness: 0.85, roughness: 0.3, emissive: 0x7a5410, emissiveIntensity: 0.35 });
}

/** The crown from primitives, into `group` (crown frame); returns its dispose. */
function proceduralCrown(THREE, group) {
  const geos = [], mats = [];
  const keep = (g, m) => { geos.push(g); if (!mats.includes(m)) mats.push(m); const mesh = new THREE.Mesh(g, m); mesh.renderOrder = CROWN_RENDER_ORDER; return mesh; };
  const gold = goldMaterial(THREE);
  // band: a flared gold ring sitting on the dome of the head
  const profile = [[0.328, 0], [0.348, 0], [0.366, 0.1], [0.346, 0.1], [0.328, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  group.add(keep(new THREE.LatheGeometry(profile, 72), gold));
  const ruby = new THREE.MeshStandardMaterial({ color: 0xe0356b, metalness: 0.2, roughness: 0.15, emissive: 0x5a0a22, emissiveIntensity: 0.6 });
  const sapphire = new THREE.MeshStandardMaterial({ color: 0x4d7dff, metalness: 0.2, roughness: 0.15, emissive: 0x0d1e66, emissiveIntensity: 0.6 });
  mats.push(ruby, sapphire);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i - 2) * 0.56;              // spikes across the front half, the middle one facing the viewer
    const x = Math.cos(a) * 0.356, z = Math.sin(a) * 0.356;
    const spike = keep(new THREE.ConeGeometry(0.058, 0.15, 16), gold);
    spike.position.set(x, 0.1 + 0.075, z);
    spike.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    group.add(spike);
    const jewel = keep(new THREE.SphereGeometry(0.03, 16, 12), i % 2 ? sapphire : ruby);
    jewel.position.set(x * 1.02, 0.1 + 0.16, z * 1.02);
    group.add(jewel);
    if (i % 2 === 0) {
      const gem = keep(new THREE.SphereGeometry(0.022, 14, 10), sapphire);
      gem.position.set(Math.cos(a) * 0.37, 0.05, Math.sin(a) * 0.37);
      group.add(gem);
    }
  }
  for (let i = 5; i < 9; i++) {                           // plain spikes round the back so it reads as a crown when turning
    const a = Math.PI / 2 + i * (2 * Math.PI / 9) + 0.2;
    const spike = keep(new THREE.ConeGeometry(0.05, 0.12, 12), gold);
    spike.position.set(Math.cos(a) * 0.35, 0.1 + 0.06, Math.sin(a) * 0.35);
    group.add(spike);
  }
  return () => { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); };
}

/**
 * { group, fromGlb, dispose } in model space, placed on the head (CROWN_PLACE): a clone of the crown GLB's scene when
 * `template` is given - its geometry and materials stay shared with the template, so dispose leaves them - else the
 * crown built from primitives (dispose frees them).
 */
export function buildWinnerCrown(THREE, template = null) {
  const group = new THREE.Group();
  group.name = 'winner:crown';
  let dispose = () => {};
  const fromGlb = !!(template && typeof template.clone === 'function');
  if (fromGlb) {
    const crown = template.clone(true);
    crown.traverse((o) => { if (o.isMesh) o.renderOrder = CROWN_RENDER_ORDER; });
    group.add(crown);
  } else dispose = proceduralCrown(THREE, group);
  group.position.set(...CROWN_PLACE.position);
  group.rotation.z = CROWN_PLACE.rotationZ;
  return { group, fromGlb, dispose };
}

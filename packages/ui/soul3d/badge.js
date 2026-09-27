// packages/ui/soul3d/badge.js - the Bingo Star badge in 3D (the only badge; never part of the config, BR-17): a gold
// five-point star with the white sticker die-cut, floating at the upper right of the head. For decorated (v2 / v3)
// Souls it sits on a round medallion (violet-deep disc, gold ring, white die-cut) so it can't be mistaken for a core
// star charm (D-29 "Colour"); the 2D renderer draws the same medallion (packages/ui/soul-renderer.js BADGE_MEDALLION).
import { OUTLINE, LOOK } from './studio.js';

export const MEDALLION = Object.freeze({ radius: 1.08, star: 0.8, color: 0x3b2a7a, gold: 0xf6c453 }); // x the star's outer radius

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

/**
 * Badge group facing +Z, centred on its origin. `radius` is the star's outer radius in the parent's units.
 * Returns { group, setOpacity(o), dispose() }; starts fully transparent (the reveal fades it in with the features).
 */
export function buildBadge(THREE, { radius, medallion = false, opacity = 0 } = {}) {
  const R = medallion ? radius * MEDALLION.star : radius;
  const white = new THREE.Color(OUTLINE).multiplyScalar(LOOK.outlineLevel); // same white as the Soul's die-cut
  const group = new THREE.Group();
  const geos = [], mats = [];
  const keep = (g, m) => { geos.push(g); mats.push(m); return new THREE.Mesh(g, m); };
  const fade = (m) => { m.userData.baseOpacity = m.opacity; m.transparent = true; return m; };

  const starGeo = new THREE.ExtrudeGeometry(starShape(THREE, R, R * 0.43), { depth: R * 0.3, bevelEnabled: true, bevelThickness: R * 0.07, bevelSize: R * 0.07, bevelSegments: 2 });
  starGeo.translate(0, 0, -R * 0.15);
  const star = keep(starGeo, fade(new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0xffb000, emissiveIntensity: 0.12, roughness: 0.34, metalness: 0.05 })));
  star.renderOrder = 2;
  const hull = new THREE.Mesh(starGeo, fade(new THREE.MeshBasicMaterial({ color: white, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false })));
  mats.push(hull.material);
  hull.scale.setScalar(1.16);
  hull.renderOrder = 1; // after the body so the die-cut shows where the star overlaps the head
  group.add(hull, star);

  if (medallion) {
    const Rm = radius * MEDALLION.radius, depth = radius * 0.16;
    const disc = keep(new THREE.CylinderGeometry(Rm, Rm, depth, 48), fade(new THREE.MeshStandardMaterial({ color: MEDALLION.color, roughness: 0.42, metalness: 0.08 })));
    disc.rotation.x = Math.PI / 2; disc.position.z = -R * 0.3 - depth / 2;
    const ring = keep(new THREE.TorusGeometry(Rm * 0.84, radius * 0.045, 8, 48), fade(new THREE.MeshStandardMaterial({ color: MEDALLION.gold, emissive: 0xffb000, emissiveIntensity: 0.1, roughness: 0.3, metalness: 0.1 })));
    ring.position.z = -R * 0.3 + radius * 0.01;
    const cut = keep(new THREE.CircleGeometry(Rm * 1.12, 48), fade(new THREE.MeshBasicMaterial({ color: white, depthWrite: false, fog: false, toneMapped: false })));
    cut.position.z = -R * 0.3 - depth - radius * 0.02;
    disc.renderOrder = 1; ring.renderOrder = 2; cut.renderOrder = 1;
    group.add(cut, disc, ring);
  }

  const api = {
    group,
    setOpacity(o) { for (const m of mats) m.opacity = m.userData.baseOpacity * o; },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
  api.setOpacity(opacity);
  return api;
}

// packages/ui/soul3d/rig.js - one Soul, posed and dressed the same way on every screen: soul (bob / lift / peel) >
// turn (3/4 yaw + sway) > figure (feet at 0, SOUL_VIEW.fitHeight tall), plus the Bingo Star badge at the model's badge
// anchor (upper right of the head, outside `turn` so it stays upright while the Soul sways). The phone reveal adds its
// reveal effects around a rig; the public Galaxy renders the same rig for its Float entrance and bakes it into atlas
// impostors (packages/ui/soul3d/card.js). The caller passes the body of the config's variant (model.js
// soulBodyVariant: the v3 body for a v3 Soul). BR-17: pose, size, outline and badge are shared constants.
import { buildSoulFigure } from './figure.js';
import { buildBadge } from './badge.js';
import { SOUL_VIEW, outlineWidth } from './studio.js';

/**
 * opts: { body, hull, config, badge ('bingo-star' | null), decor (loadSoulDecor result), quality, glowTexture,
 *         decorMaterials ('own' fades with the reveal; 'shared' for always-opaque renders such as the Galaxy card) }
 * Returns { soul, turn, figure, badge: { group, setOpacity, dispose } | null, look, colors: { glow, highlight, outline, fill } (hex),
 *           toFigure(v), setDecor(decor), dispose() }.
 */
export function buildSoulRig(THREE, { body, hull, config, badge = null, decor = null, quality = 'high', glowTexture = null, decorMaterials = 'own' } = {}) {
  const soul = new THREE.Group();
  const turn = new THREE.Group();
  turn.rotation.y = SOUL_VIEW.yaw;
  soul.add(turn);
  const figure = buildSoulFigure(THREE, {
    body, hull, config, decor, quality, fitHeight: SOUL_VIEW.fitHeight,
    outline: outlineWidth(quality), orbGlowStrength: SOUL_VIEW.orbGlow, glowTexture, decorMaterials,
  });
  turn.add(figure.root);
  const L = figure.landmarks, fit = figure.fit;
  const toFigure = (v) => new THREE.Vector3(v[0] * fit, (v[1] - L.floor) * fit, v[2] * fit); // model -> turn space
  const look = figure.look;
  const pal = look.pal;

  // Bingo Star (the only badge): gold, white die-cut, on a medallion for decorated (v2 / v3) Souls, in front of the badge anchor
  let star = null;
  if (badge === 'bingo-star') {
    // opaque at rest (the Galaxy card draws it as is); the phone reveal fades it in with the features from its first frame
    star = buildBadge(THREE, { radius: SOUL_VIEW.badgeSize * fit, medallion: look.version >= 2, opacity: 1 });
    const a = L.badgeAnchor; // upper right of the head (model space); the star keeps screen-right of it, clear of the face
    star.group.position.copy(toFigure([a[0] + SOUL_VIEW.badgeSize * 0.55, a[1] + SOUL_VIEW.badgeSize * 0.2, a[2] + SOUL_VIEW.badgeForward]));
    soul.add(star.group);
  }

  return {
    soul, turn, figure, badge: star, look, toFigure,
    colors: Object.freeze({ fill: pal.fill, highlight: pal.highlight, outline: pal.outline, glow: pal.glow }),
    setDecor(decor) { return figure.setDecor(decor); },
    dispose() { figure.dispose(); if (star) star.dispose(); },
  };
}

// packages/ui/soul3d/rig.js - one Soul, posed and dressed the same way on every screen: soul (bob / lift / peel) >
// turn (3/4 yaw + sway) > figure (feet at 0, SOUL_VIEW.fitHeight tall), plus the Bingo Star badge at the model's badge
// anchor (upper right of the head, outside `turn` so it stays upright while the Soul sways). The phone reveal adds its
// reveal effects around a rig; the public Galaxy renders the same rig for its Float entrance and bakes it into atlas
// impostors (packages/ui/soul3d/card.js). The caller passes the body of the config's variant (model.js
// soulBodyVariant: the v3 body for a v3 Soul). A rig built with `actions` (stage 15, D-36) can also play the idle micro
// actions of actions.js: setPose(actionPose(action, t, { side })) each frame, rest() when it ends; rigs without it keep
// today's plain meshes. The Galaxy's rigs also pass `winnerCrown` (stage 15, D-36, winner.js): a winner wears the gold crown
// on its head instead of the medallion; the phone's rigs keep the medallion. BR-17: pose, size, outline and badge are
// shared constants.
import { buildSoulFigure } from './figure.js';
import { buildBadge } from './badge.js';
import { buildWinnerCrown } from './winner.js';
import { SOUL_VIEW, outlineWidth } from './studio.js';

/**
 * opts: { body, hull, config, badge ('bingo-star' | null), decor (loadSoulDecor result), quality, glowTexture,
 *         decorMaterials ('own' fades with the reveal; 'shared' for always-opaque renders such as the Galaxy card),
 *         actions (true: a skeleton for the idle micro actions), dieCut (false: no white die-cut hull, the big screen),
 *         winnerCrown (with badge 'bingo-star': true for the crown built from primitives, or the crown GLB's scene from
 *         loadWinnerCrown - either replaces the medallion; false keeps it, the default) }
 * Returns { soul, turn, figure, badge: { group, setOpacity, dispose } | null, crown: { group, fromGlb, dispose } | null, look, colors: { glow, highlight, outline, fill } (hex),
 *           toFigure(v), setDecor(decor), dispose() }, plus setPose(pose) and rest() with `actions` (the badge never
 *           acts: it stays upright at the upper right, outside the turn).
 */
export function buildSoulRig(THREE, { body, hull, config, badge = null, decor = null, quality = 'high', glowTexture = null, decorMaterials = 'own', actions = false, dieCut = true, winnerCrown = false } = {}) {
  const soul = new THREE.Group();
  const turn = new THREE.Group();
  turn.rotation.y = SOUL_VIEW.yaw;
  soul.add(turn);
  const figure = buildSoulFigure(THREE, {
    body, hull, config, decor, quality, fitHeight: SOUL_VIEW.fitHeight,
    outline: outlineWidth(quality), orbGlowStrength: SOUL_VIEW.orbGlow, glowTexture, decorMaterials, actions, dieCut,
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
  // the Galaxy's winner wears the gold crown instead of the medallion (D-36); it hangs from the head (the head's anchor on
  // an acting rig) so it moves with the Soul
  let crown = null;
  if (badge === 'bingo-star' && winnerCrown) {
    crown = buildWinnerCrown(THREE, winnerCrown === true ? null : winnerCrown);
    (figure.actor ? figure.actor.anchors.head : figure.model).add(crown.group);
    if (star) star.group.visible = false;
  }

  const rig = {
    soul, turn, figure, badge: star, crown, look, toFigure,
    colors: Object.freeze({ fill: pal.fill, highlight: pal.highlight, outline: pal.outline, glow: pal.glow }),
    setDecor(decor) { return figure.setDecor(decor); },
    dispose() { figure.dispose(); if (star) star.dispose(); if (crown) crown.dispose(); },
  };
  if (figure.setPose) {
    /** Poses the Soul for an idle micro action (actions.js actionPose); true while it is acting. */
    rig.setPose = (pose) => figure.setPose(pose);
    /** Exactly the rest figure again (what the baked impostor shows). */
    rig.rest = () => figure.rest();
  }
  return rig;
}

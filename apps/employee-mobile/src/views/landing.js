// apps/employee-mobile/src/views/landing.js - E0 Landing (D-41): the Blender AriSkill sign, then the 3D Arise Soul flies
// in from the distance, lands in front of the player and waves (src/landing/landing-scene.js); Start appears on
// touchdown (no tagline, D-42). Without WebGL, or under reduced motion, the still waving pose shows and the copy is there at once.
import { h, mount } from '/packages/ui/dom.js';
import { t } from '/packages/contracts/index.js';
import { button } from './common.js';

export function mountLanding(root, ctx) {
  let scene = null, disposed = false;
  const reduced = ctx.audioMotion.isReduced();
  const still = h('img', { className: 'landing__still', src: '/play/art/soul-hi.webp', alt: '', width: '275', height: '325', decoding: 'async', hidden: true });
  const stage = h('div', { className: 'landing__stage', role: 'img', 'aria-label': t('landing.alt') }, still);
  const section = h('section', { className: 'landing', 'aria-labelledby': 'landing-title' },
    h('h1', { className: 'visually-hidden', id: 'landing-title' }, t('landing.title')),
    h('img', { className: 'landing__sign', src: '/play/art/ariskill-sign.webp', alt: '', width: '720', height: '360', decoding: 'async' }),
    stage,
    h('div', { className: 'landing__copy' },
      button(t('landing.cta'), { variant: 'primary', className: 'landing__start', onClick: ctx.actions.enterJoin })));
  mount(root, section);
  const reveal = () => section.classList.add('is-landed');

  import('../landing/landing-scene.js')
    .then((m) => m.createLandingScene(stage, { reduced, onLanded: reveal }))
    .then((s) => { if (disposed) { if (s) s.dispose(); return; } scene = s; if (!s) { still.hidden = false; reveal(); } })
    .catch(() => { still.hidden = false; reveal(); });
  setTimeout(reveal, 6000); // never leave Start hidden, whatever happens to the scene

  return { update() {}, effect() {}, unmount() { disposed = true; if (scene) scene.dispose(); mount(root, null); } };
}

// apps/employee-mobile/src/views/soul.js - E8 Soul reveal (staged, skippable after first view), private Matrix insight
// card (M-12), E9 READY TO FLOAT (3 -> 2 -> 1 -> FLOAT on the server clock, one-use token, M-13), E10 Floated.
// The Soul SVG comes from the shared renderer and is parsed as an SVG document (no innerHTML on this side).
// Game experience (D-22): the reveal and the Float lift-off play in a lazily imported Three.js hero scene
// (src/scene/soul-scene.js) when WebGL and the frame budget allow; otherwise the staged CSS reveal on the SVG runs
// exactly as before. The SVG stays in the DOM (visually hidden while the 3D scene is up) so the accessible name and
// the floated state never depend on the scene.
import { h, mount, setPending } from '/packages/ui/dom.js';
import { animateOnce, runFloatCountdown, MOTION, prefersReducedMotion } from '/packages/ui/motion.js';
import { renderSoulSvg, soulAltText } from '/packages/ui/soul-renderer.js';
import { t } from '/packages/contracts/index.js';
import { formatTime } from '/packages/ui/format.js';
import { tl, exceptionCopy, notice, button, roundLine, nextRoundBlock } from './common.js';
import { nextRoundAction } from '../state.js';

const SEEN_KEY = (soulId) => `ariskill.play.soulSeen:${soulId}`;
const SETTLE_GRACE_MS = 400; // floated state without a live launch effect -> SVG takes over after this grace

function seenBefore(soulId) { try { return sessionStorage.getItem(SEEN_KEY(soulId)) === '1'; } catch { return false; } }
function markSeen(soulId) { try { sessionStorage.setItem(SEEN_KEY(soulId), '1'); } catch { /* storage unavailable */ } }

/** Parse the renderer's SVG string into a live element without innerHTML. */
export function svgElement(svgString) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return h('span', { className: 'muted' }, '');
  return document.adoptNode(svg);
}

export function mountSoul(root, ctx, screen) {
  let els = {};
  let renderedSoulId = null;
  let revealCancel = null;
  let floatCancel = null;
  let lastState = null;
  let scene3d = null;        // live hero scene controller (or null: SVG + CSS path)
  let sceneSeq = 0;          // guards async scene creation against a newer Soul / unmount
  let skipRequested = false;
  let floating3d = false;
  let settleTimer = null;

  function renderShell() {
    els = {};
    els.title = h('h1', { className: 'screen-title' });
    els.figure = h('figure', { className: 'soul-figure' });
    els.caption = h('figcaption', { className: 'soul-caption muted' });
    els.stage3d = h('div', { className: 'soul-3d', 'aria-hidden': 'true' });
    els.reveal = h('div', { className: 'soul-stage', 'aria-live': 'off' }, els.stage3d, h('div', { className: 'soul-glow m-soul-glow', 'aria-hidden': 'true' }), h('div', { className: 'soul-body m-soul-silhouette' }, els.figure), h('div', { className: 'soul-features m-soul-features' }, els.caption));
    els.skip = button(tl('ui.skipReveal'), { variant: 'ghost', className: 'btn--sm', onClick: skipReveal, hidden: true });
    els.insight = h('section', { className: 'card insight-card stack stack--tight', 'aria-labelledby': 'insight-title' });
    els.float = h('div', { className: 'stack stack--tight float-block' });
    els.digits = h('div', { className: 'float-countdown m-float-countdown', 'aria-live': 'assertive', 'aria-atomic': 'true', hidden: true });
    els.round = h('div', { className: 'round-block' });
    els.next = h('div', { className: 'stack stack--tight' });
    mount(root, h('div', { className: 'stack' }, els.title, els.round, els.reveal, els.skip, els.digits, els.float, els.insight, els.next));
  }

  function renderSoul(state) {
    const soul = state.soul;
    if (!soul) return;
    if (renderedSoulId !== soul.soulId) {
      const alt = soulAltText(soul.config, soul.badge);
      const svg = svgElement(renderSoulSvg(soul.config, { size: 220, badge: soul.badge, detail: 'full', reducedMotion: prefersReducedMotion(), label: alt, idPrefix: `soul-${soul.soulId}` }));
      mount(els.figure, svg);
      els.caption.textContent = soul.badge === 'bingo-star' ? t('soul.badgeLabel') : '';
      renderedSoulId = soul.soulId;
      startReveal(soul);
    }
    els.reveal.classList.toggle('is-floated', !!soul.floated);
    // State is applied first; the live float effect (SSE event or HTTP response) follows right after and claims the
    // scene for the lift-off. Only when no live effect arrives within a short grace (replay / reload / snapshot) does
    // the small SVG Soul take over silently.
    if (soul.floated && scene3d && !floating3d && !settleTimer) settleTimer = setTimeout(() => { settleTimer = null; if (scene3d && !floating3d) settleScene(); }, SETTLE_GRACE_MS);
  }

  // ---- reveal --------------------------------------------------------------------------------------
  function startReveal(soul) {
    const soulId = soul.soulId;
    const first = !seenBefore(soulId);
    const reduced = prefersReducedMotion();
    els.reveal.classList.remove('is-revealed');
    els.skip.hidden = first; // skip is offered only after the first complete view (persisted per soulId)
    if (first) ctx.audioMotion.cueSoulReveal(soulId);
    if (soul.floated) { cssReveal(soulId, reduced); return; } // E10 after reload: no hero scene, SVG small
    skipRequested = false;
    const token = ++sceneSeq;
    els.reveal.classList.add('is-3d-pending');
    revealCancel = () => { skipRequested = true; };
    import('../scene/soul-scene.js')
      .then((m) => m.createSoulScene(els.stage3d, { config: soul.config, badge: soul.badge, reduced, onFallback: () => fallbackToSvg(soulId) }))
      .then((scene) => {
        if (token !== sceneSeq || !els.stage3d.isConnected) { if (scene) scene.dispose(); return; }
        els.reveal.classList.remove('is-3d-pending');
        if (!scene) { cssReveal(soulId, reduced); return; }
        scene3d = scene;
        els.reveal.classList.add('is-3d');
        const durationMs = reduced ? MOTION.durations.base : MOTION.interactions.soulReveal.ms;
        revealCancel = () => scene.skip();
        scene.reveal({ durationMs }).then(() => { if (scene3d === scene && token === sceneSeq) finishReveal(soulId); });
        if (skipRequested) scene.skip();
      })
      .catch(() => { if (token === sceneSeq) { els.reveal.classList.remove('is-3d-pending'); cssReveal(soulId, reduced); } });
  }
  /** The staged CSS reveal on the SVG (motion-spec E8): glow -> silhouette -> features. */
  function cssReveal(soulId, reduced) {
    els.reveal.classList.remove('is-3d-pending');
    revealCancel = animateOnce(els.reveal, 'm-soul-reveal', { durationMs: reduced ? MOTION.durations.base : MOTION.interactions.soulReveal.ms, onEnd: () => finishReveal(soulId) });
    if (skipRequested) revealCancel();
  }
  /** Frame budget exceeded mid-reveal: drop the scene and show the SVG in its final state. */
  function fallbackToSvg(soulId) {
    if (!scene3d) return;
    settleScene();
    finishReveal(soulId);
  }
  /** Removes the hero scene and hands the view back to the SVG (final state, no motion). */
  function settleScene() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (scene3d) { const s = scene3d; scene3d = null; s.dispose(); }
    floating3d = false;
    els.reveal.classList.remove('is-3d', 'is-3d-pending');
    els.reveal.classList.add('is-revealed');
  }
  function skipReveal() { if (revealCancel) revealCancel(); }
  function finishReveal(soulId) {
    revealCancel = null;
    els.reveal.classList.add('is-revealed');
    els.skip.hidden = true;
    if (soulId) markSeen(soulId);
    ctx.actions.soulRevealed();
  }

  // ---- insight / float ------------------------------------------------------------------------------
  function renderInsight(state) {
    const i = state.insight;
    const children = [h('h2', { id: 'insight-title', className: 'section__title' }, `\u{1F512}︎ ${t('insight.title')}`)];
    if (i) {
      const roleName = ctx.roleName(state.participant && state.participant.roleId) || '';
      children.push(h('p', { className: 'lead' }, t('insight.inMatrix', { count: i.inMatrixCount, role: roleName })));
      children.push(h('p', null, t('insight.beyond', { count: i.beyondMatrixCount })));
    } else if (state.insightAvailable) {
      children.push(h('p', { className: 'muted', role: 'status' }, tl('ui.loading')));
    }
    children.push(h('p', { className: 'muted insight-private' }, t('insight.private')));
    mount(els.insight, children);
    els.insight.hidden = !state.insightAvailable;
  }

  function renderFloat(state) {
    const soul = state.soul;
    const actions = [];
    if (!soul) { mount(els.float, actions); return; }
    if (soul.floated) {
      els.title.textContent = t('soul.floated');
    } else {
      els.title.textContent = t('soul.ready');
      if (state.ui.floatError) actions.push(notice(exceptionCopy(state.ui.floatError), { tone: 'danger', role: 'alert' }));
      const disabled = state.ui.floating || !soul.floatToken;
      els.floatButton = button(state.ui.floatError ? tl('ui.retry') : t('soul.float'), { variant: 'primary', className: 'btn--block btn--lg float-button', onClick: onFloat, disabled });
      actions.push(els.floatButton);
      if (!soul.floatToken && !state.ui.floating) actions.push(notice(exceptionCopy('E13'), { tone: 'warning' }));
    }
    mount(els.float, actions);
    els.digits.hidden = !state.ui.floating;
  }

  async function onFloat() {
    if (!lastState || !lastState.soul || lastState.ui.floating) return;
    if (lastState.ui.floatError) { ctx.actions.floatNow(); return; } // retry: same token, same idempotency key, no new countdown
    ctx.actions.floatStart();
    const startAt = ctx.clockNow() + 200;
    setPending(els.floatButton, true);
    const launchWord = t('soul.countdown').split(/\s+/).pop(); // "3 -> 2 -> 1 -> FLOAT" -> FLOAT
    floatCancel = runFloatCountdown({
      startAt,
      clockNow: ctx.clockNow,
      onTick: (n, { at }) => { showDigit(String(n)); ctx.audioMotion.cueFloatTick(at); },
      onLaunch: () => { showDigit(launchWord); ctx.actions.floatNow(); },
    });
  }
  function showDigit(text) {
    mount(els.digits, h('span', { className: 'm-float-digit float-digit' }, text));
    els.digits.hidden = false;
  }

  // Next-round action is never gated by Float (UX-01): Float stays available alongside it.
  function renderNext(state) {
    const next = nextRoundAction(state, ctx.clockNow());
    const items = [];
    if (next) items.push(nextRoundBlock(next, { onBuild: () => ctx.actions.startNextRound(next), formatTime }));
    else if (state.soul && state.soul.floated) items.push(h('p', { className: 'muted' }, t('board.noRound')));
    mount(els.next, items);
  }

  return {
    update(state) {
      lastState = state;
      if (!els.title) renderShell();
      mount(els.round, roundLine(state.round));
      renderSoul(state);
      renderInsight(state);
      renderFloat(state);
      renderNext(state);
    },
    effect(e) {
      if (e.type === 'float') {
        if (floatCancel) { floatCancel(); floatCancel = null; }
        els.digits.hidden = true;
        if (e.live && !e.replay) {
          if (scene3d) {
            // Lift-off in the hero scene (rise + mote trail + fade), then the small SVG Soul takes over (E10).
            floating3d = true;
            const scene = scene3d;
            scene.float({ durationMs: MOTION.interactions.float.launch.ms }).then(() => { if (scene3d === scene) settleScene(); });
          } else {
            animateOnce(els.reveal, 'm-float-launch', { durationMs: MOTION.interactions.float.launch.ms });
          }
          ctx.audioMotion.cueFloatLaunch(e.entrance ? e.entrance.soulId : (lastState.soul && lastState.soul.soulId));
        }
      }
      if (e.type === 'soul' && e.live) { /* reveal starts when the Soul renders; nothing extra */ }
    },
    unmount() {
      sceneSeq++;
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (revealCancel) revealCancel();
      if (floatCancel) floatCancel();
      if (scene3d) { scene3d.dispose(); scene3d = null; }
      mount(root, null);
    },
  };
}

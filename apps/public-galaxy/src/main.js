// Public event screen bootstrap (/public). Wires clock sync, the public snapshot + SSE stream (acknowledge
// pattern), the panel view-model, the Galaxy renderer chain, audio and accessibility affordances.
// Copy only via t()/exception() (src/copy.js); server strings are never assigned through innerHTML.
import { createApiClient } from '../../../packages/ui/api-client.js';
import { createClockSync } from '../../../packages/ui/clock-sync.js';
import { createSseClient } from '../../../packages/ui/sse-client.js';
import { h, mount, announce } from '../../../packages/ui/dom.js';
import { createAudioManager, PRELOAD_BY_APP } from '../../../packages/ui/audio.js';
import { prefersReducedMotion, restoreReducedMotion, createCelebrationGuard, scheduleAt, entranceStartMs } from '../../../packages/ui/motion.js';
import { track } from '../../../packages/ui/telemetry.js';
import { mountFullscreenButton } from '../../../packages/ui/fullscreen.js'; // D-51 (added by the 16-skill session)
import { initialState, applyPublicSnapshot, reduceEvent, panelViewModel, effectivePublicState } from './state.js';
import { createPanel } from './panel.js';
import { createGalaxy, loadSceneAssets, normaliseMode } from './galaxy.js';
import { t, exception, label } from './copy.js';
import { BINGO_UNLOCK_DRAW } from '../../../packages/contracts/index.js';

const EVENT_ID = 'evt_demo';
const params = new URLSearchParams(location.search);
const eventId = params.get('event') || EVENT_ID;
const rendererMode = normaliseMode(params.get('mode')); // static | canvas2d | three (webgl2 accepted as alias)
const quality = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : 'high';

restoreReducedMotion();
const reducedMotion = prefersReducedMotion() || params.get('motion') === 'reduced';

const api = createApiClient({ baseUrl: '/api/v1' });
const clock = createClockSync({ fetchTime: () => api.get('/time') });
const clockNow = () => clock.now();

const panelMain = document.getElementById('panel-main');
const footer = document.getElementById('panel-footer');
const galaxyHost = document.getElementById('galaxy');
const summary = document.getElementById('galaxy-summary');
const panel = createPanel(panelMain);

let state = initialState();
let sse = null, galaxy = null, audio = null;
let lastServerMs = 0;
let pendingWinnerBurst = false;
let winnerBurstRound = null;   // the Galaxy burst fires once per round even when bingo.detected and result.published both arrive
let winnerFlashRound = null;   // the outline flash on the winning Souls fires once per round, when their ids are known
let cancelWinnerFallback = () => {};

function galaxyWinner(roundId, soulIds = []) {
  if (!galaxy) return;
  const ids = (soulIds || []).filter(Boolean);
  if (winnerBurstRound !== roundId) {
    winnerBurstRound = roundId;
    if (ids.length) winnerFlashRound = roundId;
    galaxy.winner({ soulIds: ids });
  } else if (ids.length && winnerFlashRound !== roundId) {
    winnerFlashRound = roundId;
    galaxy.flash(ids);
  }
}
let refreshTimer = null;
let everOpen = false;
const guard = createCelebrationGuard({ getConnectionEpoch: () => (sse ? sse.connectionEpoch : 0) });

// ---- footer: stale indicator and renderer mode; sound captions for screen readers only (D-36) ------------------
const captionEl = h('p', { className: 'panel__caption visually-hidden', 'aria-live': 'polite', id: 'caption' });
const modeEl = h('span', { className: 'panel__mode', id: 'mode-indicator' });
const staleEl = h('span', { className: 'pill pill--warning panel__stale', hidden: true, id: 'stale-indicator' }, label('stale'));
// sound: one round icon button - speaker with a cross until sound is on, then speaker with waves (click to mute)
const SPEAKER = 'M4 9h4l5-4v14l-5-4H4z';
const soundIcon = (on) => h('svg', { class: 'panel__sound-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
  h('path', { d: SPEAKER, fill: 'currentColor' }),
  on ? h('path', { d: 'M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })
     : h('path', { d: 'M16.5 9.5l5 5M21.5 9.5l-5 5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));
const enableBtn = h('button', { type: 'button', className: 'panel__sound', id: 'enable-sound', 'aria-label': label('enableSound'), onClick: enableSound }, soundIcon(false));
const muteBtn = h('button', { type: 'button', className: 'panel__sound', id: 'mute', 'aria-pressed': false, 'aria-label': label('mute'), hidden: true, onClick: toggleMute }, soundIcon(true));
const volume = h('input', { type: 'range', min: 0, max: 100, step: 5, value: 70, className: 'panel__volume', id: 'volume', 'aria-label': label('volume'), hidden: true, onInput: (ev) => audio && audio.setMasterVolume(Number(ev.target.value) / 100) });
mount(footer, [h('div', { className: 'panel__status' }, staleEl, modeEl)]);
document.getElementById('panel').appendChild(h('div', { className: 'panel__sound-slot' }, enableBtn, muteBtn));
document.getElementById('panel').appendChild(captionEl); // off screen: the panel already shows the draw, the winners and the arrivals

async function enableSound() {
  if (!audio) return;
  const ok = await audio.unlock();
  if (ok) { audio.startAmbient(); }
  enableBtn.hidden = true; muteBtn.hidden = false;
  syncMute();
}
function toggleMute() { if (!audio) return; audio.setMuted(!audio.state().muted); syncMute(); }
function syncMute() {
  const muted = audio ? audio.state().muted : true;
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? label('unmute') : label('mute'));
  muteBtn.replaceChildren(soundIcon(!muted));
}

// ---- rendering ---------------------------------------------------------------------------------------------
function render(opts = {}) {
  const vm = panelViewModel(state, clockNow());
  const celebrateWinner = vm.mode === 'Winner' && pendingWinnerBurst;
  panel.render(vm, clockNow(), { celebrateDraw: !!opts.celebrateDraw, celebrateWinner });
  if (celebrateWinner) pendingWinnerBurst = false;
  summary.textContent = label('galaxySummary', { count: vm.galaxyCount });
  staleEl.hidden = !vm.stale;
  document.body.dataset.publicState = vm.mode.toLowerCase();
  manageWinnerFallback();
}

function manageWinnerFallback() {
  cancelWinnerFallback();
  cancelWinnerFallback = () => {};
  if (state.publicState !== 'Winner' || state.resultWindowElapsed || !state.round || !state.round.resultWindowEndsAt) return;
  // Display fallback only: round.closed from the server normally wins and cancels this timer.
  cancelWinnerFallback = scheduleAt(state.round.resultWindowEndsAt, clockNow, () => { state = { ...state, resultWindowElapsed: true }; render(); });
}

// ---- snapshot + stream -------------------------------------------------------------------------------------
async function refreshSnapshot({ replaying = false } = {}) {
  const snap = await api.get(`/events/${eventId}/snapshot`);
  if (audio && replaying) audio.setReplaying(true);
  state = applyPublicSnapshot(state, snap);
  noteServerTime(snap.serverTime);
  guard.markSnapshotApplied(snap.sequence);
  if (sse) sse.acknowledgeSnapshot(snap.sequence);
  if (audio) { audio.setConnectionEpoch(snap.sequence); if (replaying) audio.setReplaying(false); }
  if (galaxy) galaxy.setSouls(state.galaxy.souls);
  if (galaxy && state.publicState === 'Winner') galaxy.prewarm(); // opened (or reconnected) during a result: Floats follow
  render();
  return snap;
}
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshSnapshot().catch(() => {}); }, 300);
}
function noteServerTime(iso) { const ms = Date.parse(iso); if (Number.isFinite(ms)) lastServerMs = Math.max(lastServerMs, ms); }

function onEvent(envelope, meta) {
  if (!envelope || typeof envelope.sequence !== 'number') return;
  if (envelope.sequence <= state.sequence) return;               // duplicate / already covered by a snapshot
  const { state: next, needsSnapshot } = reduceEvent(state, envelope);
  state = { ...next, sequence: envelope.sequence };
  noteServerTime(envelope.occurredAt);
  const guardMeta = { epoch: meta.connectionEpoch, sequence: envelope.sequence, replay: meta.replay };
  const p = envelope.payload || {};
  let celebrateDraw = false;
  switch (envelope.type) {
    case 'draw.accepted': {
      const key = `draw:${envelope.roundId}:${p.draw && p.draw.number}`;
      if (guard.shouldCelebrate(key, guardMeta)) {
        celebrateDraw = true;
        if (galaxy) galaxy.ripple();
        if (audio) { audio.play('draw_reveal', { fresh: true, sequence: envelope.sequence, vars: { number: p.draw && p.draw.number } }); if (p.draw && p.draw.number === BINGO_UNLOCK_DRAW) audio.play('draw5_unlock', { fresh: true, sequence: envelope.sequence }); }
        announce(`${t('public.playing.draw', { number: p.draw && p.draw.number })}. ${p.draw && p.draw.skill ? p.draw.skill.kind + ' ' + p.draw.skill.name : ''}`);
      }
      break;
    }
    case 'bingo.detected':
      if (galaxy) galaxy.prewarm(); // the round ends: its decorated Souls Float next (D-29)
      if (guard.shouldCelebrate(`bingo:${envelope.roundId}`, guardMeta)) { pendingWinnerBurst = true; galaxyWinner(envelope.roundId); if (audio) audio.play('bingo', { fresh: true, sequence: envelope.sequence }); announce(t('public.winner.title')); }
      break;
    case 'result.published':
      if (galaxy) galaxy.prewarm();
      if (guard.shouldCelebrate(`winner:${envelope.roundId}`, guardMeta)) {
        pendingWinnerBurst = true;
        galaxyWinner(envelope.roundId, Array.isArray(p.winners) ? p.winners.map(w => w && w.soulId) : []);
        if (Array.isArray(p.winners) && p.winners.length && guard.shouldCelebrate(`bingo:${envelope.roundId}`, guardMeta) && audio) audio.play('bingo', { fresh: true, sequence: envelope.sequence });
      }
      break;
    case 'soul.float_accepted': {
      const entrance = p.entrance;
      if (!entrance || !galaxy) break;
      if (guard.shouldCelebrate(`float:${entrance.soulId}`, guardMeta)) {
        const at = entranceStartMs(envelope);
        scheduleAt(Number.isFinite(at) ? at : clockNow(), clockNow, () => galaxy.enter(entrance, { celebrate: true }));
        if (audio) audio.play('float_launch', { at: Number.isFinite(at) ? at : undefined, fresh: true, sequence: envelope.sequence });
      } else {
        galaxy.enter(entrance, { celebrate: false });
      }
      break;
    }
    default: break;
  }
  render({ celebrateDraw });
  if (needsSnapshot) scheduleRefresh();
}

function onStatus(status, info) {
  const prev = state.connection;
  state = { ...state, connection: status };
  if (status === 'open') {
    everOpen = true;
    if (info.connectionEpoch > 1) { track('client.reconnect', { audience: 'public' }); refreshSnapshot({ replaying: true }).catch(() => {}); }
  } else if ((status === 'reconnecting' || status === 'closed') && prev !== status && everOpen) {
    if (audio) audio.play('reconnect', { fresh: true });
    announce(exception('E12').copy); // D-36: no reconnect text on the big screen; screen readers still hear it
  }
  render();
}

// ---- boot --------------------------------------------------------------------------------------------------
async function boot() {
  mount(panelMain, h('p', { className: 'panel__body panel__muted', text: label('loading') }));
  try { await clock.sync(); clock.startAutoResync(60_000); } catch { /* countdown shows syncing copy through clockSync.isSynced */ }

  audio = createAudioManager({ app: 'public', clockNow, translate: t, onCaption: ({ id, caption }) => { if (caption && id !== 'reconnect') captionEl.textContent = caption; }, volume: 0.7 });
  audio.preload(PRELOAD_BY_APP.public);
  volume.value = String(Math.round(audio.state().volume * 100));

  try {
    const assets = await loadSceneAssets('/assets/scene');
    galaxy = createGalaxy({
      container: galaxyHost, assets, mode: rendererMode, quality, reducedMotion,
      onModeChange: (kind) => { modeEl.textContent = kind === 'three' || kind === 'webgl2' ? '' : kind === 'static' ? label('modeStatic') : label('mode2d'); document.body.dataset.renderer = kind; },
      onQualityChange: (q) => { track('client.renderer_mode', { quality: q }); },
    });
    await galaxy.start();
    new ResizeObserver(() => galaxy.resize()).observe(galaxyHost);
    window.__galaxy = galaxy; // rehearsal instrumentation only (frame stats)
  } catch (err) {
    console.error('[public] galaxy failed; panel continues', err);
    modeEl.textContent = label('modeStatic');
  }

  let snap = null;
  for (let attempt = 0; !snap; attempt++) {
    try { snap = await refreshSnapshot(); }
    catch (err) {
      mount(panelMain, h('p', { className: 'panel__body panel__muted', role: 'status', text: (err && err.exceptionId && exception(err.exceptionId)) ? exception(err.exceptionId).copy : label('error') }));
      await new Promise(r => setTimeout(r, Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4))));
    }
  }
  sse = createSseClient({ url: `/api/v1/events/${eventId}/stream`, since: snap.sequence, onEvent, onGap: () => refreshSnapshot({ replaying: true }).catch(() => {}), onStatus });
  sse.start();
  window.addEventListener('online', () => sse.reconnectNow());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sse.reconnectNow(); });

  setInterval(() => {
    const now = clockNow();
    panel.tick(now);
    const staleMs = lastServerMs ? Math.max(0, now - lastServerMs) : 0;
    const wasStale = state.staleMs > 10_000;
    state = { ...state, staleMs };
    if ((staleMs > 10_000) !== wasStale) render();
  }, 1000);
  setInterval(() => { api.get('/time').then(r => noteServerTime(r.serverTime)).catch(() => {}); }, 5000);
}

boot();

// D-51 (added by the 16-skill session): corner full-screen button + F key, hides the browser UI on the venue display.
mountFullscreenButton({ corner: 'left' }); // top-left, over the galaxy: the panel's sound button owns the top-right

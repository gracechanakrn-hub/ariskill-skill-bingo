// Stage dashboard entry (served at /stage). Read-only: GET snapshot + SSE stream with the stage token; no admin
// commands exist in this app. Snapshot -> applySnapshot -> SSE (since) -> reducer; reconnect/gap -> snapshot +
// acknowledge; celebrations only for live events (celebration guard + audio replay guards).
import { createStore, applySnapshot, applyEvent } from '/packages/ui/store.js';
import { createSseClient } from '/packages/ui/sse-client.js';
import { restoreReducedMotion, setReducedMotion, prefersReducedMotion, createCelebrationGuard } from '/packages/ui/motion.js';
import { createAudioManager } from '/packages/ui/audio.js';
import { track } from '/packages/ui/telemetry.js';
import { mountFullscreenButton } from '/packages/ui/fullscreen.js';
import { t, exception, BINGO_UNLOCK_DRAW } from '/packages/contracts/index.js';
import { readToken, saveToken, clearToken, readEventId, createStageApi, ApiError } from './api.js';
import { initialState, reduce, deriveView, changedTiles, isRoundEvent } from './state.js';
import { renderShell, renderDashboard, renderTokenPrompt, renderError, renderLoading, setConnection, setControls, setCaption, tick, announceDraw, announceWinners, announceState, ageSeconds } from './view.js';

const SNAPSHOT_REFRESH_MS = 15_000; // insights are computed server-side (2 s cache); refresh the whole snapshot
const CONTACT_POLL_MS = 5_000;      // cheap GET /time keeps the "last server contact" age honest between events
const TICK_MS = 250;

restoreReducedMotion();
const root = document.getElementById('app');
const eventId = readEventId();
let token = readToken();

let stage = null;       // { api, clockSync, fetchSnapshot, streamUrl }
let store = null;
let sse = null;
let guard = null;
let timers = [];
let sseStatus = 'connecting';
let lastEffects = null; // effects for the render triggered by the current event
let lastContactMs = 0;
const celebratedBingo = new Set();
const floated = new Set();

// ---- audio (muted by default; presenter footer has mute + volume) --------------------------------------------
const audio = createAudioManager({
  app: 'stage',
  startMuted: true,
  volume: 0.5,
  clockNow: () => (stage ? stage.clockSync.now() : Date.now()),
  translate: t,
  onCaption: ({ caption }) => setCaption(refs, caption),
});
audio.preload();
let audioUnlocked = false;
async function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const ok = await audio.unlock();
  if (ok) audio.startAmbient();
  else if (!audio.state().supported) setCaption(refs, exception('E14').copy);
}
document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
document.addEventListener('keydown', unlockAudio, { once: true });

// ---- shell ---------------------------------------------------------------------------------------------------
const refs = renderShell(root, {
  muted: audio.state().muted,
  volume: audio.state().volume,
  reducedMotion: prefersReducedMotion(),
  onMute: () => { const next = !audio.state().muted; audio.setMuted(next); setControls(refs, { muted: next }); if (!next) unlockAudio(); },
  onVolume: (v) => { audio.setMasterVolume(v); },
  onReducedMotion: () => { const next = !prefersReducedMotion(); setReducedMotion(next); setControls(refs, { reducedMotion: next }); backdrop.setReducedMotion(next); },
});
document.title = t('app.title');

// ---- ambient backdrop (D-47): the Blender cinematic sky (art/sky*.{jpg,webp}) is plain CSS layers in index.html, the
// same scene as the phone; the older Three.js forest (src/backdrop.js) is no longer mounted. Reduced motion is CSS only.
const backdrop = { mode: 'layers', setReducedMotion() {}, dispose() {} };
document.documentElement.setAttribute('data-backdrop', 'layers');

// ---- boot ----------------------------------------------------------------------------------------------------
function clearTimers() { for (const id of timers) clearInterval(id); timers = []; }

function showTokenPrompt(error = null) {
  clearTimers();
  if (sse) { sse.stop(); sse = null; }
  setConnection(refs, { status: 'idle', stale: false, ageS: null });
  renderTokenPrompt(refs, { error, onSubmit: (value) => { token = value; saveToken(value); boot(); } });
}

async function boot() {
  clearTimers();
  if (sse) { sse.stop(); sse = null; }
  if (!token) { showTokenPrompt(); return; }
  renderLoading(refs);
  stage = createStageApi({ getToken: () => token, eventId });
  store = createStore(initialState());
  let snapshot;
  try {
    const [snap] = await Promise.all([stage.fetchSnapshot(), stage.clockSync.sync().catch(() => null)]);
    snapshot = snap;
  } catch (err) {
    if (err instanceof ApiError && err.isAuth) { clearToken(); token = null; showTokenPrompt(exception('E9').copy); return; }
    renderError(refs, { text: err instanceof ApiError && err.exceptionId ? exception(err.exceptionId).copy : exception('E12').copy, onRetry: boot });
    setConnection(refs, { status: 'closed', stale: false, ageS: null });
    timers.push(setInterval(() => { clearTimers(); boot(); }, 5_000));
    return;
  }
  lastContactMs = Date.now();
  sse = createSseClient({
    url: stage.streamUrl(),
    getToken: () => token,
    since: snapshot.sequence,
    onEvent,
    onGap: () => refreshSnapshot('gap'),
    onStatus,
  });
  guard = createCelebrationGuard({ getConnectionEpoch: () => (sse ? sse.connectionEpoch : 0) });
  audio.setConnectionEpoch(snapshot.sequence);
  store.subscribe(onStoreChange);
  applySnapshot(store, snapshot);
  guard.markSnapshotApplied(snapshot.sequence);
  sse.start();
  timers.push(setInterval(() => refreshSnapshot('periodic'), SNAPSHOT_REFRESH_MS));
  timers.push(setInterval(pollContact, CONTACT_POLL_MS));
  timers.push(setInterval(onTick, TICK_MS));
  window.addEventListener('online', () => sse && sse.reconnectNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sse) sse.reconnectNow(); });
}

async function refreshSnapshot(reason) {
  if (!stage || !store) return;
  try {
    audio.setReplaying(true);
    const snap = await stage.fetchSnapshot();
    lastContactMs = Date.now();
    lastEffects = { live: false };
    applySnapshot(store, snap);
    guard.markSnapshotApplied(snap.sequence);
    audio.setConnectionEpoch(snap.sequence);
    if (sse) sse.acknowledgeSnapshot(snap.sequence);
    if (reason !== 'periodic') track('client.reconnect', { audience: 'stage', reason });
  } catch (err) {
    if (err instanceof ApiError && err.isAuth) { clearToken(); token = null; showTokenPrompt(exception('E9').copy); }
  } finally {
    audio.setReplaying(false);
  }
}

async function pollContact() {
  if (!stage) return;
  try { await stage.fetchTime(); lastContactMs = Date.now(); } catch { /* staleness surfaces via the footer pill */ }
}

// ---- realtime ------------------------------------------------------------------------------------------------
function onEvent(envelope, meta) {
  if (!store) return;
  const prev = store.get();
  const live = meta.replay !== true;
  const effects = { live, drawArrival: false, winnerBurst: false };
  const key = `${envelope.type}:${envelope.sequence}`;
  const celebrate = (k) => guard.shouldCelebrate(k, { connectionEpoch: meta.connectionEpoch, replay: meta.replay, sequence: envelope.sequence });
  if (envelope.type === 'draw.accepted' && envelope.payload?.draw) {
    const d = envelope.payload.draw;
    if (celebrate(`draw:${d.drawId || d.number}`)) {
      effects.drawArrival = true;
      audio.play('draw_reveal', { vars: { number: d.number }, sequence: envelope.sequence });
      if (d.number === BINGO_UNLOCK_DRAW) audio.play('draw5_unlock', { sequence: envelope.sequence });
    }
  } else if (envelope.type === 'bingo.detected') {
    const roundKey = envelope.roundId || 'round';
    if (celebrate(`bingo:${roundKey}`) && !celebratedBingo.has(roundKey)) { celebratedBingo.add(roundKey); audio.play('bingo', { sequence: envelope.sequence }); }
  } else if (envelope.type === 'result.published') {
    const roundKey = envelope.roundId || 'round';
    if (celebrate(`result:${roundKey}`)) {
      effects.winnerBurst = true;
      if (!celebratedBingo.has(roundKey) && (envelope.payload?.winners || []).length) { celebratedBingo.add(roundKey); audio.play('bingo', { sequence: envelope.sequence }); }
    }
  } else if (envelope.type === 'soul.float_accepted') {
    const soulId = envelope.payload?.entrance?.soulId;
    if (soulId && !floated.has(soulId) && celebrate(`float:${soulId}`)) { floated.add(soulId); audio.play('float_launch', { sequence: envelope.sequence }); }
  } else if (envelope.type === 'system.snapshot_required') {
    return; // sse-client already called onGap -> refreshSnapshot
  }
  lastContactMs = Date.now();
  lastEffects = effects;
  const res = applyEvent(store, envelope, reduce);
  if (res.applied && live) {
    const next = store.get();
    if (envelope.type === 'draw.accepted') announceDraw(deriveView(next).status.hero);
    else if (envelope.type === 'result.published') announceWinners(deriveView(next));
    else if (isRoundEvent(envelope.type) && (prev.round?.state ?? null) !== (next.round?.state ?? null)) announceState(deriveView(next));
    // Round lifecycle changes may change which round is "current": reconcile with the server projection.
    if (['round.created', 'round.closed', 'round.cancelled', 'round.exhausted', 'round.registration_opened'].includes(envelope.type)) refreshSnapshot('round-change');
  }
  void key;
}

function onStatus(status, { connectionEpoch, error }) {
  sseStatus = status;
  if (status === 'open' && connectionEpoch > 1) refreshSnapshot('reconnect');
  if (status === 'reconnecting') audio.play('reconnect', { fresh: true });
  if (status === 'closed' && error && (error.status === 401 || error.status === 403)) { clearToken(); token = null; showTokenPrompt(exception('E9').copy); return; }
  updateConnection();
}

function currentView() { return deriveView(store.get(), { nowMs: stage.clockSync.now() }); }

function onStoreChange(next, prev) {
  const effects = lastEffects || { live: false };
  lastEffects = null;
  const changed = changedTiles(prev, next);
  const vm = currentView();
  renderDashboard(refs, vm, { changed, effects, nowMs: stage.clockSync.now(), synced: stage.clockSync.isSynced });
  updateConnection(vm);
}

function updateConnection(vm = null) {
  if (!store || !stage) return;
  const nowMs = Date.now();
  const contactAge = lastContactMs ? Math.round((nowMs - lastContactMs) / 1000) : null;
  const serverAge = vm ? ageSeconds(vm.serverTime, stage.clockSync.now()) : null;
  const stale = contactAge !== null && contactAge > 10;
  setConnection(refs, { status: sseStatus, stale, ageS: stale ? Math.max(contactAge, serverAge ?? 0) : contactAge });
}

function onTick() {
  if (!store || !stage) return;
  const vm = currentView();
  tick(refs, vm, { nowMs: stage.clockSync.now(), synced: stage.clockSync.isSynced });
  updateConnection(vm);
}

mountFullscreenButton(); // D-51: corner button + F key; hides the browser UI on the venue screen
boot();

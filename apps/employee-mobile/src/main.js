// apps/employee-mobile/src/main.js - bootstrap and orchestration for /play (AriSkill Skill Bingo, employee mobile).
// Server-authoritative: every screen is a projection of /me + /me/stream (docs/ux/canonical-flow.md section 1).
// Structure: state.js (pure reducers), api.js, audio-motion.js, views/*.js (one module per screen), this file (wiring).
import { createStore } from '/packages/ui/store.js';
import { createSseClient } from '/packages/ui/sse-client.js';
import { h, mount, announce } from '/packages/ui/dom.js';
import { track } from '/packages/ui/telemetry.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t } from '/packages/contracts/index.js';
import { createParticipantApi, ApiError, newIdempotencyKey, eventIdFromToken } from './api.js';
import { createAudioMotion } from './audio-motion.js';
import { cleanGreeting } from '/packages/game-rules/src/greeting.js';
import {
  initialState, applyParticipantSnapshot, reduceEvent, reconcileDraft, placeBoard, sameSet,
  addSkill, removeSkill, undoSelection, screenFor, editableRound, saveBlockedReason, shouldAutoFinalize, applySaveResponse, REQUIRED_SELECTIONS,
} from './state.js';
import { tl, exceptionCopy } from './views/common.js';
import { mountLanding } from './views/landing.js';
import { mountJoin } from './views/join.js';
import { mountProfile } from './views/profile.js';
import { mountSelect } from './views/select.js';
import { mountBoard } from './views/board.js';
import { mountPlaying } from './views/playing.js';
import { mountResult } from './views/result.js';
import { mountSoul } from './views/soul.js';
import { createBackdrop } from './backdrop.js';
import { prefetchThree, prefetchSoulBody, prefetchSoulDecor, prefetchWinnerCrown } from './scene/loader.js';
import { sparseStreamLiveness, createGapTracker } from './liveness.js';

// Persistence lives in localStorage keyed by event (+ participant) so a QR re-scan or a closed tab keeps the
// session and an in-progress draft (F-01). Legacy sessionStorage keys are migrated once.
const SESSION_KEY = (evt) => `ariskill.play.session:${evt}`;
const LAST_EVENT_KEY = 'ariskill.play.lastEvent';
const DRAFT_KEY = (evt, participantId) => `ariskill.play.draft:${evt}:${participantId}`;
const FLOAT_KEY = (soulId) => `ariskill.play.floatKey:${soulId}`;
const RESULT_SEEN_KEY = (roundId) => `ariskill.play.resultSeen:${roundId}`;
const DEVICE_REF_KEY = 'ariskill.play.deviceRef';
const SAVE_DEBOUNCE_MS = 400;
const NO_ROUND_REFRESH_MS = 20_000;
const TOAST_MS = 8000;

// ---- storage helpers (storage may be unavailable in private modes) -------------------------------------
const storage = {
  get(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
function migrateLegacySession() {
  try {
    const raw = sessionStorage.getItem('ariskill.play.session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.eventId && s.sessionToken) { storage.set(SESSION_KEY(s.eventId), s); storage.set(LAST_EVENT_KEY, s.eventId); }
    sessionStorage.removeItem('ariskill.play.session');
    return s && s.eventId ? s : null;
  } catch { return null; }
}

// ---- bootstrap ---------------------------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const joinToken = params.get('t');
migrateLegacySession();
const eventId = joinToken ? eventIdFromToken(joinToken) : (storage.get(LAST_EVENT_KEY) || eventIdFromToken(null));
const storedSession = storage.get(SESSION_KEY(eventId));
const session = storedSession && storedSession.sessionToken && (!storedSession.expiresAt || Date.parse(storedSession.expiresAt) > Date.now()) ? storedSession : null;

const store = createStore({ ...initialState(), joinToken, session });
const api = createParticipantApi({ getToken: () => (store.get().session ? store.get().session.sessionToken : null) });
const clockNow = () => api.clockSync.now();
let sse = null;
const audioMotion = createAudioMotion({ clockNow, getConnectionEpoch: () => (sse ? sse.connectionEpoch : 0) });
// Cinematic sky (D-41): Blender layers + CSS motion live in index.html / app.css; the canvas adds a few twinkling stars
// on top (no aurora band, no motes). Everything is static under reduced motion.
createBackdrop(document.querySelector('.cosmos__stars'), { aurora: false, fireflies: false, starCount: 45 });
// Sparse participant stream: gap -> snapshot acknowledgement window (see src/liveness.js).
const gaps = createGapTracker();

let taxonomy = null;
let view = null;
let viewScreen = null;
let saveTimer = null;
let pendingSave = null;      // { key, skillIds }
let pendingFinalize = null;  // { key, version }
let staleRetries = 0;
let autoFinalizedFor = null;
let insightLoadingFor = null;
let noRoundTimer = null;
let selectionStartedAt = null;
let disconnectedAt = null;
let refreshing = null;

const root = document.getElementById('main');
const headerRight = document.getElementById('header-status');
const bannerHost = document.getElementById('banner');
const toastRegion = document.getElementById('toasts');

function patchUi(patch) { store.set((s) => ({ ...s, ui: { ...s.ui, ...patch } })); }

// ---- toasts ------------------------------------------------------------------------------------------------
function toast(idOrText, { tone = 'danger', ms = TOAST_MS } = {}) {
  const text = exceptionCopy(idOrText, idOrText);
  const el = h('div', { className: `toast toast--${tone}`, role: 'status' },
    h('span', { className: 'toast__icon', 'aria-hidden': 'true' }, tone === 'danger' ? '!' : 'i'),
    h('div', { className: 'toast__body' }, text),
    h('button', { type: 'button', className: 'toast__close', 'aria-label': tl('ui.dismiss'), onClick: () => el.remove() }, '×'));
  toastRegion.appendChild(el);
  animateOnce(el, 'm-fade', { durationMs: MOTION.interactions.fade.ms });
  if (ms > 0) setTimeout(() => { if (el.isConnected) el.remove(); }, ms);
  if (tone === 'danger') audioMotion.cueError();
  return el;
}

// ---- header / banner ---------------------------------------------------------------------------
function renderChrome(state) {
  const pills = [];
  if (state.session && state.participant) {
    const status = state.connection;
    if (!state.clockSynced) pills.push(h('span', { className: 'pill pill--connecting', role: 'status' }, t('syncing')));
    else if (status === 'reconnecting' || (status === 'connecting' && disconnectedAt)) pills.push(h('span', { className: 'pill pill--reconnecting' }, t('reconnect')));
  }
  mount(headerRight, pills);
  const showReconnect = state.session && state.participant && (state.connection === 'reconnecting' || (state.connection === 'connecting' && disconnectedAt));
  mount(bannerHost, showReconnect ? h('div', { className: 'banner banner--reconnecting', role: 'status' }, h('span', { className: 'banner__icon', 'aria-hidden': 'true' }), h('div', { className: 'banner__body' }, t('reconnect'))) : null);
}


// ---- rendering -----------------------------------------------------------------------------------------
const VIEWS = {
  landing: (r, c) => mountLanding(r, c),
  join: (r, c) => mountJoin(r, c),
  loading: (r) => ({ update() { mount(r, h('p', { className: 'placeholder muted', role: 'status' }, tl('ui.loading'))); }, effect() {}, unmount() { mount(r, null); } }),
  profile: (r, c) => mountProfile(r, c),
  select: (r, c) => mountSelect(r, c),
  board: (r, c) => mountBoard(r, c, 'board'),
  locked: (r, c) => mountBoard(r, c, 'locked'),
  deferred: (r, c) => mountBoard(r, c, 'deferred'),
  playing: (r, c) => mountPlaying(r, c),
  result: (r, c) => mountResult(r, c),
  soul: (r, c) => mountSoul(r, c, 'soul'),
  floated: (r, c) => mountSoul(r, c, 'floated'),
};

const ctx = {
  clockNow,
  clockSynced: () => api.clockSync.isSynced,
  audioMotion,
  roleName: (roleId) => (taxonomy && roleId ? (taxonomy.roles.find((r) => r.id === roleId) || {}).name || null : null),
  actions: {},
};

/** Screens that share one view instance (so the Float launch is not cut by a remount). */
const VIEW_KEY = { floated: 'soul' };

let lastRendered = null;
function render(state) {
  const screen = screenFor(state);
  const key = VIEW_KEY[screen] || screen;
  root.dataset.screen = screen;
  if (key !== viewScreen) {
    if (view) view.unmount();
    const first = viewScreen === null;
    viewScreen = key;
    view = VIEWS[key](root, ctx);
    view.update(state, undefined);
    if (!first) root.focus({ preventScroll: true }); // new screen: focus the main landmark (never inside a live update)
  } else {
    view.update(state, lastRendered);
  }
  lastRendered = state;
  renderChrome(state);
  afterRender(state);
}
store.subscribe(render);

function dispatchEffect(effect) { if (view) view.effect(effect); }

/** Side effects driven by state (idempotent). */
function afterRender(state) {
  const screen = screenFor(state);
  // Warm the vendored Three.js module cache while the round plays so the Soul reveal opens instantly (idle import;
  // the initial load never waits for it).
  if (screen === 'playing' || screen === 'locked' || screen === 'result') prefetchThree();
  // The round-end Soul config is known on the result screen: warm its own models too - the v3 body of a v3 Soul (D-31)
  // and its charm / face models (D-29, D-31) - so the reveal opens decorated without waiting on the network.
  if ((screen === 'result' || screen === 'soul') && state.soul && state.soul.config) { prefetchSoulBody(state.soul.config); prefetchSoulDecor(state.soul.config); if (state.soul.badge) prefetchWinnerCrown(); }
  // Auto-finalize a server DRAFT that already holds 16 (reassigned deferred board or resumed session).
  if (screen === 'select' && shouldAutoFinalize(state) && autoFinalizedFor !== `${state.board.boardId}:${state.board.version}`) {
    autoFinalizedFor = `${state.board.boardId}:${state.board.version}`;
    finalizeBoard(state.board.version);
  }
  // Private insight, fetched only when the server says it is available.
  if ((screen === 'soul' || screen === 'floated' || screen === 'result') && state.insightAvailable && !state.insight && state.board && insightLoadingFor !== state.board.roundId) {
    insightLoadingFor = state.board.roundId;
    loadInsight();
    if (!taxonomy) loadTaxonomy().catch(() => {});
  }
  // No round / stale round: refresh /me every 20 s while the page is open (E1 recovery).
  const needsPolling = state.session && state.participant && (screen === 'select' || screen === 'board' || screen === 'deferred' || screen === 'floated') && !editableRound(state, clockNow());
  if (needsPolling && !noRoundTimer) noRoundTimer = setInterval(() => refreshMe().catch(() => {}), NO_ROUND_REFRESH_MS);
  if (!needsPolling && noRoundTimer) { clearInterval(noRoundTimer); noRoundTimer = null; }
  if (state.session && state.participant) persistDraft(state);
}

// ---- session ---------------------------------------------------------------------------------------------
/**
 * The phone's own participant reference (D-40: no employee-ID field). Random, created once, kept in localStorage so a
 * re-opened link on the same phone resumes the same seat; the server only ever stores its HMAC (employeeRefHash).
 */
function deviceRef() {
  let ref = storage.get(DEVICE_REF_KEY);
  if (typeof ref !== 'string' || !ref) {
    ref = `device-${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)}`;
    storage.set(DEVICE_REF_KEY, ref);
  }
  return ref;
}

async function join({ employeeRef = deviceRef(), displayName, consentPublicName }) {
  audioMotion.unlock(); // inside the tap (autoplay policy)
  track('client.join_started', { eventId });
  const tokenEvent = eventIdFromToken(store.get().joinToken);
  try {
    const res = await api.createSession(tokenEvent, { joinToken: store.get().joinToken, employeeRef, displayName, consentPublicName });
    const s = { sessionToken: res.sessionToken, participantId: res.participantId, eventId: res.eventId, expiresAt: res.expiresAt };
    storage.set(SESSION_KEY(s.eventId), s);
    storage.set(LAST_EVENT_KEY, s.eventId);
    store.set({ session: s, joinError: null });
    await start();
  } catch (err) {
    const id = err instanceof ApiError && err.exceptionId ? err.exceptionId : null;
    if (id === 'E2' || (err instanceof ApiError && err.code === 'TOKEN_EXPIRED')) { store.set({ joinError: 'E2' }); toast('E2'); }
    else toast(id || (err && err.message) || 'E2');
  }
}

function dropSession(reason) {
  storage.del(SESSION_KEY(eventId));
  if (sse) { sse.stop(); sse = null; }
  store.set({ ...initialState(), joinToken: store.get().joinToken, joinError: reason || null });
}

// ---- snapshot + stream -----------------------------------------------------------------------------------
async function refreshMe() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const prev = store.get();
    audioMotion.beginReplay(prev.sequence);
    try {
      const snap = await api.me();
      let next = applyParticipantSnapshot(prev, snap);
      next = restoreDraft(next);
      if (next.board && next.board.state === 'FINISHED' && storage.get(RESULT_SEEN_KEY(next.board.roundId))) next = { ...next, ui: { ...next.ui, resultSeen: true } };
      store.set(next);
      audioMotion.markSnapshotApplied(next.sequence);
      if (sse) sse.acknowledgeSnapshot(next.sequence);
      gaps.onAcknowledged(sse ? sse.connectionEpoch : 1);
      if (next.ui.draftDirty) scheduleSave();
      return next;
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) { dropSession('E2'); toast('E2'); }
      else if (err instanceof ApiError && err.exceptionId) toast(err.exceptionId);
      else toast(t('reconnect'), { tone: 'warning' });
      throw err;
    } finally { audioMotion.endReplay(); refreshing = null; }
  })();
  return refreshing;
}

function handleEnvelope(envelope, meta) {
  const st = store.get();
  const seq = Number(envelope && envelope.sequence);
  if (!Number.isFinite(seq) || seq <= st.sequence) return;
  const { state: next, effects } = reduceEvent(st, envelope);
  store.set({ ...next, sequence: seq });
  // D-53: the admin deleted a round or cleared the event; the server snapshot says what is left (after a clear the
  // session no longer exists, so refreshMe drops back to the join screen).
  if (envelope.type === 'round.deleted' || envelope.type === 'event.reset') { refreshMe().catch(() => {}); return; }
  // The participant stream skips sequence numbers by design (events are numbered across audiences), which the shared
  // sse-client reports as a gap + replay. Keep its snapshot refetch, but decide liveness here (src/liveness.js) so a
  // genuinely new event of the acknowledged epoch still celebrates and announces; backlog after a reconnect does not.
  const liveness = sparseStreamLiveness({ ...meta, sequence: seq }, { currentEpoch: sse ? sse.connectionEpoch : 0, ackedEpoch: gaps.ackedEpoch, gapPending: gaps.gapPending, snapshotSequence: audioMotion.guard.snapshotSequence() });
  const replay = liveness.live ? false : !!meta.replay;
  if (liveness.sparse) audioMotion.endReplay(); // the gap refetch in flight must not mute this live event's cues
  for (const e of effects) {
    const live = audioMotion.allow(e.key, { ...meta, sequence: seq, replay });
    if (e.type === 'draw' && !replay) announce(`${t('play.draw', { number: e.draw.number })}: ${e.draw.skill.name}. ${t('play.matched', { count: e.matchedCount })}`, { politeness: 'polite' });
    if (e.type === 'result' && !replay) announce(e.isWinner ? `${t('result.bingo')}. ${t('result.winner', { draw: store.get().result ? store.get().result.winningDrawNumber : '' })}` : `${t('result.roundComplete')}. ${t('result.notWinner')}`, { politeness: 'polite' });
    if (e.type === 'deferred' && !replay) announce(e.reason === 'cancelled' ? exceptionCopy('E15') : e.reason === 'late' ? exceptionCopy('E8') : t('board.deferred'), { politeness: 'polite' });
    if (e.type === 'lock' && !replay) announce(t('play.waitingStart'), { politeness: 'polite' });
    dispatchEffect({ ...e, live, replay });
  }
  // A kept local draft (E1 / E8 / E15 / E6) is re-PUT as soon as the server set differs and a round accepts saves.
  if (/^(board\.saved|board\.ready|round\.)/.test(envelope.type) && store.get().ui.draftDirty) scheduleSave();
}

function startStream(sinceSequence) {
  if (sse) sse.stop();
  sse = createSseClient({
    url: api.streamUrl,
    getToken: () => (store.get().session ? store.get().session.sessionToken : null),
    since: sinceSequence,
    onEvent: handleEnvelope,
    onGap: () => { gaps.onGap(); refreshMe().catch(() => {}); },
    onStatus: (status, info) => {
      const prev = store.get().connection;
      store.set({ connection: status });
      if (status === 'reconnecting' && !disconnectedAt) disconnectedAt = Date.now();
      if (status === 'open' && info.connectionEpoch > 1) {
        const gapSize = Math.max(0, store.get().sequence - (info.resumedFrom ?? store.get().sequence));
        track('client.reconnect', { audience: 'participant', gapSize, durationMs: disconnectedAt ? Date.now() - disconnectedAt : 0 });
        disconnectedAt = null;
        refreshMe().catch(() => {});
      }
      if (status === 'closed' && sse && sse.stoppedReason && [401, 403].includes(sse.stoppedReason.status)) { dropSession('E2'); toast('E2'); }
      if (prev !== status) renderChrome(store.get());
    },
  });
  sse.start();
}

async function start() {
  const st = store.get();
  if (!st.session) return;
  try { await api.clockSync.sync(); } catch { /* E7: stays unsynced until a response feeds the clock */ }
  store.set({ clockSynced: api.clockSync.isSynced });
  api.clockSync.subscribe(({ synced }) => { if (store.get().clockSynced !== synced) store.set({ clockSynced: synced }); });
  api.clockSync.startAutoResync(60_000);
  try {
    const next = await refreshMe();
    startStream(next.sequence);
  } catch { /* handled in refreshMe */ }
}

// ---- profile ------------------------------------------------------------------------------------------------
async function loadTaxonomy() { taxonomy = await api.taxonomy(); return taxonomy; }
async function setProfile(platformId, roleId) {
  try {
    const res = await api.setProfile(platformId, roleId);
    track('client.profile_completed', { platformId, roleId });
    store.set({ participant: res.participant });
    selectionStartedAt = Date.now();
    await refreshMe();
  } catch (err) { toast(err instanceof ApiError && err.exceptionId ? err.exceptionId : 'E3'); }
}

// ---- selection + autosave (M-04, M-05, M-06) --------------------------------------------------------------
function persistDraft(state) {
  const pid = state.session.participantId;
  storage.set(DRAFT_KEY(state.session.eventId || eventId, pid), { skillIds: state.ui.draft, roundId: state.ui.draftRoundId, dirty: state.ui.draftDirty, at: Date.now() });
}
/** After a snapshot: a dirty local draft (E6 recovery / offline edits) wins over the server set and is re-PUT. */
function restoreDraft(state) {
  const pid = state.session && state.session.participantId;
  const saved = pid ? storage.get(DRAFT_KEY(state.session.eventId || eventId, pid)) : null;
  if (!saved || !saved.dirty || !Array.isArray(saved.skillIds)) return state;
  if (saveBlockedReason(state, clockNow())) return state; // nothing accepts saves right now; keep the stored draft
  const editable = editableRound(state, clockNow()) || state.round;
  if (!editable) return state;
  const server = state.board && Array.isArray(state.board.selectedSkillIds) ? state.board.selectedSkillIds : [];
  if (sameSet(saved.skillIds, server)) return state;
  return { ...state, ui: { ...state.ui, draft: saved.skillIds.slice(0, REQUIRED_SELECTIONS), draftDirty: true, draftRoundId: editable.roundId } };
}

function boardVersionFor(state) {
  const editable = editableRound(state, clockNow());
  if (state.board && editable && state.board.roundId === editable.roundId) return state.board.version;
  return 0;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; performSave().catch(() => {}); }, SAVE_DEBOUNCE_MS);
}

async function performSave() {
  const st = store.get();
  if (!st.ui.draftDirty || !st.session) return;
  if (saveBlockedReason(st, clockNow())) return; // keep the local draft; the select view shows why (E1/E8/E15)
  const skillIds = st.ui.draft.slice();
  const version = boardVersionFor(st);
  const key = pendingSave && sameSet(pendingSave.skillIds, skillIds) ? pendingSave.key : newIdempotencyKey();
  pendingSave = { key, skillIds };
  try {
    const res = await api.saveSelections(skillIds, version, key);
    staleRetries = 0;
    const applied = applySaveResponse(store.get(), res);
    store.set(applied.state);
    if (applied.late) {
      // F-01: late save accepted as a DEFERRED (late) board for the next round. The deferred screen shows the E8 copy.
      pendingSave = null;
      patchUi({ draftDirty: false, saveError: null, saveNotice: null, draftRoundId: res.board.roundId });
      announce(applied.notice || exceptionCopy('E8'), { politeness: 'polite' });
      return;
    }
    const now = store.get();
    if (sameSet(now.ui.draft, skillIds)) {
      patchUi({ draftDirty: false, saveError: null, saveNotice: null, draftRoundId: res.board.roundId });
      pendingSave = null;
      if (skillIds.length === REQUIRED_SELECTIONS && res.board.state === 'DRAFT') await finalizeBoard(res.resultingVersion);
    } else scheduleSave();
  } catch (err) {
    if (err instanceof ApiError && err.isStaleVersion) {
      if (err.staleSnapshot) applyBoardResponse(err.staleSnapshot, { reconcile: false });
      if (staleRetries++ < 2) scheduleSave(); else { patchUi({ saveError: 'E6' }); toast('E6'); }
      return;
    }
    if (err instanceof ApiError && err.code === 'ROUND_LOCKED') {
      // Older backend (before F-01) still rejects late saves: keep the local draft and show the E8 / E1 copy.
      pendingSave = null;
      patchUi({ saveNotice: exceptionCopy(err.exceptionId || 'E8', err.message) });
      refreshMe().catch(() => {});
      return;
    }
    if (err instanceof ApiError && err.code === 'DUPLICATE_SKILL') { patchUi({ draft: [...new Set(skillIds)] }); toast('E4'); scheduleSave(); return; }
    if (err instanceof ApiError && err.code === 'PROFILE_REQUIRED') { toast('E16'); refreshMe().catch(() => {}); return; }
    patchUi({ saveError: 'E6' });
    toast('E6');
  }
}

function applyBoardResponse(board, { reconcile = true } = {}) {
  if (!board) return;
  store.set((s) => {
    if (s.board && s.board.boardId === board.boardId && s.board.version > board.version) return s;
    const placed = placeBoard(s, board);
    return reconcile ? reconcileDraft(placed) : placed;
  });
}

async function finalizeBoard(version) {
  const st = store.get();
  const key = pendingFinalize && pendingFinalize.version === version ? pendingFinalize.key : newIdempotencyKey();
  pendingFinalize = { key, version };
  try {
    const res = await api.finalize(version, key);
    pendingFinalize = null;
    track('client.board_finalized', { elapsedMs: selectionStartedAt ? Date.now() - selectionStartedAt : 0 });
    applyBoardResponse(res.board);
    patchUi({ finalizeError: null, editing: false });
    announce(t('board.complete'), { politeness: 'polite' });
  } catch (err) {
    if (err instanceof ApiError && err.isStaleVersion) {
      if (err.staleSnapshot) applyBoardResponse(err.staleSnapshot);
      const b = store.get().board;
      if (b && b.state === 'DRAFT' && b.selectedSkillIds.length === REQUIRED_SELECTIONS && staleRetries++ < 2) return finalizeBoard(b.version);
    }
    if (err instanceof ApiError && err.code === 'ROUND_LOCKED') { refreshMe().catch(() => {}); return; }
    patchUi({ finalizeError: 'E18' });
    toast('E18');
    void st;
  }
}

function tapSkill(skillId) {
  const st = store.get();
  const r = addSkill(st, skillId);
  if (!r.changed) { if (r.reason === 'duplicate') toast('E4', { tone: 'info', ms: 3000 }); return; }
  store.set({ ...r.state, ui: { ...r.state.ui, picking: true } });
  if (!selectionStartedAt) selectionStartedAt = Date.now();
  track('client.selection_progress', { count: r.count, elapsedMs: Date.now() - selectionStartedAt });
  scheduleSave();
}
function removeSelected(skillId) {
  const r = removeSkill(store.get(), skillId);
  if (!r.changed) return;
  store.set(r.state);
  track('client.selection_progress', { count: r.count, elapsedMs: selectionStartedAt ? Date.now() - selectionStartedAt : 0 });
  scheduleSave();
}
function undo() {
  const r = undoSelection(store.get());
  if (!r.changed) return;
  store.set(r.state);
  scheduleSave();
}
function retrySave() { patchUi({ saveError: null, draftDirty: true }); performSave().catch(() => {}); }
function retryFinalize() {
  const b = store.get().board;
  patchUi({ finalizeError: null });
  if (b && b.state === 'DRAFT') finalizeBoard(b.version);
  else scheduleSave();
}
function startEditing() {
  const st = store.get();
  const server = st.board ? st.board.selectedSkillIds.slice() : [];
  store.set({ ...st, ui: { ...st.ui, editing: true, picking: true, pickStep: 1, readyAck: false, draft: server, undo: null, draftDirty: false, draftRoundId: st.board ? st.board.roundId : st.ui.draftRoundId } });
}
function stopEditing() { patchUi({ editing: false, picking: false }); }
/** Picker question change (D-35); the view decides when question 3 is skipped (nextPickStep). */
function setPickStep(step) { patchUi({ pickStep: step, picking: true }); }
/**
 * "Review board": leave the picker for the shuffled board. The server finalizes (and shuffles) as soon as a save holds
 * 16, so this only flushes a pending save or retries a finalize that has not happened yet.
 */
function reviewBoard() {
  const st = store.get();
  patchUi({ picking: false, editing: false, readyAck: false, justShuffled: !audioMotion.isReduced() });
  if (st.ui.draftDirty) { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } performSave().catch(() => {}); return; }
  const b = st.board;
  if (b && b.state === 'DRAFT' && b.selectedSkillIds.length === REQUIRED_SELECTIONS && !pendingFinalize) finalizeBoard(b.version);
}
function consumeShuffled() { patchUi({ justShuffled: false }); }
/** Landing Start (D-39): also the first tap, so the audio unlock (autoplay policy) happens here. */
function enterJoin() { audioMotion.unlock(); patchUi({ landingDone: true }); }
function readyAck() { patchUi({ readyAck: true }); announce(t('board.readyDone'), { politeness: 'polite' }); }
function startNextRound(round = null) {
  const st = store.get();
  const next = round || st.nextRound || editableRound(st, clockNow());
  if (!next) return;
  store.set({ ...st, ui: { ...st.ui, draft: [], undo: null, draftDirty: false, draftRoundId: next.roundId, editing: false, picking: true, pickStep: 1, readyAck: false } });
  selectionStartedAt = Date.now();
}

// ---- insight + Soul + Float (M-12, M-13) ------------------------------------------------------------------
async function loadInsight() {
  try { const res = await api.insight(); store.set({ insight: { roundId: res.roundId, matrixVersion: res.matrixVersion, inMatrixCount: res.inMatrixCount, beyondMatrixCount: res.beyondMatrixCount, totalSelected: res.totalSelected } }); }
  catch { insightLoadingFor = null; }
}
function revealSoul() {
  const b = store.get().board;
  if (b) storage.set(RESULT_SEEN_KEY(b.roundId), true); // a reload returns to the Soul, not the result
  patchUi({ resultSeen: true, soulRevealed: false });
}
function soulRevealed() { patchUi({ soulRevealed: true }); }
function floatStart() { patchUi({ floating: true, floatError: null }); }
// Float greeting (D-42): kept outside the store so typing never re-renders the screen; sent with the Float request.
let floatGreeting = '';
function setFloatGreeting(text) { floatGreeting = typeof text === 'string' ? text : ''; }
async function floatNow() {
  const st = store.get();
  const soul = st.soul;
  if (!soul || soul.floated) return;
  if (!soul.floatToken) { patchUi({ floating: false, floatError: 'E13' }); toast('E13'); return; }
  const keyName = FLOAT_KEY(soul.soulId);
  let key = storage.get(keyName);
  if (!key) { key = newIdempotencyKey(); storage.set(keyName, key); }
  patchUi({ floating: true, floatError: null });
  try {
    const res = await api.float(soul.soulId, soul.floatToken, key, cleanGreeting(floatGreeting) || null);
    track('client.float_result', { accepted: !!res.accepted, replay: !!res.replay });
    store.set((s) => ({ ...s, soul: s.soul ? { ...s.soul, floated: true, floatToken: null } : s.soul, ui: { ...s.ui, floating: false, floatError: null, floatDigit: null } }));
    const live = !res.replay && audioMotion.allow(`float:${soul.soulId}`, { connectionEpoch: sse ? sse.connectionEpoch : 0, replay: !!res.replay });
    dispatchEffect({ type: 'float', key: `float:${soul.soulId}`, entrance: res.entrance, live, replay: !!res.replay });
    announce(t('soul.floated'), { politeness: 'polite' });
  } catch (err) {
    track('client.float_result', { accepted: false, replay: false });
    // A rejected greeting (E24) did not spend the token: drop the key so the edited message is a new request.
    if (err instanceof ApiError && err.code === 'GREETING_REJECTED') storage.del(keyName);
    patchUi({ floating: false, floatError: (err instanceof ApiError && err.exceptionId) || 'E13' });
    toast((err instanceof ApiError && err.exceptionId) || 'E13');
  }
}

// ---- wire actions and go -------------------------------------------------------------------------------------
Object.assign(ctx.actions, {
  join, loadTaxonomy, setProfile,
  discovery: (mode, q, limit) => api.discovery({ mode, q, limit }),
  tapSkill, removeSkill: removeSelected, undo, retrySave, retryFinalize, startEditing, stopEditing, setPickStep, reviewBoard, readyAck, consumeShuffled, enterJoin,
  revealSoul, soulRevealed, floatStart, floatNow, setFloatGreeting, startNextRound, toast,
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sse) { sse.reconnectNow(); } });
window.addEventListener('online', () => { if (sse) sse.reconnectNow(); if (store.get().ui.draftDirty) scheduleSave(); });

// Static chrome copy comes from the catalogue too (index.html only carries fallbacks).
document.title = t('app.title');
const skip = document.querySelector('.skip-link'); if (skip) skip.textContent = tl('ui.skip');
const brand = document.querySelector('.brand__name'); if (brand) brand.textContent = t('app.title');

render(store.get());
if (session) start(); else if (!joinToken) store.set({ joinError: null });

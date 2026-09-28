// Admin portal entry: sign-in, Mission Control, Insights, Audit. Server authoritative; copy via t()/exception().
import { h, mount, announce } from '/packages/ui/dom.js';
import { createStore, applySnapshot, applyEvent } from '/packages/ui/store.js';
import { createSseClient } from '/packages/ui/sse-client.js';
import { formatCountdown } from '/packages/ui/clock-sync.js';
import { formatInt, formatTime } from '/packages/ui/format.js';
import { createAudioManager, PRELOAD_BY_APP } from '/packages/ui/audio.js';
import { restoreReducedMotion, animateOnce } from '/packages/ui/motion.js';
import { track } from '/packages/ui/telemetry.js';
import { t, exceptionCopy } from './copy.js';
import { getToken, setToken, clearToken, consumeUrlToken } from './auth.js';
import { createAdminApi } from './api.js';
import { initialState, normaliseSnapshot, reduceEvent, roundViewModel, connectionView, localDateTimeToIso, isoToLocalDateTime, defaultRoundTitle, statusOf, START_IN_CHOICES, UNFINISHED_ALERT } from './state.js';
import { createCommandRunner, exceptionIdFor } from './commands.js';
import { toast, confirmDialog, reasonDialog, roundDialog, pickTimeDialog, typeToConfirmDialog, ensureToastRegion } from './dialogs.js';
import { missionControlLayout, renderRoundList } from './views/mission-control.js';
import { renderRoundPanel } from './views/round-panel.js';
import { renderInsights } from './views/insights.js';
import { renderAudit } from './views/audit.js';

const TABS = [
  { id: 'mission', hash: '#mission', label: () => t('admin.missionControl') },
  { id: 'insights', hash: '#insights', label: () => t('admin.insights') },
  { id: 'audit', hash: '#audit', label: () => t('adminLocal.audit') },
];
const INSIGHTS_POLL_MS = 10_000;

restoreReducedMotion();
consumeUrlToken();
ensureToastRegion();

const app = document.getElementById('app');
let session = null; // active signed-in session (torn down on sign-out)

function signInView({ error = null } = {}) {
  let input;
  const form = h('form', { className: 'card stack sign-in', 'aria-labelledby': 'signin-title', novalidate: true },
    h('h1', { id: 'signin-title' }, t('adminLocal.signIn.title')),
    h('p', { className: 'muted' }, t('adminLocal.signIn.hint')),
    error && h('p', { className: 'banner banner--danger', role: 'alert' }, error),
    h('div', { className: 'field' },
      h('label', { className: 'field__label', for: 'admin-token' }, t('adminLocal.signIn.token')),
      h('input', { className: 'input', id: 'admin-token', type: 'password', autocomplete: 'current-password', required: true, ref: (el) => { input = el; } })),
    h('div', { className: 'cluster' }, h('button', { className: 'btn btn--primary', type: 'submit' }, t('adminLocal.signIn.cta'))));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = (input.value || '').trim();
    if (!token) { input.focus(); return; }
    setToken(token);
    boot();
  });
  mount(app, h('main', { id: 'main', className: 'container app-main stack sign-in-main', tabindex: -1 }, form));
  setTimeout(() => input && input.focus(), 0);
}

function signOut({ error = null } = {}) {
  if (session) { session.teardown(); session = null; }
  clearToken();
  signInView({ error });
}

async function boot() {
  const api = createAdminApi();
  const store = createStore(initialState());
  const state = () => store.get();
  const ui = { tab: tabFromHash(), pendingCommand: null, drawResultText: '', sseStatus: 'connecting', insights: { data: null, error: null, loading: false, timer: null }, audit: { entries: [], roundId: null, loading: false, error: null }, celebratedBingo: new Set(), seenDraws: new Set(), refreshTimer: null, ticker: null, lastPoll: 0, alertShown: false, deleting: false, testModePending: false };
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  // ---- audio ----------------------------------------------------------------------------------------------
  const audio = createAudioManager({ app: 'admin', clockNow: () => api.clockSync.now(), translate: t, onCaption: ({ caption, played }) => { if (!played && caption) announce(caption); } });
  audio.preload([...PRELOAD_BY_APP.admin, 'draw_leadin', 'error_soft', 'reconnect']);
  const unlockOnce = () => { audio.unlock(); document.removeEventListener('click', unlockOnce, true); document.removeEventListener('keydown', unlockOnce, true); };
  document.addEventListener('click', unlockOnce, true);
  document.addEventListener('keydown', unlockOnce, true);
  const playError = () => audio.play('error_soft');

  // ---- errors ---------------------------------------------------------------------------------------------
  function handleAuthError(err) {
    if (err && err.isAuth) { signOut({ error: exceptionCopy('E9') }); return true; }
    return false;
  }
  function showError(err, { fallbackKey = 'adminLocal.loadError', command = null } = {}) {
    if (handleAuthError(err)) return;
    const id = exceptionIdFor(err, command);
    const text = id ? exceptionCopy(id) : (err && err.isNetwork ? t('adminLocal.networkError') : (err && err.message) || t(fallbackKey));
    toast(text, { kind: 'danger' });
    playError();
  }

  // ---- snapshot + realtime ----------------------------------------------------------------------------------
  let sse = null;
  async function refreshSnapshot({ acknowledge = true } = {}) {
    const snap = await api.snapshot();
    const patch = normaliseSnapshot(snap, state());
    applySnapshot(store, { ...patch, sequence: snap.sequence });
    if (acknowledge && sse) sse.acknowledgeSnapshot(snap.sequence);
    audio.setConnectionEpoch(snap.sequence);
    return snap;
  }
  const scheduleRefresh = () => { if (ui.refreshTimer) return; ui.refreshTimer = later(() => { ui.refreshTimer = null; refreshSnapshot().catch(handleAuthError); }, 250); };

  function onEvent(envelope, meta) {
    const before = state();
    const res = applyEvent(store, envelope, reduceEvent);
    if (!res.applied) return;
    const type = envelope.type;
    const live = meta && meta.replay === false;
    if (type === 'draw.accepted') {
      const d = envelope.payload.draw;
      const key = `${envelope.roundId}:${d.number}`;
      if (live && !ui.seenDraws.has(key)) {
        ui.seenDraws.add(key);
        audio.play('draw_reveal', { sequence: envelope.sequence });
        ui.drawResultText = t('adminLocal.drawAnnounce', { number: d.number, skill: d.skill?.name, kind: d.skill?.kind, matched: formatInt(envelope.payload.matchedBoards ?? 0) });
        announce(ui.drawResultText);
        later(() => { const row = document.querySelector(`[data-draw-number="${d.number}"]`); if (row) animateOnce(row, 'm-draw-arrival'); }, 0);
      }
    }
    if (type === 'bingo.detected' && live && !ui.celebratedBingo.has(envelope.roundId)) {
      ui.celebratedBingo.add(envelope.roundId);
      audio.play('bingo', { sequence: envelope.sequence });
      announce(t('adminLocal.bingoAnnounce', { draw: envelope.payload.drawNumber, count: envelope.payload.winnerCount }), { politeness: 'assertive' });
    }
    if (/^round\./.test(type) || type === 'result.published' || type === 'event.reset') {
      const prevState = before.currentRound?.summary?.state; const nextState = state().currentRound?.summary?.state;
      if (prevState !== nextState && nextState && live) announce(`${state().currentRound?.summary?.title}: ${statusOf(nextState).label}`);
      scheduleRefresh(); // readiness / counts / lastCommand live only in the snapshot
    }
    if (type === 'system.snapshot_required') scheduleRefresh();
    if (type === 'participation.updated' && state().currentRound?.summary?.state === 'REGISTRATION_OPEN') scheduleRefresh(); // unfinished count
  }

  function startStream(since) {
    sse = createSseClient({
      url: api.streamUrl,
      getToken,
      since,
      onEvent,
      onGap: () => { audio.setReplaying(true); refreshSnapshot().catch(handleAuthError).finally(() => audio.setReplaying(false)); },
      onStatus: (status, info) => {
        ui.sseStatus = status;
        renderHeader();
        if (status === 'reconnecting') { audio.play('reconnect'); track('client.reconnect', { audience: 'admin' }); }
        if (status === 'open') { if (info.connectionEpoch > 1) audio.setReplaying(true); refreshSnapshot().catch(handleAuthError).finally(() => audio.setReplaying(false)); }
        if (status === 'closed' && sse && /40[134]/.test(String(sse.stoppedReason || ''))) signOut({ error: exceptionCopy('E9') });
      },
    });
    sse.start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
  }
  const onVisibility = () => { if (document.visibilityState === 'visible') { if (sse) sse.reconnectNow(); pollInsights(); } else stopInsightsPoll(); };
  const onOnline = () => { if (sse) sse.reconnectNow(); };

  // ---- commands -------------------------------------------------------------------------------------------
  const runner = createCommandRunner({
    post: (roundId, body, key) => api.command(roundId, body, key),
    newKey: () => api.newIdempotencyKey(),
    getRound: () => state().currentRound?.summary || null,
    hooks: {
      onPending: (command) => { ui.pendingCommand = command; if (command === 'round.draw.next') { audio.play('draw_leadin'); ui.drawResultText = ''; } renderMission(); },
      onAccepted: (result, command) => {
        track('admin.command', { command, outcome: 'accepted' });
        if (result && result.round) store.set((prev) => reduceEvent(prev, { type: 'round.updated', roundId: result.round.roundId, payload: { round: result.round } }));
        const done = { 'round.registration.open': 'adminLocal.mc.opened', 'round.start_now': 'adminLocal.mc.started' }[command];
        if (done) toast(t(done), { kind: 'success', timeoutMs: 3500 });
        if (command === 'round.reschedule' && result?.round?.lockAt) toast(t('adminLocal.mc.extended', { time: formatTime(result.round.lockAt) }), { kind: 'success', timeoutMs: 3500 });
        scheduleRefresh();
      },
      onStale: (err) => {
        track('admin.command', { outcome: 'stale' });
        const snap = err.staleSnapshot;
        if (snap && snap.roundId) store.set((prev) => reduceEvent(prev, { type: 'round.updated', roundId: snap.roundId, payload: { round: snap } }));
        toast(exceptionCopy('E10'), { kind: 'warning' });
        playError();
        refreshSnapshot().catch(handleAuthError);
      },
      onRejected: (err, command) => {
        track('admin.command', { command, outcome: 'rejected' });
        showError(err, { command });                                   // round.start_now failure -> E19 (UX-04)
        if (command === 'round.draw.next') ui.drawResultText = exceptionCopy(exceptionIdFor(err, command) || 'E21');
        scheduleRefresh();                                             // panel stays as-is until the server snapshot says otherwise
      },
      onNetworkError: (err) => { toast(t('adminLocal.networkError'), { kind: 'danger' }); playError(); },
      onSettled: () => { ui.pendingCommand = null; renderMission(); },
    },
  });

  const nowMs = () => api.clockSync.now();
  const actions = {
    create: async () => {
      const v = await roundDialog({ title: t('adminLocal.mc.createTitle'), submitLabel: t('adminLocal.mc.create'), choices: START_IN_CHOICES, now: nowMs(), toIso: localDateTimeToIso,
        values: { title: defaultRoundTitle(state().rounds), mode: 'in', startInMinutes: 10, lockAtLocal: isoToLocalDateTime(new Date(nowMs() + 30 * 60 * 1000).toISOString()) } });
      if (v) await createRound(v);
    },
    edit: async () => {
      const s = state().currentRound?.summary; if (!s) return;
      const v = await roundDialog({ title: t('adminLocal.mc.editTitle'), submitLabel: t('adminLocal.mc.save'), choices: START_IN_CHOICES, now: nowMs(), toIso: localDateTimeToIso,
        values: { title: s.title, mode: s.lockAt ? 'at' : 'in', startInMinutes: s.startInMinutes || 10, lockAtLocal: isoToLocalDateTime(s.lockAt || new Date(nowMs() + 30 * 60 * 1000).toISOString()) } });
      if (v) await runner.run('round.update', v);
    },
    openRegistration: () => runner.run('round.registration.open'),
    startNow: async () => {
      const ok = await confirmDialog({ title: t('adminLocal.mc.startNowTitle'), message: t('adminLocal.mc.startNowBody'), confirmLabel: t('adminLocal.mc.startNow') });
      if (ok) await runner.run('round.start_now', { confirmed: true });
    },
    extend: (minutes) => runner.run('round.reschedule', { extendMinutes: minutes }),
    pickTime: async () => {
      const s = state().currentRound?.summary; if (!s) return;
      const iso = await pickTimeDialog({ valueLocal: isoToLocalDateTime(s.lockAt || new Date(nowMs() + 5 * 60 * 1000).toISOString()), now: nowMs(), toIso: localDateTimeToIso });
      if (iso) await runner.run('round.reschedule', { lockAt: iso });
    },
    nextSkill: () => runner.run('round.draw.next'),
    cancel: async () => {
      const reason = await reasonDialog({ title: t('adminLocal.mc.cancel'), label: t('admin.cancelReason'), confirmLabel: t('adminLocal.mc.cancel') });
      if (reason) await runner.run('round.cancel', { reason });
    },
    deleteRound: async (round) => {
      if (!round || ui.deleting) return;
      const ok = await confirmDialog({ title: t('adminLocal.mc.deleteTitle', { name: round.title }), message: t('adminLocal.mc.deleteBody'), confirmLabel: t('adminLocal.mc.delete'), danger: true });
      if (!ok) return;
      ui.deleting = true; renderMission();
      try {
        await api.deleteRound(round.roundId);
        store.set((prev) => reduceEvent(prev, { type: 'round.deleted', roundId: round.roundId, payload: { roundId: round.roundId } }));
        toast(t('adminLocal.mc.deleted', { name: round.title }), { kind: 'success', timeoutMs: 3500 });
      } catch (err) { showError(err); }
      finally { ui.deleting = false; scheduleRefresh(); renderMission(); }
    },
    toggleTestMode: async (on) => {
      if (ui.testModePending) return;
      if (on && !(await confirmDialog({ title: t('adminLocal.mc.testModeTitle'), message: t('adminLocal.mc.testModeBody'), confirmLabel: t('adminLocal.mc.testModeConfirm'), danger: true }))) return;
      ui.testModePending = true; renderMission();
      try {
        const res = await api.setTestMode(on);
        store.set((prev) => reduceEvent(prev, { type: 'event.updated', payload: { testMode: res.testMode } }));
        toast(t(res.testMode ? 'adminLocal.mc.testModeTurnedOn' : 'adminLocal.mc.testModeTurnedOff'), { kind: res.testMode ? 'warning' : 'success', timeoutMs: 3500 });
      } catch (err) { showError(err); }
      finally { ui.testModePending = false; renderMission(); scheduleRefresh(); }
    },
    clearAll: async () => {
      const ok = await typeToConfirmDialog({ title: t('adminLocal.mc.clearTitle'), message: t('adminLocal.mc.clearBody'), word: 'DELETE', confirmLabel: t('adminLocal.mc.clearAll') });
      if (!ok) return;
      try {
        await api.resetEvent();
        store.set((prev) => reduceEvent(prev, { type: 'event.reset', payload: {} }));
        toast(t('adminLocal.mc.cleared'), { kind: 'success', timeoutMs: 3500 });
      } catch (err) { showError(err); }
      finally { scheduleRefresh(); }
    },
  };

  async function createRound(values) {
    try {
      const res = await api.createRound(values);
      if (res && res.round) store.set((prev) => reduceEvent(prev, { type: 'round.created', roundId: res.round.roundId, payload: { round: res.round } }));
      scheduleRefresh();
      return true;
    } catch (err) { showError(err); return false; }
  }

  // ---- layout -----------------------------------------------------------------------------------------------
  const headerStatus = h('div', { className: 'cluster header-status' });
  const muteBtn = h('button', { className: 'btn btn--ghost btn--sm', type: 'button', 'aria-pressed': audio.state().muted, onClick: () => { const m = audio.setMuted(!audio.state().muted); muteBtn.setAttribute('aria-pressed', String(m)); muteBtn.textContent = m ? t('adminLocal.unmute') : t('adminLocal.mute'); } }, audio.state().muted ? t('adminLocal.unmute') : t('adminLocal.mute'));
  const volume = h('input', { className: 'volume', type: 'range', min: 0, max: 100, step: 5, value: String(Math.round(audio.state().volume * 100)), id: 'volume', onInput: (e) => audio.setMasterVolume(Number(e.target.value) / 100) });
  const header = h('header', { className: 'app-header' },
    h('div', { className: 'cluster' }, h('h1', { className: 'app-title' }, t('app.title')), h('span', { className: 'muted event-name', dataset: { eventName: '' } }, '')),
    headerStatus,
    h('div', { className: 'cluster header-tools' },
      muteBtn, h('label', { className: 'visually-hidden', for: 'volume' }, t('adminLocal.volume')), volume,
      h('button', { className: 'btn btn--ghost btn--sm', type: 'button', onClick: () => signOut() }, t('adminLocal.signOut'))));
  const tablist = h('div', { className: 'tabs', role: 'tablist', 'aria-label': t('app.title') });
  const panels = {};
  for (const tab of TABS) {
    tablist.appendChild(h('button', { className: 'tab', role: 'tab', id: `tab-${tab.id}`, type: 'button', 'aria-selected': ui.tab === tab.id, 'aria-controls': `panel-${tab.id}`, tabindex: ui.tab === tab.id ? 0 : -1, onClick: () => selectTab(tab.id), onKeydown: onTabKey }, tab.label()));
    panels[tab.id] = h('div', { className: 'tabpanel', role: 'tabpanel', id: `panel-${tab.id}`, 'aria-labelledby': `tab-${tab.id}`, hidden: ui.tab !== tab.id, tabindex: 0 });
  }
  const mission = missionControlLayout({ onCreate: () => actions.create(), onClearAll: () => actions.clearAll(), onToggleTestMode: (on) => actions.toggleTestMode(on) });
  panels.mission.appendChild(mission.root);
  const main = h('main', { id: 'main', className: 'container container--wide app-main stack', tabindex: -1 }, tablist, panels.mission, panels.insights, panels.audit);
  mount(app, [header, main]);

  function onTabKey(e) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = TABS.findIndex((x) => x.id === ui.tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    selectTab(TABS[next].id); document.getElementById(`tab-${TABS[next].id}`).focus();
  }
  function tabFromHash() { const found = TABS.find((x) => x.hash === location.hash); return found ? found.id : 'mission'; }
  function selectTab(id) {
    ui.tab = id;
    for (const tab of TABS) { const b = document.getElementById(`tab-${tab.id}`); if (b) { b.setAttribute('aria-selected', String(tab.id === id)); b.tabIndex = tab.id === id ? 0 : -1; } panels[tab.id].hidden = tab.id !== id; }
    if (location.hash !== TABS.find((x) => x.id === id).hash) history.replaceState(null, '', TABS.find((x) => x.id === id).hash);
    if (id === 'insights') pollInsights(); else stopInsightsPoll();
    if (id === 'audit') loadAudit();
  }
  window.addEventListener('hashchange', onHash);
  function onHash() { const id = tabFromHash(); if (id !== ui.tab) selectTab(id); }

  // ---- renders ----------------------------------------------------------------------------------------------
  function renderHeader() {
    const st = state(); const cv = connectionView(ui.sseStatus); const c = st.connections || {};
    const nameEl = header.querySelector('[data-event-name]'); if (nameEl) nameEl.textContent = st.eventName ? `${t('adminLocal.event')}: ${st.eventName}` : '';
    mount(headerStatus, [
      h('span', { className: ['pill', cv.pill], role: 'status' }, t(`adminLocal.connection.${ui.sseStatus === 'open' ? 'open' : ui.sseStatus === 'reconnecting' ? 'reconnecting' : ui.sseStatus === 'closed' ? 'closed' : 'connecting'}`)),
      h('span', { className: 'muted conn-counts tabular', 'aria-label': t('adminLocal.counts.connections') },
        `${t('adminLocal.connections.public')} ${formatInt(c.public || 0)} · ${t('adminLocal.connections.stage')} ${formatInt(c.stage || 0)} · ${t('adminLocal.connections.participants')} ${formatInt(c.participants || 0)} · ${t('adminLocal.connections.admin')} ${formatInt(c.admin || 0)}`),
      !api.clockSync.isSynced && h('span', { className: 'muted' }, exceptionCopy('E7')),
    ]);
    const banner = document.getElementById('reconnect-banner');
    if (cv.reconnecting) { if (!banner) main.prepend(h('div', { id: 'reconnect-banner', className: 'banner banner--reconnecting', role: 'status' }, h('span', { className: 'banner__icon', 'aria-hidden': 'true' }), h('span', { className: 'banner__body' }, t('reconnect')))); }
    else if (banner) banner.remove();
  }
  function renderMission() {
    const st = state();
    if (!st.loaded) { mount(mission.panelHost, h('p', { className: 'muted' }, t('adminLocal.loading'))); return; }
    const vm = roundViewModel(st, api.clockSync.now());
    ui.alertShown = !!vm.unfinishedAlert;
    const active = document.activeElement; const focusKey = active && mission.panelHost.contains(active) ? (active.id ? `#${active.id}` : active.dataset.command ? `[data-command="${active.dataset.command}"]` : null) : null;
    mount(mission.panelHost, renderRoundPanel(st, vm, { actions, pendingCommand: ui.pendingCommand, drawResultText: ui.drawResultText }));
    mount(mission.listHost, renderRoundList(st.rounds, st.currentRound?.summary?.roundId, { onDelete: actions.deleteRound, pending: ui.deleting }));
    mission.setTestModeView({ on: st.testMode, locked: st.testModeLocked, pending: ui.testModePending }); // D-56
    mission.testingBanner.hidden = !st.testMode;
    if (focusKey) { const el = mission.panelHost.querySelector(focusKey); if (el && !el.disabled) el.focus({ preventScroll: true }); }
    tick();
  }
  function tick() {
    const now = api.clockSync.now();
    // D-53 unfinished-boards alert: in the last minutes before the start time, keep the count fresh (players join without
    // any event reaching the admin) and re-render when the alert window opens or closes.
    const st = state(); const cur = st.currentRound?.summary;
    if (cur && cur.state === 'REGISTRATION_OPEN' && cur.lockAt) {
      const left = Date.parse(cur.lockAt) - now;
      if (left <= UNFINISHED_ALERT.windowMs + 30_000 && left > -30_000 && now - ui.lastPoll > 5000) { ui.lastPoll = now; refreshSnapshot().catch(handleAuthError); }
      if (!!roundViewModel(st, now).unfinishedAlert !== ui.alertShown) { renderMission(); return; }
    }
    for (const el of document.querySelectorAll('[data-countdown-target]')) {
      const text = formatCountdown(el.dataset.countdownTarget, now);
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('is-zero', text === '00:00');
    }
  }
  function renderInsightsTab() { mount(panels.insights, renderInsights(ui.insights.data, { error: ui.insights.error, loading: ui.insights.loading })); }
  async function fetchInsights() {
    ui.insights.loading = true; if (!ui.insights.data) renderInsightsTab();
    try { ui.insights.data = await api.insights(); ui.insights.error = null; }
    catch (err) { if (handleAuthError(err)) return; ui.insights.error = exceptionIdFor(err) ? exceptionCopy(exceptionIdFor(err)) : t('adminLocal.loadError'); }
    finally { ui.insights.loading = false; renderInsightsTab(); }
  }
  function pollInsights() {
    if (ui.tab !== 'insights' || document.visibilityState !== 'visible') return;
    stopInsightsPoll();
    fetchInsights();
    ui.insights.timer = setInterval(() => { if (document.visibilityState === 'visible') fetchInsights(); }, INSIGHTS_POLL_MS);
  }
  function stopInsightsPoll() { if (ui.insights.timer) { clearInterval(ui.insights.timer); ui.insights.timer = null; } }
  function renderAuditTab() {
    mount(panels.audit, renderAudit({ entries: ui.audit.entries, rounds: state().rounds, roundId: ui.audit.roundId, loading: ui.audit.loading, error: ui.audit.error, onFilter: (roundId) => { ui.audit.roundId = roundId; loadAudit(); }, onRefresh: loadAudit }));
  }
  async function loadAudit() {
    ui.audit.loading = true; renderAuditTab();
    try { const res = await api.audit({ roundId: ui.audit.roundId, limit: 200 }); ui.audit.entries = res.entries || []; ui.audit.error = null; }
    catch (err) { if (handleAuthError(err)) return; ui.audit.error = exceptionIdFor(err) ? exceptionCopy(exceptionIdFor(err)) : t('adminLocal.loadError'); }
    finally { ui.audit.loading = false; renderAuditTab(); }
  }

  store.subscribe(() => { renderHeader(); renderMission(); });
  renderHeader(); renderMission();
  ui.ticker = setInterval(tick, 500);

  session = {
    teardown() {
      if (sse) sse.stop();
      stopInsightsPoll(); clearInterval(ui.ticker);
      for (const id of timers) clearTimeout(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('hashchange', onHash);
      audio.dispose();
    },
  };

  // ---- initial load -------------------------------------------------------------------------------------------
  try {
    await api.clockSync.sync().catch(() => {});
    api.clockSync.startAutoResync(60_000);
    const snap = await refreshSnapshot({ acknowledge: false });
    startStream(snap.sequence);
    if (ui.tab !== 'mission') selectTab(ui.tab);
  } catch (err) {
    if (handleAuthError(err)) return;
    mount(mission.panelHost, h('div', { className: 'card stack' }, h('p', { className: 'banner banner--danger', role: 'alert' }, t('adminLocal.loadError')), h('button', { className: 'btn btn--primary', type: 'button', onClick: () => { session.teardown(); boot(); } }, t('adminLocal.retry'))));
    playError();
  }
}

if (getToken()) boot(); else signInView();

// Motion stage tests (node:test). Run: node --test packages/ui/test/motion.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const tokensPath = path.join(root, 'tokens', 'motion.json');
const cssPath = path.join(root, 'packages', 'ui', 'motion.css');

const motion = await import(path.join(root, 'packages', 'ui', 'motion.js'));
const {
  MOTION, animateOnce, createCelebrationGuard, runFloatCountdown, scheduleAt, lineTracePositions,
  staggerIndex, applyMatch, markLine, prefersReducedMotion, entranceStartMs, EVENT_MOTION,
} = motion;

// --------------------------------------------------------------------------------------------- helpers

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = nextId++; queue.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout(id) { queue.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of queue) if (t.at <= target && (!next || t.at < next.t.at || (t.at === next.t.at && id < next.id))) next = { id, t };
        if (!next) break;
        queue.delete(next.id);
        now = next.t.at;
        next.t.fn();
      }
      now = target;
    },
    pending: () => queue.size,
  };
}

function fakeElement() {
  const classes = new Set();
  const listeners = new Map();
  const styles = new Map();
  const el = {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    style: { setProperty: (k, v) => styles.set(k, v), getPropertyValue: (k) => styles.get(k) },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    fire(type) { const fn = listeners.get(type); if (fn) fn({ target: el, type }); },
    classes, listeners, styles,
  };
  return el;
}

// --------------------------------------------------------------------------------------------- tokens

test('tokens/motion.json parses and has the required top-level shape', () => {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  for (const k of ['version', 'durations', 'easing', 'delays', 'stagger', 'interactions', 'flashSafety', 'budgets']) assert.ok(k in tokens, `missing ${k}`);
  assert.equal(tokens.durations.instant, 0);
  assert.equal(tokens.durations.fast, 120);
  assert.equal(tokens.durations.base, 180);
  assert.equal(tokens.durations.soulReveal, 2000);
  assert.equal(tokens.stagger.gridCell, 20);
  assert.equal(tokens.flashSafety.maxFlashesPerSecond, 3);
  assert.ok(tokens.flashSafety.maxLuminanceDeltaPercent <= 10);
  assert.equal(tokens.budgets.minFpsVenue, 30);
});

test('every interaction carries a reduced replacement (fade or static)', () => {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  for (const [name, def] of Object.entries(tokens.interactions)) {
    assert.equal(typeof def.reduced, 'string', `${name}.reduced missing`);
    assert.match(def.reduced, /^(fade|static)/, `${name}.reduced must be a fade or static replacement`);
  }
});

test('durations satisfy requirement section 11 ranges', () => {
  const t = JSON.parse(fs.readFileSync(tokensPath, 'utf8')).interactions;
  const within = (v, [lo, hi]) => v >= lo && v <= hi;
  assert.deepEqual(t.addSkill.range, [120, 180]); assert.ok(within(t.addSkill.ms, [120, 180]));
  assert.deepEqual(t.removeSkill.range, [120, 180]); assert.ok(within(t.removeSkill.ms, [120, 180]));
  assert.ok(t.boardComplete.max <= 800 && t.boardComplete.ms <= 800);
  assert.ok((t.boardComplete.cells - 1) * t.boardComplete.staggerMs + t.boardComplete.cellMs <= 800, 'staggered glow exceeds 800 ms');
  assert.ok(t.boardLock.max <= 400 && t.boardLock.ms <= 400);
  assert.deepEqual(t.match.range, [200, 350]); assert.ok(within(t.match.ms, [200, 350]));
  assert.equal(t.bingoLine.once, true);
  assert.ok(t.winnerView.readableWithin <= 1000 && t.winnerView.textReadyMs <= 1000);
  assert.deepEqual(t.soulReveal.range, [1500, 2500]); assert.ok(within(t.soulReveal.ms, [1500, 2500]));
  assert.equal(t.soulReveal.skippableAfterFirstView, true);
  assert.deepEqual(t.float.countdown, [3, 2, 1]); assert.equal(t.float.stepMs, 1000);
  assert.ok(t.orbit.maxAngularSpeedDegPerSec > 0 && t.orbit.maxCameraDriftPxPerSec > 0, 'orbit must be bounded');
  assert.ok(1000 / t.pulseSoft.periodMs < 3, 'ambient pulse must stay under 3 Hz');
});

test('MOTION in motion.js deep-equals tokens/motion.json', () => {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(MOTION)), tokens);
});

// --------------------------------------------------------------------------------------------- css

test('motion.css: reduced-motion blocks exist and every .m-* class has a reduced counterpart', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'missing prefers-reduced-motion block');
  assert.ok(css.includes('[data-reduced-motion="true"]'), 'missing data-reduced-motion block');

  const mediaStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
  const dataStart = css.indexOf('/* Explicit in-app toggle');
  assert.ok(mediaStart > 0 && dataStart > mediaStart);
  const full = css.slice(0, mediaStart);
  const media = css.slice(mediaStart, dataStart);
  const data = css.slice(dataStart);

  const classes = new Set([...full.matchAll(/\.(m-[a-z0-9-]+)/g)].map(m => m[1]).filter(c => !c.startsWith('m-kf-')));
  assert.ok(classes.size >= 12, `expected >= 12 motion classes, found ${classes.size}`);
  for (const c of classes) {
    assert.ok(media.includes(`.${c}`), `.${c} lacks a prefers-reduced-motion replacement`);
    assert.ok(data.includes(`.${c}`), `.${c} lacks a [data-reduced-motion="true"] replacement`);
  }
  for (const must of ['m-add', 'm-remove', 'm-board-complete', 'm-lock', 'm-draw-arrival', 'm-match', 'm-line-trace', 'm-winner-burst', 'm-soul-reveal', 'm-float-countdown', 'm-float-launch', 'm-entrance-arc', 'm-fade', 'm-pulse-soft']) {
    assert.ok(classes.has(must), `required class .${must} missing`);
  }
  // Bingo line traces once; ambient pulse is the only infinite animation besides bounded orbit.
  assert.match(css, /m-kf-line-stroke[^;]*\)\s+1\s+forwards/);
  assert.match(css, /m-kf-line-cell[^;]*\)\s+1\s+both/);
  const infinite = [...full.matchAll(/^\s*\.(m-[a-z-]+)[^{]*\{[^}]*infinite/gm)].map(m => m[1]);
  assert.deepEqual(infinite.sort(), ['m-orbit', 'm-pulse-soft']);
  // Stagger uses --i and 20 ms.
  assert.match(css, /calc\(var\(--i, 0\) \* var\(--motion-stagger-cell\)\)/);
  assert.match(css, /--motion-stagger-cell: 20ms/);
  assert.match(css, /--motion-fast: var\(--duration-fast, 120ms\)/);
});

// --------------------------------------------------------------------------------------------- guard

test('celebration guard: once per key, live epoch only, never covered by snapshot', () => {
  let epoch = 1;
  const guard = createCelebrationGuard({ getConnectionEpoch: () => epoch });
  assert.equal(guard.shouldCelebrate('draw:evt_1', { epoch: 1, sequence: 10 }), true);
  assert.equal(guard.shouldCelebrate('draw:evt_1', { epoch: 1, sequence: 10 }), false, 'same key twice');
  assert.equal(guard.lastDecision().reason, 'duplicate');

  // replayed from a previous connection epoch
  assert.equal(guard.shouldCelebrate('draw:evt_2', { epoch: 0, sequence: 11 }), false);
  assert.equal(guard.lastDecision().reason, 'stale-epoch');
  assert.equal(guard.shouldCelebrate('draw:evt_3', { epoch: 1, sequence: 12, replay: true }), false);
  assert.equal(guard.lastDecision().reason, 'replay');

  // reconnect: epoch increments, snapshot applied at sequence 20
  epoch = 2;
  guard.markSnapshotApplied(20);
  assert.equal(guard.shouldCelebrate('bingo:evt_4', { epoch: 2, sequence: 20 }), false, 'sequence == snapshot');
  assert.equal(guard.shouldCelebrate('bingo:evt_5', { epoch: 2, sequence: 15 }), false, 'sequence < snapshot');
  assert.equal(guard.lastDecision().reason, 'snapshot-covered');
  assert.equal(guard.shouldCelebrate('bingo:evt_6', { epoch: 2, sequence: 21 }), true, 'live event after snapshot');
  assert.equal(guard.shouldCelebrate('bingo:evt_7', { epoch: 1, sequence: 22 }), false, 'old epoch after reconnect');
  assert.equal(guard.shouldCelebrate('', { epoch: 2, sequence: 30 }), false);
  assert.equal(guard.shouldCelebrate('float:soul_1', { epoch: 2 }), true, 'events without sequence (HTTP response) still guarded by key');
  assert.equal(guard.shouldCelebrate('float:soul_1', { epoch: 2 }), false);
  assert.equal(guard.shouldCelebrate('draw:evt_8', { connectionEpoch: 2, sequence: 23 }), true, 'sse-client meta.connectionEpoch alias');
  assert.equal(guard.shouldCelebrate('draw:evt_9', { connectionEpoch: 1, sequence: 24 }), false);
  // snapshot sequence never moves backwards
  assert.equal(guard.markSnapshotApplied(5), 20);
  assert.throws(() => createCelebrationGuard({}), TypeError);
});

// --------------------------------------------------------------------------------------------- timing

test('scheduleAt fires at the server time and reports lateness', () => {
  const timers = fakeTimers();
  const clock = () => 1_000_000 + timers.now();
  const calls = [];
  scheduleAt(1_000_500, clock, (i) => calls.push(i), { timers });
  timers.advance(499); assert.equal(calls.length, 0);
  timers.advance(1); assert.equal(calls.length, 1); assert.equal(calls[0].lateMs, 0);
  const late = [];
  scheduleAt(new Date(999_000).toISOString(), clock, (i) => late.push(i), { timers });
  timers.advance(0); assert.equal(late.length, 1); assert.ok(late[0].lateMs >= 1500);
  const cancelled = [];
  const cancel = scheduleAt(1_002_000, clock, () => cancelled.push(1), { timers });
  cancel(); timers.advance(5000); assert.equal(cancelled.length, 0);
});

test('runFloatCountdown ticks 3, 2, 1 then launches at the right server times', () => {
  const timers = fakeTimers();
  const base = 1_700_000_000_000;
  const clock = () => base + timers.now();
  const log = [];
  runFloatCountdown({
    startAt: new Date(base + 200).toISOString(), clockNow: clock,
    onTick: (n) => log.push([n, timers.now()]), onLaunch: () => log.push(['launch', timers.now()]), timers,
  });
  timers.advance(199); assert.deepEqual(log, []);
  timers.advance(1); assert.deepEqual(log, [[3, 200]]);
  timers.advance(1000); assert.deepEqual(log, [[3, 200], [2, 1200]]);
  timers.advance(1000); assert.deepEqual(log, [[3, 200], [2, 1200], [1, 2200]]);
  timers.advance(999); assert.equal(log.length, 3);
  timers.advance(1); assert.deepEqual(log[3], ['launch', 3200]);
  assert.equal(timers.pending(), 0);
});

test('runFloatCountdown: late start shows only the current digit; fully elapsed launches immediately; cancel works', () => {
  const timers = fakeTimers();
  const base = 5_000_000;
  const clock = () => base + timers.now();
  const log = [];
  // clock is 1.5 s past the start: "2" is current, "3" is skipped
  runFloatCountdown({ startAt: base - 1500, clockNow: clock, onTick: (n) => log.push(n), onLaunch: () => log.push('launch'), timers });
  timers.advance(0); assert.deepEqual(log, [2]);
  timers.advance(500); assert.deepEqual(log, [2, 1]);
  timers.advance(1000); assert.deepEqual(log, [2, 1, 'launch']);

  const log2 = [];
  runFloatCountdown({ startAt: base - 10_000, clockNow: clock, onTick: (n) => log2.push(n), onLaunch: () => log2.push('launch'), timers });
  timers.advance(0); assert.deepEqual(log2, ['launch']);

  const log3 = [];
  const cancel = runFloatCountdown({ startAt: base + timers.now() + 100, clockNow: clock, onTick: (n) => log3.push(n), onLaunch: () => log3.push('launch'), timers });
  cancel(); timers.advance(10_000); assert.deepEqual(log3, []);
});

test('entranceStartMs keys the public entrance to enteredAt + configured offset', () => {
  const env = { occurredAt: '2026-09-22T03:30:05.000Z', payload: { entrance: { enteredAt: '2026-09-22T03:30:05.120Z', edge: 'left' } } };
  assert.equal(entranceStartMs(env), Date.parse('2026-09-22T03:30:05.120Z') + MOTION.delays.floatPublicOffset);
  assert.equal(entranceStartMs({ occurredAt: '2026-09-22T03:30:05.000Z' }, 0), Date.parse('2026-09-22T03:30:05.000Z'));
  assert.ok(Number.isNaN(entranceStartMs({})));
});

// --------------------------------------------------------------------------------------------- lines

test('lineTracePositions returns 4 ordered positions for all 10 lines, matching the game rules', async () => {
  const { LINE_MASKS, CELLS, GRID } = await import(path.join(root, 'packages', 'game-rules', 'src', 'lines.js'));
  assert.equal(LINE_MASKS.length, 10);
  for (const l of LINE_MASKS) {
    const p = lineTracePositions(l.id);
    assert.equal(p.length, GRID, l.id);
    assert.ok(p.every(x => Number.isInteger(x) && x >= 0 && x < CELLS), l.id);
    assert.deepEqual(p, [...l.positions], l.id);
  }
  assert.deepEqual(lineTracePositions('row-2'), [8, 9, 10, 11]);
  assert.deepEqual(lineTracePositions('col-3'), [3, 7, 11, 15]);
  assert.deepEqual(lineTracePositions('diag-anti'), [3, 6, 9, 12]);
  assert.deepEqual(lineTracePositions('row-4'), [], 'no fifth row on a 4 x 4 board');
  assert.deepEqual(lineTracePositions('nope'), []);
  lineTracePositions('row-0').push(99);
  assert.equal(lineTracePositions('row-0').length, 4, 'returned arrays are copies');
});

test('markLine and staggerIndex set persistent classes and CSS indices', () => {
  const cells = Array.from({ length: 16 }, () => fakeElement());
  const marked = markLine(cells, 'diag-main');
  assert.deepEqual(marked, [0, 5, 10, 15]);
  assert.equal(cells[10].classList.contains('is-on-line'), true);
  assert.equal(cells[10].styles.get('--line-i'), '2');
  assert.equal(cells[1].classList.contains('is-on-line'), false);
  const grid = { children: cells };
  assert.equal(staggerIndex(grid), 16);
  assert.equal(cells[15].styles.get('--i'), '15');
});

// --------------------------------------------------------------------------------------------- animateOnce

test('animateOnce adds the class, removes on animationend, and never blocks', () => {
  const el = fakeElement();
  const timers = fakeTimers();
  let ended = null;
  const cancel = animateOnce(el, 'm-match', { durationMs: 300, onEnd: (r) => { ended = r; }, timers });
  assert.equal(typeof cancel, 'function');
  assert.equal(el.classList.contains('m-match'), true, 'class applied synchronously');
  el.fire('animationend');
  assert.equal(el.classList.contains('m-match'), false);
  assert.equal(ended, 'animationend');
  assert.equal(el.listeners.size, 0, 'listener removed');
  timers.advance(1000);
  assert.equal(ended, 'animationend', 'timeout fallback does not fire twice');
});

test('animateOnce timeout fallback removes the class when animationend never fires', () => {
  const el = fakeElement();
  const timers = fakeTimers();
  let ended = null;
  animateOnce(el, 'm-board-complete', { durationMs: 780, onEnd: (r) => { ended = r; }, timers });
  timers.advance(780); assert.equal(el.classList.contains('m-board-complete'), true, 'still animating within grace');
  timers.advance(50); assert.equal(el.classList.contains('m-board-complete'), false);
  assert.equal(ended, 'timeout');
});

test('animateOnce cancel removes the class immediately; missing element is a no-op', async () => {
  const el = fakeElement();
  const cancel = animateOnce(el, 'm-add', { durationMs: 10 });
  cancel();
  assert.equal(el.classList.contains('m-add'), false);
  assert.equal(typeof animateOnce(null, 'm-add'), 'function');
  // real timers path
  const el2 = fakeElement();
  await new Promise((resolve) => animateOnce(el2, 'm-fade', { durationMs: 5, graceMs: 0, onEnd: resolve }));
  assert.equal(el2.classList.contains('m-fade'), false);
});

test('applyMatch sets the persistent state without animating unless celebrate is true', () => {
  const timers = fakeTimers();
  const a = fakeElement();
  applyMatch(a, { celebrate: false, timers });
  assert.equal(a.classList.contains('is-matched'), true);
  assert.equal(a.classList.contains('m-match'), false);
  const b = fakeElement();
  applyMatch(b, { celebrate: true, timers });
  assert.equal(b.classList.contains('is-matched'), true);
  assert.equal(b.classList.contains('m-match'), true);
  timers.advance(400);
  assert.equal(b.classList.contains('m-match'), false);
  assert.equal(b.classList.contains('is-matched'), true, 'final state persists after the animation');
});

// --------------------------------------------------------------------------------------------- misc

test('prefersReducedMotion is safe in Node and EVENT_MOTION covers the celebration events', () => {
  assert.equal(prefersReducedMotion(), false);
  for (const t of ['draw.accepted', 'bingo.detected', 'result.published', 'soul.created', 'soul.float_accepted', 'board.ready']) {
    assert.ok(EVENT_MOTION[t], `EVENT_MOTION missing ${t}`);
    for (const binding of Object.values(EVENT_MOTION[t])) assert.ok('reduced' in binding && 'celebrate' in binding);
  }
});

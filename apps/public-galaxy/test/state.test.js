import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyPublicSnapshot, reduceEvent, panelViewModel, upcomingRound, effectivePublicState, winnerLabel } from '../src/state.js';
import { t, exception } from '../../../packages/contracts/index.js';
import { displayUrl } from '../src/panel.js';

const NOW = Date.parse('2026-09-22T10:00:00Z');
const round = (state, extra = {}) => ({ roundId: 'rnd_1', number: 2, title: 'Round 2', state, version: 3, lockAt: '2026-09-22T10:04:30Z', startedAt: null, resultWindowEndsAt: null, ...extra });
const env = (type, payload, seq = 10, extra = {}) => ({ eventId: 'evt_demo', roundId: 'rnd_1', sequence: seq, type, occurredAt: '2026-09-22T10:00:01Z', payload, ...extra });

test('snapshot maps Waiting with countdown, QR and previous winners', () => {
  const s = applyPublicSnapshot(initialState(), { sequence: 5, serverTime: '2026-09-22T10:00:00Z', publicState: 'Waiting', notice: null, round: round('REGISTRATION_OPEN'), nextRound: null, join: { joinUrl: 'http://127.0.0.1:8103/play?t=abc', expiresAt: 'x' }, counts: { joined: 3, completed: 2, active: 0, matchedBoards: 0 }, currentDraw: null, recentDraws: [], pacingMessage: '', winners: [], previousWinners: [{ roundNumber: 1, labels: ['Alex T.', 'Soul ABCD'] }], galaxy: { souls: [{ soulId: 'a', config: {} }], count: 1 } });
  const vm = panelViewModel(s, NOW);
  assert.equal(vm.mode, 'Waiting'); assert.equal(vm.title, t('public.waiting.title'));
  assert.equal(vm.roundTitle, 'Round 2'); assert.equal(vm.countdown, '04:30'); assert.equal(vm.registrationOpen, true);
  assert.equal(vm.joinUrl, 'http://127.0.0.1:8103/play?t=abc'); assert.equal(vm.scan, t('public.waiting.scan'));
  assert.equal(vm.previous.length, 1); assert.equal(vm.previous[0].roundLabel, t('public.winner.round', { number: 1 }));
  assert.equal(vm.galaxyCount, 1);
  assert.equal(displayUrl(vm.joinUrl), '127.0.0.1:8103/play');
});

test('Waiting without any round uses E1 copy and no QR; DRAFT round appears as nextRound', () => {
  const s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Waiting', round: null, nextRound: null, join: null, galaxy: { souls: [], count: 0 } });
  const vm = panelViewModel(s, NOW);
  assert.equal(vm.scheduled, false); assert.equal(vm.notScheduled, exception('E1').copy); assert.equal(vm.joinUrl, null);
  const s2 = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Waiting', round: null, nextRound: round('DRAFT'), join: { joinUrl: 'u' }, galaxy: { souls: [], count: 0 } });
  assert.equal(upcomingRound(s2).state, 'DRAFT'); assert.equal(panelViewModel(s2, NOW).countdown, '04:30');
});

test('LOCKED shows the waiting-for-host text instead of a countdown; notices surface for cancelled/exhausted', () => {
  const s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Waiting', round: round('LOCKED'), galaxy: { souls: [], count: 0 } });
  const vm = panelViewModel(s, NOW);
  assert.equal(vm.locked, true); assert.equal(vm.countdown, null); assert.equal(vm.lockedText, t('play.waitingStart'));
  const c = reduceEvent(s, env('round.cancelled', { round: round('CANCELLED'), reason: 'x' }, 2));
  assert.equal(c.state.notice.kind, 'cancelled'); assert.equal(c.state.notice.text, t('public.cancelled')); assert.equal(c.needsSnapshot, true);
  const e = reduceEvent(s, env('round.exhausted', { round: round('EXHAUSTED') }, 2));
  assert.equal(e.state.notice.text, t('public.exhausted')); assert.equal(panelViewModel(e.state, NOW).mode, 'Waiting');
});

test('Playing: draw.accepted updates the card, the previous five draws, matched count and pacing', () => {
  let s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Waiting', round: round('LOCKED'), galaxy: { souls: [], count: 0 } });
  s = reduceEvent(s, env('round.started', { round: round('PLAYING', { startedAt: '2026-09-22T10:05:00Z' }), poolSize: 30 }, 2)).state;
  assert.equal(s.publicState, 'Playing');
  for (let n = 1; n <= 7; n++) {
    s = reduceEvent(s, env('draw.accepted', { draw: { drawId: `d${n}`, number: n, skill: { id: `sk${n}`, name: `Skill ${n}`, kind: n % 2 ? 'Core' : 'Critical', domain: 'Dev' }, drawnAt: 'x' }, poolRemaining: 30 - n, matchedBoards: n * 3, bingoEvaluationActive: n >= 5 }, 2 + n)).state;
  }
  const vm = panelViewModel(s, NOW);
  assert.equal(vm.mode, 'Playing'); assert.equal(vm.drawLabel, t('public.playing.draw', { number: 7 })); assert.equal(vm.skillName, 'Skill 7'); assert.equal(vm.kind, 'Core');
  assert.equal(vm.matched, t('public.playing.matched', { count: 21 })); assert.equal(vm.pacing, t('public.playing.live')); assert.equal(vm.live, true);
  // D-36: the panel lists the previous five draws, newest first; the current one is on the card, not in the list
  assert.deepEqual(vm.recentDraws.map((r) => r.number), [6, 5, 4, 3, 2]);
  assert.equal(s.recentDraws.length, 6, 'the state keeps six: the current draw and the five before it');
  const early = reduceEvent(s, env('draw.match_counts_updated', { drawNumber: 7, matchedBoards: 25 }, 20)).state;
  assert.equal(panelViewModel(early, NOW).matched, t('public.playing.matched', { count: 25 }));
});

test('Playing: the first draws - no previous draw on the first, then the ones before the current, newest first', () => {
  let s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Waiting', round: round('LOCKED'), galaxy: { souls: [], count: 0 } });
  s = reduceEvent(s, env('round.started', { round: round('PLAYING', { startedAt: '2026-09-22T10:05:00Z' }), poolSize: 30 }, 2)).state;
  const draw = (n, seq) => env('draw.accepted', { draw: { drawId: `d${n}`, number: n, skill: { id: `sk${n}`, name: `Skill ${n}`, kind: 'Core', domain: 'Dev' }, drawnAt: 'x' }, poolRemaining: 30 - n, matchedBoards: 0 }, seq);
  s = reduceEvent(s, draw(1, 3)).state;
  assert.deepEqual(panelViewModel(s, NOW).recentDraws, []);
  s = reduceEvent(reduceEvent(s, draw(2, 4)).state, draw(3, 5)).state;
  assert.deepEqual(panelViewModel(s, NOW).recentDraws.map((r) => [r.number, r.skillName]), [[2, 'Skill 2'], [1, 'Skill 1']]);
});

test('pacing reads "Bingo unlocks at draw 5" before draw 5', () => {
  let s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Playing', round: round('PLAYING'), galaxy: { souls: [], count: 0 } });
  s = reduceEvent(s, env('draw.accepted', { draw: { number: 2, skill: { id: 'a', name: 'Kubernetes', kind: 'Critical' } }, matchedBoards: 4, bingoEvaluationActive: false }, 2)).state;
  const vm = panelViewModel(s, NOW);
  assert.equal(vm.pacing, t('public.playing.pacing')); assert.equal(vm.live, false);
});

test('Winner: result.published sets co-winner labels; round.closed returns to Waiting and records previous winners', () => {
  let s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Playing', round: round('PLAYING'), galaxy: { souls: [], count: 0 } });
  s = reduceEvent(s, env('bingo.detected', { drawNumber: 6, winnerCount: 2 }, 2)).state;
  assert.equal(s.publicState, 'Playing'); assert.equal(s.bingo.winnerCount, 2);
  s = reduceEvent(s, env('result.published', { round: round('WINNER'), winners: [{ label: 'Alex T.', soulId: 'sa' }, { label: null, soulId: 'sb' }], resultWindowEndsAt: '2026-09-22T10:10:15Z' }, 3)).state;
  let vm = panelViewModel(s, NOW);
  assert.equal(vm.mode, 'Winner'); assert.equal(vm.title, t('public.winner.title')); assert.equal(vm.roundLabel, t('public.winner.round', { number: 2 }));
  assert.equal(vm.labels.length, 2); assert.equal(vm.labels[0], 'Alex T.'); assert.match(vm.labels[1], /^Soul #/);
  assert.equal(vm.resultWindowEndsAt, '2026-09-22T10:10:15Z');
  // display fallback when the result window elapsed before round.closed arrives
  assert.equal(effectivePublicState({ ...s, resultWindowElapsed: true }), 'Waiting');
  s = reduceEvent(s, env('round.closed', { round: round('CLOSED') }, 4)).state;
  vm = panelViewModel(s, NOW);
  assert.equal(vm.mode, 'Waiting'); assert.equal(s.previousWinners[0].roundNumber, 2); assert.deepEqual(s.previousWinners[0].labels[0], 'Alex T.');
  assert.equal(vm.previous.length, 1); assert.equal(vm.previous[0].labels[0], 'Alex T.');
  // the server projection keeps the closed round as `round` (winners populated, previousWinners excludes it)
  const snap = applyPublicSnapshot(initialState(), { sequence: 9, publicState: 'Waiting', round: round('CLOSED'), winners: [{ label: 'Noor K.', soulId: 'x' }], previousWinners: [{ roundNumber: 1, labels: ['Sam O.'] }], galaxy: { souls: [], count: 0 } });
  const rows = panelViewModel(snap, NOW).previous;
  assert.equal(rows.length, 2); assert.equal(rows[0].roundLabel, t('public.winner.round', { number: 2 })); assert.equal(rows[0].labels[0], 'Noor K.'); assert.equal(rows[1].labels[0], 'Sam O.');
  assert.equal(winnerLabel({ label: '  ', soulId: 'x' }).startsWith('Soul #'), true);
});

test('soul.float_accepted adds each Soul once; participation.updated merges counts; stale events are ignored by main (sequence)', () => {
  let s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Waiting', galaxy: { souls: [{ soulId: 'a', config: {} }], count: 1 } });
  const entrance = { soulId: 'b', config: { seed: 'b' }, badge: 'bingo-star', label: null, enteredAt: 'x', edge: 'left' };
  s = reduceEvent(s, env('soul.float_accepted', { entrance }, 2)).state;
  s = reduceEvent(s, env('soul.float_accepted', { entrance }, 3)).state;
  assert.equal(s.galaxy.count, 2); assert.equal(s.galaxy.souls[1].edge, 'left');
  s = reduceEvent(s, env('participation.updated', { counts: { joined: 50, completed: 40, active: 0, matchedBoards: 0 } }, 4)).state;
  assert.equal(s.counts.joined, 50);
  assert.equal(reduceEvent(s, env('system.snapshot_required', { reason: 'x' }, 5)).needsSnapshot, true);
});

test('snapshot after reconnect wins over local state and dedups Souls', () => {
  let s = applyPublicSnapshot(initialState(), { sequence: 1, publicState: 'Playing', round: round('PLAYING'), galaxy: { souls: [], count: 0 } });
  s = { ...s, resultWindowElapsed: true, bingo: { drawNumber: 1 } };
  s = applyPublicSnapshot(s, { sequence: 9, publicState: 'Waiting', round: round('CLOSED'), galaxy: { souls: [{ soulId: 'a', config: {} }, { soulId: 'a', config: {} }], count: 2 } });
  assert.equal(s.sequence, 9); assert.equal(s.publicState, 'Waiting'); assert.equal(s.resultWindowElapsed, false); assert.equal(s.bingo, null);
  assert.equal(s.galaxy.souls.length, 1);
});

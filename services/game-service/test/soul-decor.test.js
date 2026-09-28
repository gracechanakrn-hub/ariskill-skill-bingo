// Soul decorations at round end (D-29, D-31, BR-16, BR-17): each finished board gets a v3 Soul whose charm split follows its
// 16 selected skills' kinds, whose face follows the kinds of its matched tiles, and whose face plate, eyes and antenna charm
// (topper) come from its seed only; the phone, the public screen and the stage stream all carry that same config. Any
// decoration fault gives the neutral Soul, still a v2 config, and Souls stored under earlier contracts are served unchanged.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, join, readyBoard, startRound, drawUntilEnd, readSse, lineScenario, setPool, OPTIONAL_IDS, EVENT_ID, CELLS } from './helpers.js';
import { SKILL_MASTER, SKILLS } from '../src/skills.js';
import { findForbiddenKeys } from '../src/projections.js';
import {
  validateSoulConfig, neutralSoulConfig, soulSeed, splitCharmSlots, faceForMatches, countSkillKinds, pickPlate, pickEyes, pickTopper, CHARM_BY_ID,
  SOUL_CONFIG_SCHEMA_V2, SOUL_CONFIG_SCHEMA_V3,
} from '../../../packages/game-rules/src/index.js';

const eligible = (s) => s.isCore || s.isCritical;
const idsOf = (kind, pred) => SKILL_MASTER.skills.filter(s => s.kind === kind && pred(s)).map(s => s.id).sort();
const CORE = idsOf('Core Skill', eligible), SOFT = idsOf('Soft Skill', eligible), HARD = idsOf('Hard Skill', eligible);
const OPT_SOFT = OPTIONAL_IDS.filter(id => SKILLS.get(id).kind === 'Soft Skill'), OPT_HARD = OPTIONAL_IDS.filter(id => SKILLS.get(id).kind === 'Hard Skill');
const V3_KEYS = Object.keys(SOUL_CONFIG_SCHEMA_V3), V2_KEYS = Object.keys(SOUL_CONFIG_SCHEMA_V2);
const ENTRANCE_KEYS = ['badge', 'config', 'edge', 'enteredAt', 'greeting', 'label', 'soulId'];
const charmKinds = (charms) => { const out = { core: 0, technical: 0, soft: 0 }; for (const id of charms) out[CHARM_BY_ID.get(id).kind] += 1; return out; };
const kindsOfIds = (ids) => countSkillKinds(ids.map(id => SKILLS.get(id).kind));

// selection -> expected split, worked by hand from the rule (floor quota, largest remainder, at least one per kind picked)
const PLAYERS = [
  { name: 'Mixed', set: [...CORE.slice(0, 7), ...HARD.slice(0, 3), ...SOFT.slice(0, 6)], split: { core: 4, technical: 2, soft: 4 } },
  { name: 'Technical', set: HARD.slice(10, 26), split: { core: 0, technical: 10, soft: 0 } },
  { name: 'MinOne', set: [CORE[0], SOFT[0], ...HARD.slice(40, 54)], split: { core: 1, technical: 8, soft: 1 } },
  // every active skill is drawable (D-33), so this board's skills are kept out of the round's pool below
  { name: 'NeverMatched', set: [...OPT_SOFT.slice(0, 6), ...OPT_HARD.slice(0, 10)], split: { core: 0, technical: 6, soft: 4 } },
];

describe('Soul decorations at round end (D-29)', () => {
  let t, players, publicStream, stageStream, participantStream;
  before(async () => {
    assert.equal(CORE.length, 7); assert.ok(SOFT.length >= 6 && OPT_SOFT.length >= 6 && OPT_HARD.length >= 10 && HARD.length >= 54);
    t = await startServer({ rngSeed: 'svc-soul-decor-1' });
    const round = await createRound(t, { title: 'Decor' });
    players = [];
    for (const [i, def] of PLAYERS.entries()) {
      assert.equal(new Set(def.set).size, CELLS, def.name);
      const p = await join(t, { displayName: def.name, consent: i % 2 === 0 });
      await readyBoard(t, p, def.set);
      players.push({ ...def, p });
    }
    const started = await startRound(t, round);
    const never = new Set(PLAYERS.find(d => d.name === 'NeverMatched').set);
    setPool(t.db, round.roundId, [...new Set(PLAYERS.flatMap(d => d.set))].filter(id => !never.has(id)));
    participantStream = readSse(t.baseUrl, '/me/stream', { token: players[0].p.token, timeoutMs: 2000, until: ev => ev.some(e => e.event === 'soul.created') });
    await new Promise(r => setTimeout(r, 50));
    const end = await drawUntilEnd(t, started);
    assert.equal(end.round.state, 'WINNER'); // D-53: always a winner (closest line when the pool empties)
    for (const pl of players) pl.me = (await t.api.get('/me', pl.p.token)).body;
  });
  after(async () => { await t.close(); });

  test('every finished board gets one v3 Soul with exactly the SoulConfig keys, valid, stored as served', () => {
    for (const { name, me } of players) {
      assert.equal(me.board.state, 'FINISHED', name);
      const cfg = me.soul.config;
      assert.equal(cfg.version, 3, name); assert.equal(cfg.catalog, 2, name); assert.deepEqual(Object.keys(cfg), V3_KEYS, name); assert.equal(validateSoulConfig(cfg).ok, true, name);
      assert.equal(cfg.seed, soulSeed({ eventId: EVENT_ID, participantId: me.participant.participantId, roundId: me.board.roundId }), `${name} seed from the Soul record`);
      assert.equal(t.db.get('SELECT COUNT(*) AS c FROM souls WHERE board_id = ?', me.board.boardId).c, 1, `${name} exactly one Soul`);
      assert.deepEqual(JSON.parse(t.db.get('SELECT config_json FROM souls WHERE board_id = ?', me.board.boardId).config_json), cfg);
    }
  });

  test('the charm split matches each board\'s selected skills (by skill-master kind)', () => {
    for (const { name, me, split } of players) {
      assert.equal(me.soul.config.charms.length, 10, name);
      assert.deepEqual(charmKinds(me.soul.config.charms), split, name);
      assert.deepEqual(splitCharmSlots(kindsOfIds(me.board.selectedSkillIds)), split, `${name}: rule applied to the selection`);
    }
  });

  test('the face matches each board\'s matched tiles at round end; a board that never matched is nerdy', () => {
    const faces = new Set();
    for (const { name, me } of players) {
      const matched = new Set(me.board.matchedPositions);
      const matchedIds = me.board.cells.filter(c => matched.has(c.position)).map(c => c.skillId);
      assert.equal(me.soul.config.face, faceForMatches(kindsOfIds(matchedIds)), name);
      faces.add(me.soul.config.face);
    }
    const never = players.find(pl => pl.name === 'NeverMatched').me;
    assert.deepEqual(never.board.matchedPositions, []); assert.equal(never.soul.config.face, 'nerdy');
    assert.ok(faces.size >= 2, `the round exercises more than one face: ${[...faces]}`);
  });

  test('the face plate, eyes and antenna charm are the seed picks (never from skills); the topper is never one of the charms', () => {
    for (const { name, me } of players) {
      const cfg = me.soul.config;
      assert.equal(cfg.plate, pickPlate(cfg.seed), `${name} plate`); assert.equal(cfg.eyes, pickEyes(cfg.seed), `${name} eyes`);
      assert.equal(cfg.topper, pickTopper(cfg.seed, cfg.charms), `${name} topper`);
      assert.ok(CHARM_BY_ID.has(cfg.topper) && !cfg.charms.includes(cfg.topper), `${name}: ${cfg.topper} tops the antenna, not a body charm`);
      for (const v of [cfg.plate, cfg.eyes, cfg.topper, ...cfg.charms]) assert.ok(!SKILLS.has(v) && ![...SKILLS.values()].some(s => s.name === v), `${name}: ${v} is no skill id or name`);
    }
  });

  test('the phone, the public screen and the stage stream get the same config and nothing else new', async () => {
    const { events } = await participantStream;
    const created = events.find(e => e.event === 'soul.created');
    assert.deepEqual(created.data.payload.soul.config, players[0].me.soul.config, 'soul.created carries the stored config');
    const streams = [readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { timeoutMs: 1500, until: ev => ev.filter(e => e.event === 'soul.float_accepted').length === 2 }),
      readSse(t.baseUrl, `/stage/events/${EVENT_ID}/stream`, { token: t.stage, timeoutMs: 1500, until: ev => ev.filter(e => e.event === 'soul.float_accepted').length === 2 })];
    await new Promise(r => setTimeout(r, 50));
    for (const pl of players.slice(0, 2)) assert.equal((await t.api.post('/me/soul/float', { soulId: pl.me.soul.soulId, floatToken: pl.me.soul.floatToken }, pl.p.token)).status, 200);
    const [pub, stage] = await Promise.all(streams);
    const snapshot = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    for (const pl of players.slice(0, 2)) {
      const own = pl.me.soul.config;
      const galaxy = snapshot.galaxy.souls.find(s => s.soulId === pl.me.soul.soulId);
      assert.deepEqual(Object.keys(galaxy).sort(), ENTRANCE_KEYS); assert.deepEqual(galaxy.config, own, `${pl.name} galaxy`);
      assert.deepEqual(Object.keys(galaxy.config), V3_KEYS, `${pl.name} galaxy: plate, eyes and topper pass the public projection`);
      for (const [aud, res] of [['public', pub], ['stage', stage]]) {
        const ev = res.events.find(e => e.event === 'soul.float_accepted' && e.data.payload.entrance.soulId === pl.me.soul.soulId);
        assert.ok(ev, `${aud} saw ${pl.name}'s entrance`);
        assert.deepEqual(Object.keys(ev.data.payload.entrance).sort(), ENTRANCE_KEYS, aud);
        assert.deepEqual(Object.keys(ev.data.payload.entrance.config), V3_KEYS, aud); assert.deepEqual(ev.data.payload.entrance.config, own, `${aud} ${pl.name}`);
        assert.deepEqual(findForbiddenKeys(aud, ev.data), [], `${aud} ${pl.name}: nothing the ${aud} contract forbids`);
      }
    }
    assert.deepEqual(findForbiddenKeys('public', snapshot), []);
  });
});

test('a Soul stored under an earlier contract (v2, v1) is served exactly as stored: owner, Float entrance, Galaxy and stage stream', async () => {
  const t = await startServer({ rngSeed: 'svc-soul-decor-3' });
  try {
    const round = await createRound(t, { title: 'Stored' });
    const players = [];
    for (const name of ['Stored V2', 'Stored V1']) { const p = await join(t, { displayName: name }); await readyBoard(t, p, HARD.slice(players.length * CELLS, players.length * CELLS + CELLS)); players.push(p); }
    await drawUntilEnd(t, await startRound(t, round));
    // what the service wrote at round end under contracts 1.1.0 (v2, catalog 1) and 1.0.x (v1)
    const stored = [
      { version: 2, catalog: 1, seed: '0e7c71a4f4779e', gradient: 5, glow: 0, face: 'pirate', charms: ['tech-microchip', 'tech-magnifier', 'tech-lightbulb', 'core-twin-lilac', 'tech-drone', 'tech-server', 'tech-padlock', 'tech-book', 'tech-robot', 'soft-sunflower'], constellation: [{ domain: 'Design', weight: 1 }], driftPhase: 0.133 },
      { version: 1, seed: '0e7c71a4f4779e', body: 1, palette: 3, eyes: 3, antenna: 2, mouth: 1, glow: 0, constellation: [{ domain: 'Design', weight: 1 }], driftPhase: 0.133 },
    ];
    for (const [i, p] of players.entries()) {
      assert.equal(validateSoulConfig(stored[i]).ok, true);
      t.db.run('UPDATE souls SET config_json = ? WHERE participant_id = ?', JSON.stringify(stored[i]), p.participantId);
    }
    const stageStream = readSse(t.baseUrl, `/stage/events/${EVENT_ID}/stream`, { token: t.stage, timeoutMs: 1500, until: ev => ev.filter(e => e.event === 'soul.float_accepted').length === 2 });
    await new Promise(r => setTimeout(r, 50));
    for (const [i, p] of players.entries()) {
      const me = (await t.api.get('/me', p.token)).body;
      assert.deepEqual(me.soul.config, stored[i], `${p.displayName}: owner`);
      const f = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken }, p.token);
      assert.equal(f.status, 200); assert.deepEqual(f.body.entrance.config, stored[i], `${p.displayName}: entrance`);
    }
    const galaxy = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body.galaxy.souls;
    const { events } = await stageStream;
    for (const cfg of stored) {
      assert.deepEqual(galaxy.filter(s => s.config.version === cfg.version).map(s => s.config), [cfg], `v${cfg.version} on the Galaxy`);
      assert.deepEqual(events.filter(e => e.event === 'soul.float_accepted' && e.data.payload.entrance.config.version === cfg.version).map(e => e.data.payload.entrance.config), [cfg], `v${cfg.version} on the stage`);
    }
  } finally { await t.close(); }
});

test('a decoration that cannot be built never fails the final draw: the Soul gets the neutral config, a v2 config (BR-17)', async () => {
  const t = await startServer({ rngSeed: 'svc-soul-decor-2' });
  try {
    const sc = await lineScenario(t);
    const saved = t.db.get('SELECT selected_json FROM boards WHERE id = ?', sc.b.boardId).selected_json;
    t.db.run('UPDATE boards SET selected_json = ? WHERE id = ?', '{not json', sc.b.boardId);
    const end = await drawUntilEnd(t, sc.round);
    assert.equal(end.round.state, 'WINNER', 'the winning draw still commits');
    t.db.run('UPDATE boards SET selected_json = ? WHERE id = ?', saved, sc.b.boardId);
    const me = (await t.api.get('/me', sc.p.token)).body;
    const seed = soulSeed({ eventId: EVENT_ID, participantId: sc.p.participantId, roundId: sc.round.roundId });
    assert.deepEqual(me.soul.config, neutralSoulConfig(seed)); assert.equal(me.soul.badge, 'bingo-star');
    assert.equal(me.soul.config.version, 2); assert.deepEqual(Object.keys(me.soul.config), V2_KEYS);
    assert.equal(me.soul.config.face, null); assert.deepEqual(me.soul.config.charms, []);
  } finally { await t.close(); }
});

test('a v3 config that fails validation (no skill kind counted, so no charms) also gives the neutral v2 Soul; the draw commits', async () => {
  const t = await startServer({ rngSeed: 'svc-soul-decor-4' });
  try {
    const sc = await lineScenario(t, { extraPlayers: [{ join: { displayName: 'Other Player' } }] });
    const saved = t.db.get('SELECT selected_json FROM boards WHERE id = ?', sc.b.boardId).selected_json;
    const gone = JSON.parse(saved).map((_, i) => `skill_retired_${i}`); // valid JSON, but no skill the catalogue knows
    assert.deepEqual(countSkillKinds(gone.map(id => SKILLS.get(id)?.kind)), { core: 0, technical: 0, soft: 0 }, 'no skill kind counted, so the v3 config has no charms');
    t.db.run('UPDATE boards SET selected_json = ? WHERE id = ?', JSON.stringify(gone), sc.b.boardId);
    const end = await drawUntilEnd(t, sc.round);
    assert.equal(end.round.state, 'WINNER', 'the winning draw still commits');
    t.db.run('UPDATE boards SET selected_json = ? WHERE id = ?', saved, sc.b.boardId);
    const me = (await t.api.get('/me', sc.p.token)).body;
    const seed = soulSeed({ eventId: EVENT_ID, participantId: sc.p.participantId, roundId: sc.round.roundId });
    assert.deepEqual(me.soul.config, neutralSoulConfig(seed)); assert.equal(me.soul.config.version, 2);
    assert.equal(validateSoulConfig(me.soul.config).ok, true);
    const others = t.db.all('SELECT config_json FROM souls WHERE board_id != ?', sc.b.boardId).map(r => JSON.parse(r.config_json));
    assert.ok(others.length > 0 && others.every(c => c.version === 3), 'the other boards of the round still get v3 Souls');
  } finally { await t.close(); }
});

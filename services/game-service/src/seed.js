// Demo seed and deterministic fixture generator.
//   node services/game-service/src/seed.js            -> demo event evt_demo, "Round 1" (DRAFT), SEED_PLAYERS simulated READY boards (idempotent)
//   node services/game-service/src/seed.js --fixture  -> tests/fixtures/seeded-round.json (in-memory, BINGO_RNG_SEED=fixture-1)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, describeConfig, REPO_ROOT } from './config.js';
import { openDatabase, json } from './db.js';
import { createClock } from './clock.js';
import { createLogger } from './log.js';
import { createApp } from './app.js';
import { signJoinToken, employeeRefHash } from './auth.js';
import { newId } from './ids.js';
import { SKILL_MASTER, ROLES, PLATFORMS, ROLE_SKILL_LEVELS } from './skills.js';
import { seededRng, shuffle, CELLS } from '../../../packages/game-rules/src/index.js';

const FIRST = ['Avery', 'Blake', 'Casey', 'Devin', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Noel', 'Parker', 'Quinn', 'Reese', 'Sage', 'Taylor', 'Uma', 'Val', 'Wren'];
const LAST = ['Rivera', 'Chen', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Ito', 'Mbeki', 'Larsen', 'Patel'];
const ACTIVE = SKILL_MASTER.skills.filter(s => s.status === 'active').map(s => s.id).sort();
const ELIGIBLE = ACTIVE;
const CORE7 = SKILL_MASTER.skills.filter(s => s.kind === 'Core Skill' && s.status === 'active').map(s => s.id).sort();
const LEVEL_ORDER = { core: 0, critical: 1, optional: 2 };

export function simulatedName(i) { return `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`; }
/** 16 deterministic skills picked like the 3-question flow: some of the 7 core skills, then role skills, then search fill. */
export function boardForRole(roleId, ref) {
  const rng = seededRng(`seed-board:${ref}`);
  const levels = ROLE_SKILL_LEVELS.get(roleId) ?? new Map();
  const rec = [...levels.entries()].sort((a, b) => LEVEL_ORDER[a[1]] - LEVEL_ORDER[b[1]] || a[0].localeCompare(b[0])).map(e => e[0]).filter(id => ACTIVE.includes(id));
  const picked = CORE7.filter(() => rng.int(100) < 55);
  const add = (id) => { if (picked.length < CELLS && !picked.includes(id)) picked.push(id); };
  for (const id of shuffle(rec, rng)) if (rng.int(100) < 60) add(id);
  for (const id of shuffle(ACTIVE, rng)) add(id);
  return picked;
}
function meta(actor) { return { actor, correlationId: newId('correlation'), commandId: newId('command') }; }

/** Create (or reuse) a participant with an explicit profile and a READY board through the real service functions. */
function seedPlayer(app, eventId, { employeeRef, displayName, consent, platformId, roleId, skillIds }) {
  const { participants, db, config } = app;
  const existing = db.get('SELECT * FROM participants WHERE event_id = ? AND employee_ref_hash = ?', eventId, employeeRefHash(config, eventId, employeeRef));
  let participant = existing;
  if (!participant) {
    const s = participants.createSession(eventId, { joinToken: signJoinToken(config.joinSecret, eventId, Math.floor(app.clock.now() / 1000) + 3600), employeeRef, displayName, consentPublicName: consent }, meta('seed'));
    participant = db.get('SELECT * FROM participants WHERE id = ?', s.participantId);
  }
  if (!participant.platform_id) { participants.setProfile(participant, { platformId, roleId }, meta(participant.id)); participant = db.get('SELECT * FROM participants WHERE id = ?', participant.id); }
  const current = participants.currentBoard(participant);
  if (current && current.state !== 'DRAFT') return { participant, board: current, created: false };
  const saved = participants.saveSelections(participant, { skillIds, boardVersion: current?.version ?? 0 }, meta(participant.id));
  const fin = participants.finalize(participant, { boardVersion: saved.resultingVersion }, meta(participant.id));
  return { participant, board: fin.board, created: true };
}

async function seedDemo() {
  const config = loadConfig(process.env);
  const db = openDatabase(config.dbPath);
  const app = createApp({ db, clock: createClock(), config, log: createLogger('silent') });
  const eventId = config.defaultEventId;
  app.game.ensureEvent(eventId, config.defaultEventName);
  let round = db.get('SELECT * FROM rounds WHERE event_id = ? ORDER BY number DESC LIMIT 1', eventId);
  let createdRound = false;
  if (!round) {
    const r = app.game.createRound(eventId, { title: 'Round 1', lockAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), resultWindowSeconds: 12 }, meta('seed'));
    round = db.get('SELECT * FROM rounds WHERE id = ?', r.round.roundId); createdRound = true;
  }
  const n = Number.parseInt(process.env.SEED_PLAYERS ?? '40', 10);
  let created = 0, skipped = 0;
  const canBuild = ['DRAFT', 'REGISTRATION_OPEN'].includes(round.state) && Date.parse(round.lock_at) > Date.now();
  for (let i = 1; i <= n; i++) {
    const role = ROLES[(i * 7) % ROLES.length];
    const employeeRef = `sim-${String(i).padStart(3, '0')}`;
    if (!canBuild) { skipped += 1; continue; }
    try {
      const r = seedPlayer(app, eventId, { employeeRef, displayName: simulatedName(i - 1), consent: i % 2 === 1, platformId: PLATFORMS[(i * 5) % PLATFORMS.length].id, roleId: role.id, skillIds: boardForRole(role.id, employeeRef) }); // D-55: independent platform
      if (r.created) created += 1; else skipped += 1;
    } catch (e) { skipped += 1; process.stderr.write(`player ${employeeRef}: ${e.message}\n`); }
  }
  const joinInfo = (await import('./auth.js')).currentJoinLink(db, config, app.clock, eventId);
  const base = config.publicBaseUrl.replace(/\/$/, '');
  process.stdout.write([
    describeConfig(config),
    `Seeded event ${eventId} ("${config.defaultEventName}")`,
    `  round: ${round.title} [${round.state}] version ${round.version} lockAt ${round.lock_at}${createdRound ? ' (created)' : ' (existing)'}`,
    `  players: ${created} boards created, ${skipped} skipped (already seeded or round not editable)`,
    `  admin URL:  ${base}/admin   (token: ${config.env === 'production' ? '<BINGO_ADMIN_TOKEN>' : config.adminToken})`,
    `  stage URL:  ${base}/stage   (token: ${config.env === 'production' ? '<BINGO_STAGE_TOKEN>' : config.stageToken})`,
    `  public URL: ${base}/public`,
    `  sample player join URL: ${joinInfo.joinUrl}`,
    `  join link expires: ${joinInfo.expiresAt}`,
  ].join('\n') + '\n');
  await app.close(); db.close();
}

/** Deterministic in-memory round: 6 boards (two identical pairs so a same-draw co-winner case exists), replayable by e2e. */
export async function buildFixture() {
  const config = loadConfig({}, { env: 'test', dbPath: ':memory:', rngSeed: 'fixture-1', logLevel: 'silent', adminToken: 'fixture-admin', stageToken: 'fixture-stage', joinSecret: 'fixture-join', sessionSecret: 'fixture-session', rateLimits: { commandsPerSec: 1e6, sessionPerMin: 1e6, discoveryPerSec: 1e6 } });
  const db = openDatabase(':memory:');
  const clock = createClock();
  const app = createApp({ db, clock, config, log: createLogger('silent') });
  const eventId = config.defaultEventId;
  app.game.ensureEvent(eventId, config.defaultEventName);
  const A = ELIGIBLE.slice(0, CELLS), B = ELIGIBLE.slice(CELLS, 2 * CELLS), C = ELIGIBLE.slice(2 * CELLS, 3 * CELLS), D = ELIGIBLE.slice(3 * CELLS, 4 * CELLS);
  const roles = [ROLES[1], ROLES[1], ROLES[6], ROLES[6], ROLES[12], ROLES[20]];
  const defs = [
    { employeeRef: 'fixture-001', displayName: 'Avery Rivera', consent: true, skillIds: A },
    { employeeRef: 'fixture-002', displayName: 'Blake Chen', consent: false, skillIds: A },
    { employeeRef: 'fixture-003', displayName: 'Casey Okafor', consent: true, skillIds: B },
    { employeeRef: 'fixture-004', displayName: 'Devin Silva', consent: true, skillIds: B },
    { employeeRef: 'fixture-005', displayName: 'Emery Novak', consent: false, skillIds: C },
    { employeeRef: 'fixture-006', displayName: 'Finley Haddad', consent: true, skillIds: D },
  ].map((d, i) => ({ ...d, platformId: PLATFORMS[i * 3].id, roleId: roles[i].id }));
  const lockAt = new Date(clock.now() + 60 * 60 * 1000).toISOString();
  const created = app.game.createRound(eventId, { title: 'Fixture Round', lockAt, resultWindowSeconds: 12 }, meta('admin'));
  let round = created.round;
  const cmd = (command, params = {}) => { const r = app.game.command(round.roundId, { command, expectedVersion: round.version, params }, meta('admin')); round = r.round; return r; };
  cmd('round.registration.open');
  const players = defs.map(d => seedPlayer(app, eventId, d));
  const boards = players.map((p, i) => ({ ...defs[i], participantId: p.participant.id, boardId: p.board.boardId, cells: p.board.cells.map(c => c.skillId) }));
  const start = cmd('round.start_now', { confirmed: true }); // D-53: one step from REGISTRATION_OPEN to PLAYING
  const draws = [];
  let winners = null;
  while (round.state === 'PLAYING') {
    const r = cmd('round.draw.next');
    draws.push({ number: r.effects.draw.number, skillId: r.effects.draw.skill.id, name: r.effects.draw.skill.name, kind: r.effects.draw.skill.kind, matchedBoards: r.effects.matchedBoards, poolRemaining: r.effects.poolRemaining });
    if (r.effects.winners) winners = r.effects.winners;
  }
  const refOf = new Map(boards.map(b => [b.participantId, b.employeeRef]));
  const fixture = {
    fixtureVersion: 1,
    description: 'Deterministic seeded round produced by running the real game-service commands in memory. Replay against a fresh server (BINGO_ENV=test, BINGO_DB_PATH=:memory:, BINGO_RNG_SEED=fixture-1, default guided draws): create the first round of evt_demo, open registration, join the six players with explicit profiles, save + finalize the listed skillIds in order, start now (round.start_now {confirmed:true}), then draw until the round leaves PLAYING. Draw order, winning draw number and co-winners must match `expected`.',
    generatedAt: clock.iso(),
    env: { BINGO_ENV: 'test', BINGO_DB_PATH: ':memory:', BINGO_RNG_SEED: config.rngSeed, BINGO_DRAW_GUIDANCE: config.drawGuidance ? 'on' : 'off' },
    determinism: { draws: `${config.drawGuidance ? 'guidedDraw (D-33, DRAW_POLICY) driven by' : 'uniform pick with'} seededRng(\`\${BINGO_RNG_SEED}:\${eventId}:round-\${roundNumber}:draw-\${drawNumber}\`) over the sorted remaining pool`, boardLayout: 'seededRng(`${BINGO_RNG_SEED}:board:${sortedSkillIds.join(",")}`) Fisher-Yates over the selection set; identical sets get identical layouts' },
    eventId,
    round: { title: 'Fixture Round', number: 1, resultWindowSeconds: 12, lockAtHint: '+1h from now (any future time; play is started by round.start_now before it)' },
    commands: ['round.registration.open', 'round.start_now {confirmed:true}', 'round.draw.next (repeat until state != PLAYING)'],
    boards: boards.map(b => ({ employeeRef: b.employeeRef, displayName: b.displayName, consentPublicName: b.consent, platformId: b.platformId, roleId: b.roleId, skillIds: b.skillIds })),
    expected: {
      start: { activeBoards: start.effects.activeBoards, unfinishedBoards: start.effects.unfinishedBoards, deferredBoards: start.effects.deferredBoards },
      poolSize: start.effects.poolSize,
      pool: json.parse(db.get('SELECT pool_json FROM rounds WHERE id = ?', round.roundId).pool_json),
      boardLayouts: boards.map(b => ({ employeeRef: b.employeeRef, cells: b.cells })),
      draws,
      totalDraws: draws.length,
      outcome: round.state,
      winningDrawNumber: winners ? winners[0].winningDrawNumber : null,
      coWinnerRefs: winners ? winners.map(w => refOf.get(w.participantId)).sort() : [],
      consentedWinnerLabels: winners ? winners.map(w => w.label).filter(l => !l.startsWith('Soul #')).sort() : [], pseudonymNote: 'non-consented winners show as Soul #NNNN derived from the (random) participant id, so they are not part of the expectation',
      winnerLineIds: winners ? Object.fromEntries(winners.map(w => [refOf.get(w.participantId), w.lineIds])) : {},
      finalRoundVersion: round.version,
    },
  };
  await app.close(); db.close();
  return fixture;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--fixture')) {
    const fixture = await buildFixture();
    if (fixture.expected.coWinnerRefs.length < 2) { process.stderr.write('fixture produced no co-winner case; adjust board composition\n'); process.exit(1); }
    const out = resolve(REPO_ROOT, 'tests/fixtures/seeded-round.json');
    mkdirSync(resolve(REPO_ROOT, 'tests/fixtures'), { recursive: true });
    writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
    process.stdout.write(`wrote ${out}: ${fixture.expected.totalDraws} draws, outcome ${fixture.expected.outcome}, winning draw ${fixture.expected.winningDrawNumber}, co-winners ${fixture.expected.coWinnerRefs.join(', ')}\n`);
  } else {
    await seedDemo();
  }
}

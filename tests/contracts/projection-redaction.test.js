// Projection redaction contract (requirement 12.1, 14, AC 12; P-03, P-04, S-01..S-03, BR-18). Release-gate severity: critical.
// Forbidden lists are parsed from contracts/projections/*.json (not from the service), audiences from contracts/realtime-events.json.
// A full round with a consented and a non-consented co-winner, a third player, private insights and two Floats is driven through
// the HTTP API; every snapshot of every audience and every SSE payload of every audience is scanned.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, me, readyBoard, boardSet, mixedSet, drawUntilEnd, openStream, closeByTimer, sleep, nextKey, ELIGIBLE_IDS, REGEX_TRIPPING_SKILL_IDS, privacyTextHits, findKeys, forbiddenKeysFromContract, roleAt, SOUL_CONFIG_KEYS, skillStringsIn } from '../e2e/helpers.js';
import publicContract from '../../contracts/projections/public.json' with { type: 'json' };
import stageContract from '../../contracts/projections/stage.json' with { type: 'json' };
import adminContract from '../../contracts/projections/admin.json' with { type: 'json' };
import participantContract from '../../contracts/projections/participant.json' with { type: 'json' };
import insightsContract from '../../contracts/projections/insights.json' with { type: 'json' };
import realtime from '../../contracts/realtime-events.json' with { type: 'json' };

const FORBIDDEN = {
  public: forbiddenKeysFromContract(publicContract), stage: forbiddenKeysFromContract(stageContract), admin: forbiddenKeysFromContract(adminContract),
  participant: forbiddenKeysFromContract(participantContract), insights: forbiddenKeysFromContract(insightsContract),
};
// keys that identify an individual and must never reach an anonymous audience even if a contract phrase did not start with the key
const INDIVIDUAL_KEYS = ['participantId', 'employeeRef', 'displayName', 'consentPublicName', 'sessionToken', 'floatToken', 'selectedSkillIds', 'cells', 'matchedPositions', 'myMatchedPositions', 'matchedPositionsByParticipant', 'inMatrixCount', 'beyondMatrixCount', 'email'];
// contract 1.2.0 (D-31): a new Soul's config is SoulConfig v3 with exactly the contract keys (plate, eyes and topper included);
// its strings are never a skill id or skill name, and the antenna charm is never one of the body charms
function assertSoulConfig(cfg, where) {
  assert.deepEqual(Object.keys(cfg).sort(), SOUL_CONFIG_KEYS, `${where}: exactly the SoulConfig keys`); assert.equal(cfg.version, 3, where);
  for (const k of ['plate', 'eyes', 'topper']) assert.equal(typeof cfg[k], 'string', `${where}: ${k} passes the projection`);
  assert.ok(!cfg.charms.includes(cfg.topper), `${where}: the topper is not a body charm`);
  assert.deepEqual(skillStringsIn(cfg), [], `${where}: no skill id or skill name`);
}
const set = boardSet(0, 25, ELIGIBLE_IDS, REGEX_TRIPPING_SKILL_IDS);
const third = mixedSet(5, 30, 0).filter(id => !REGEX_TRIPPING_SKILL_IDS.includes(id));

describe('projection redaction across audiences', () => {
  let t, streams, A, B, C, secrets, snaps = {}, insights;
  before(async () => {
    assert.ok(FORBIDDEN.public.includes('participantId') && FORBIDDEN.public.includes('selectedSkillIds') && FORBIDDEN.stage.includes('joinUrl'), 'contract forbidden lists parsed');
    t = await startServer({ rngSeed: 'qa-redaction-1' });
    let round = await createRound(t, { title: 'Redaction', open: false });
    A = await join(t, { employeeRef: 'emp-consented', displayName: 'Consented Winner', consent: true, profile: roleAt(1) });
    B = await join(t, { employeeRef: 'emp-hidden', displayName: 'Hidden Winner', consent: false, profile: roleAt(1) });
    C = await join(t, { employeeRef: 'emp-third', displayName: 'Third Player', consent: true, profile: roleAt(2) });
    streams = {
      public: await openStream(t.baseUrl, `/events/${t.eventId}/stream`),
      stage: await openStream(t.baseUrl, `/stage/events/${t.eventId}/stream`, { token: t.stage }),
      admin: await openStream(t.baseUrl, `/admin/events/${t.eventId}/stream`, { token: t.admin }),
      A: await openStream(t.baseUrl, '/me/stream', { token: A.token }), B: await openStream(t.baseUrl, '/me/stream', { token: B.token }), C: await openStream(t.baseUrl, '/me/stream', { token: C.token }),
    };
    round = (await command(t, round.roundId, 'round.registration.open', round.version)).round;
    await readyBoard(t, A, set); await readyBoard(t, B, set); await readyBoard(t, C, third.length === 25 ? third : mixedSet(5, 30, 0));
    snaps.waiting = await all();
    const l = await command(t, round.roundId, 'round.lock', round.version); const s = await command(t, round.roundId, 'round.start', l.resultingVersion);
    const { round: end } = await drawUntilEnd(t, s.round);
    assert.equal(end.state, 'WINNER');
    snaps.winner = await all();
    const am = await me(t, A), bm = await me(t, B), cm = await me(t, C);
    secrets = { tokens: [A.token, B.token, C.token], floatTokens: [am.soul.floatToken, bm.soul.floatToken, cm.soul.floatToken], refs: ['emp-consented', 'emp-hidden', 'emp-third'] };
    for (const [p, m] of [[A, am], [B, bm]]) assert.equal((await t.api.post('/me/soul/float', { soulId: m.soul.soulId, floatToken: m.soul.floatToken }, p.token, nextKey('f'))).status, 200);
    await streams.public.waitFor(ev => ev.filter(e => e.event === 'soul.float_accepted').length === 2, 3000, 'floats');
    insights = (await t.api.get(`/admin/events/${t.eventId}/insights`, t.admin)).body;
    closeByTimer(t, round.roundId);
    await streams.public.waitFor(ev => ev.some(e => e.event === 'round.closed'), 3000, 'closed');
    const next = await createRound(t, { title: 'Redaction 2' });
    snaps.next = await all();
    await command(t, next.roundId, 'round.cancel', next.version, { reason: 'end' });
    await sleep(100);
    for (const s of Object.values(streams)) { s.close(); await s.done; }
  });
  after(async () => { await t.close(); });
  async function all() {
    return {
      public: (await t.api.get(`/events/${t.eventId}/snapshot`)).body,
      stage: (await t.api.get(`/stage/events/${t.eventId}/snapshot`, t.stage)).body,
      admin: (await t.api.get(`/admin/events/${t.eventId}/snapshot`, t.admin)).body,
      A: (await t.api.get('/me', A.token)).body, B: (await t.api.get('/me', B.token)).body, C: (await t.api.get('/me', C.token)).body,
    };
  }
  const audienceOf = (k) => (['A', 'B', 'C'].includes(k) ? 'participant' : k);

  test('public/stage/admin snapshots in Waiting, Winner and next-round carry no forbidden key and no privacy text; stage never has a join link', () => {
    for (const [phase, s] of Object.entries(snaps)) for (const aud of ['public', 'stage', 'admin']) {
      const body = s[aud];
      assert.deepEqual(findKeys(body, FORBIDDEN[aud]), [], `${aud} ${phase}: contract forbidden keys`);
      if (aud !== 'admin') { assert.deepEqual(findKeys(body, INDIVIDUAL_KEYS), [], `${aud} ${phase}: individual keys`); assert.deepEqual(privacyTextHits(body), [], `${aud} ${phase}: privacy regex`); }
      else { assert.deepEqual(findKeys(body, ['selectedSkillIds', 'cells', 'inMatrixCount', 'beyondMatrixCount', 'floatToken', 'sessionToken', 'email', 'employeeRef']), [], `admin ${phase}`); }
      const text = JSON.stringify(body);
      for (const tok of [...secrets.tokens, ...secrets.floatTokens, ...secrets.refs]) assert.ok(!text.includes(tok), `${aud} ${phase} leaks a secret`);
      if (aud === 'stage') { assert.ok(!('join' in body) && !text.includes('joinUrl'), `stage ${phase} join link`); }
    }
  });

  test('top-level keys of every snapshot are inside the contract allowlist (stage: extra keys may only be public-allowlisted keys)', () => {
    const allow = { public: Object.keys(publicContract.allow), stage: Object.keys(stageContract.allow), admin: Object.keys(adminContract.allow), participant: Object.keys(participantContract.allow) };
    for (const [phase, s] of Object.entries(snaps)) for (const k of Object.keys(s)) {
      const aud = audienceOf(k);
      const extra = Object.keys(s[k]).filter(key => key !== 'correlationId' && !allow[aud].includes(key));
      if (aud === 'stage') assert.ok(extra.every(key => allow.public.includes(key)), `stage ${phase}: extra keys ${extra} are not public-safe`); // DEF-03 (minor): 'galaxy' is not in the stage allowlist
      else assert.deepEqual(extra, [], `${k} ${phase}: keys outside the allowlist`);
    }
    assert.deepEqual(Object.keys(insights).filter(k => k !== 'correlationId' && k !== 'serverTime' && !insightsContract.allow.includes(k)), [], 'insights keys inside allowlist');
  });

  test('participant snapshots: own data only; other participants, their boards and secrets never appear; float token only for the owner until consumed', () => {
    for (const [phase, s] of Object.entries(snaps)) {
      for (const [k, p, others] of [['A', A, [B, C]], ['B', B, [A, C]], ['C', C, [A, B]]]) {
        const body = s[k]; const text = JSON.stringify(body);
        assert.deepEqual(findKeys(body, FORBIDDEN.participant), [], `${k} ${phase}`);
        assert.equal(body.participant.participantId, p.participantId);
        for (const o of others) { assert.ok(!text.includes(o.participantId), `${k} ${phase} sees ${o.displayName}'s id`); if (!o.consent) assert.ok(!text.includes(o.displayName), `${k} ${phase} sees a non-consented name`); }
        for (const tok of [...secrets.tokens, ...secrets.refs]) assert.ok(!text.includes(tok), `${k} ${phase} leaks a session token or employee reference`);
        if (body.board) { assert.equal(body.board.roundId, body.round.roundId); }
      }
    }
    const w = snaps.winner;
    for (const k of ['A', 'B', 'C']) assertSoulConfig(w[k].soul.config, `participant ${k} soul`);
    assert.equal(typeof w.A.soul.floatToken, 'string'); assert.equal(typeof w.B.soul.floatToken, 'string'); assert.notEqual(w.A.soul.floatToken, w.B.soul.floatToken);
    assert.ok(!JSON.stringify(w.A).includes(w.B.soul.floatToken) && !JSON.stringify(w.B).includes(w.A.soul.floatToken));
    assert.equal(snaps.next.A.soul.floatToken, null, 'consumed token disappears'); assert.equal(snaps.next.A.soul.floated, true);
    assert.equal(snaps.next.C.soul.floatToken !== null, true, 'unconsumed token still shown to its owner only');
  });

  test('winner shapes and consent policy per audience: public {label, soulId}; stage + winningDrawNumber; admin participantId + lineIds; galaxy label only with consent', () => {
    const w = snaps.winner;
    assert.equal(w.public.winners.length, 2); assert.equal(w.stage.winners.length, 2); assert.equal(w.admin.currentRound.winners.length, 2);
    for (const x of w.public.winners) assert.deepEqual(Object.keys(x).sort(), ['label', 'soulId']);
    for (const x of w.stage.winners) assert.deepEqual(Object.keys(x).sort(), ['label', 'soulId', 'winningDrawNumber']);
    for (const x of w.admin.currentRound.winners) assert.deepEqual(Object.keys(x).sort(), ['label', 'lineIds', 'participantId', 'winningDrawNumber']);
    assert.deepEqual(w.admin.currentRound.winners.map(x => x.participantId).sort(), [A.participantId, B.participantId].sort());
    const publicLabels = w.public.winners.map(x => x.label);
    assert.ok(publicLabels.includes('Consented Winner')); assert.ok(!publicLabels.includes('Hidden Winner')); assert.ok(publicLabels.some(l => /^Soul #\d{4}$/.test(l)));
    const adminLabels = w.admin.currentRound.winners.map(x => x.label);
    assert.ok(!adminLabels.includes('Hidden Winner'), 'even admins see the pseudonym for a non-consented winner (label policy)');
    assert.equal(w.A.result.isWinner, true); assert.equal(w.B.result.isWinner, true); assert.equal(w.C.result.isWinner, false); assert.equal(w.C.result.coWinnerCount, 2);
    const galaxy = snaps.next.public.galaxy;
    assert.equal(galaxy.count, 2);
    const labels = galaxy.souls.map(s => s.label);
    assert.ok(labels.includes('Consented Winner')); assert.ok(labels.includes(null)); assert.ok(!labels.includes('Hidden Winner'));
    for (const s of galaxy.souls) { assert.deepEqual(Object.keys(s).sort(), ['badge', 'config', 'edge', 'enteredAt', 'label', 'soulId']); assert.deepEqual(findKeys(s.config, ['platformId', 'roleId', 'rank', 'isWinner', 'inMatrixCount', 'participantId']), [], 'Soul config carries no identity or rank trait'); assertSoulConfig(s.config, `galaxy ${s.soulId}`); }
    const owners = new Map([[snaps.winner.A.soul.soulId, snaps.winner.A.soul.config], [snaps.winner.B.soul.soulId, snaps.winner.B.soul.config]]);
    for (const s of galaxy.souls) assert.deepEqual(s.config, owners.get(s.soulId), 'the Galaxy shows the config its owner saw, nothing added');
    assert.equal(snaps.next.public.previousWinners.length, 1); assert.equal(snaps.next.public.previousWinners[0].labels.length, 2);
  });

  test('insights (admin + stage) are aggregate only: no participant ids, names, references or per-participant arrays; cohorts < 5 suppressed', () => {
    assert.deepEqual(findKeys(insights, [...FORBIDDEN.insights, ...INDIVIDUAL_KEYS]), []);
    const text = JSON.stringify(insights);
    for (const s of [A, B, C]) { assert.ok(!text.includes(s.participantId)); assert.ok(!text.includes(s.displayName)); }
    assert.deepEqual(privacyTextHits(insights), []);
    assert.equal(insights.participation.joined, 3); assert.equal(insights.roleEngagement.length, 0, 'cohorts of 2 and 1 are suppressed'); assert.ok(insights.suppressedCohorts >= 2);
    assert.ok(insights.topSkills.every(s => typeof s.count === 'number' && Object.keys(s).every(k => ['skillId', 'name', 'kind', 'count'].includes(k))));
    const stageIns = snaps.winner.stage.insights;
    assert.deepEqual(findKeys(stageIns, [...FORBIDDEN.stage, ...INDIVIDUAL_KEYS]), []);
    assert.deepEqual(Object.keys(stageIns).sort(), ['coreCriticalDensity', 'matrixAlignment', 'platformEngagement', 'roleEngagement', 'skillsBeyondMatrix', 'suppressedCohorts', 'topSkills']);
    assert.ok(!('participation' in stageIns) && !('computedAt' in stageIns), 'stage gets the stage subset only');
  });

  test('every SSE payload of every audience is redacted by contract; event types respect the audience lists; participant streams are isolated', () => {
    for (const [k, s] of Object.entries(streams)) {
      const aud = audienceOf(k);
      assert.ok(s.events.length >= 10, `${k} received the round`);
      for (const e of s.events) {
        const def = realtime.types[e.data.type];
        assert.ok(def, `${k}: ${e.data.type} is a contract type`); assert.ok(def.audiences.includes(aud), `${k}: ${e.data.type} allowed for ${aud}`);
        assert.deepEqual(findKeys(e.data, FORBIDDEN[aud]), [], `${k} ${e.data.type} #${e.id}: forbidden keys`);
        const text = JSON.stringify(e.data);
        for (const tok of [...secrets.tokens, ...secrets.refs]) assert.ok(!text.includes(tok), `${k} ${e.data.type} leaks a secret`);
        if (aud !== 'participant') { assert.deepEqual(findKeys(e.data, INDIVIDUAL_KEYS.filter(x => aud === 'admin' ? !['participantId', 'displayName', 'consentPublicName'].includes(x) : true)), [], `${k} ${e.data.type} #${e.id}: individual keys`); }
        if (aud === 'public' || aud === 'stage') { assert.deepEqual(privacyTextHits(e.data), [], `${k} ${e.data.type} privacy regex`); if (aud === 'stage') assert.ok(!text.includes('joinUrl')); }
        if (aud !== 'participant') for (const ft of secrets.floatTokens) assert.ok(!text.includes(ft), `${k} leaks a float token`);
      }
      if (aud === 'participant') {
        const p = { A, B, C }[k]; const others = [A, B, C].filter(x => x !== p);
        const text = JSON.stringify(s.events);
        // another participant's id never appears; a display name may appear only as a consented public winner label
        for (const o of others) { assert.ok(!text.includes(o.participantId), `${k} stream saw another participant id`); if (!o.consent) assert.ok(!text.includes(o.displayName), `${k} stream saw a non-consented name`); }
        for (const ft of secrets.floatTokens.filter((_, i) => [A, B, C][i] !== p)) assert.ok(!text.includes(ft), `${k} stream saw another float token`);
        const boards = s.events.filter(e => e.data.payload.board).map(e => e.data.payload.board.boardId);
        assert.equal(new Set(boards).size, 1, `${k} only ever sees one board id`);
        const soul = s.events.find(e => e.event === 'soul.created');
        assert.ok(soul && typeof soul.data.payload.soul.floatToken === 'string', `${k} receives its own float token once`);
        assertSoulConfig(soul.data.payload.soul.config, `${k} soul.created`);
        const res = s.events.find(e => e.event === 'result.published').data.payload;
        assert.ok('myResult' in res); assert.deepEqual(Object.keys(res.winners[0]).sort(), ['label', 'soulId']);
      } else {
        const res = s.events.find(e => e.event === 'result.published').data.payload;
        assert.ok(!('myResult' in res));
        const draws = s.events.filter(e => e.event === 'draw.accepted');
        assert.ok(draws.length >= 5 && draws.every(d => !('myMatchedPositions' in d.data.payload) && !('matchedPositionsByParticipant' in d.data.payload)));
        const counts = s.events.filter(e => e.event === 'draw.match_counts_updated');
        if (aud === 'admin') assert.ok(counts.every(c => 'boardsWithFourInLine' in c.data.payload)); else assert.ok(counts.every(c => !('boardsWithFourInLine' in c.data.payload)));
        const floats = s.events.filter(e => e.event === 'soul.float_accepted');
        assert.equal(floats.length, 2); assert.deepEqual(floats.map(f => f.data.payload.entrance.label).sort(), [null, 'Consented Winner'].sort((a, b) => String(a).localeCompare(String(b))));
        for (const f of floats) { assert.deepEqual(Object.keys(f.data.payload.entrance).sort(), ['badge', 'config', 'edge', 'enteredAt', 'label', 'soulId'], `${k} entrance keys`); assertSoulConfig(f.data.payload.entrance.config, `${k} soul.float_accepted`); }
      }
    }
  });
});

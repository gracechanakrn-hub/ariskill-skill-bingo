// Public event screen and stage dashboard projections across a full round (requirement 4.3, 4.4, 5.3, 5.4, 12.1; AC 12;
// P-03, P-04, S-01..S-03, BR-18, D-15). Forbidden-key lists come straight from contracts/projections/*.json; on top of
// that the raw JSON text of every snapshot and SSE payload is scanned with /employee|email|selectedSkillIds|floatToken|sessionToken/i.
// The deterministic RNG seed makes the two identical boards win on the same draw (a consented and a non-consented co-winner).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, me, readyBoard, boardSet, mixedSet, drawUntilEnd, openStream, closeByTimer, sleep, nextKey, ROLES, ELIGIBLE_IDS, OPTIONAL_IDS, REGEX_TRIPPING_SKILL_IDS, PRIVACY_TEXT_REGEX, privacyTextHits, findKeys, forbiddenKeysFromContract, SOUL_CONFIG_KEYS, SOUL_CONFIG_V3_KEYS, skillStringsIn, charmSplit, expectedDecor, expectedSeedPicks } from './helpers.js';
import publicContract from '../../contracts/projections/public.json' with { type: 'json' };
import stageContract from '../../contracts/projections/stage.json' with { type: 'json' };
import realtime from '../../contracts/realtime-events.json' with { type: 'json' };

const FORBIDDEN = { public: forbiddenKeysFromContract(publicContract), stage: forbiddenKeysFromContract(stageContract) };
const ENTRANCE_KEYS = ['badge', 'config', 'edge', 'enteredAt', 'label', 'soulId'];
const safeRoles = ROLES.filter(r => !PRIVACY_TEXT_REGEX.test(`${r.id} ${r.name}`));
const byPlatform = new Map(); for (const r of safeRoles) { if (!byPlatform.has(r.platformId)) byPlatform.set(r.platformId, []); byPlatform.get(r.platformId).push(r); }
const [cohortRole, otherRole] = [...byPlatform.values()].find(rs => rs.length >= 2);
const profileOf = (r) => ({ platformId: r.platformId, roleId: r.id });
const winnerSet = boardSet(0, 25, ELIGIBLE_IDS, REGEX_TRIPPING_SKILL_IDS);
const safeOptional = OPTIONAL_IDS.filter(id => !REGEX_TRIPPING_SKILL_IDS.includes(id));
const fiveEligibleSet = (i) => [...winnerSet.slice(i * 5, i * 5 + 5), ...safeOptional.slice(0, 20)];

function scan(audience, label, payload) {
  assert.deepEqual(findKeys(payload, FORBIDDEN[audience]), [], `${audience} ${label}: forbidden keys`);
  assert.deepEqual(privacyTextHits(payload), [], `${audience} ${label}: privacy regex hit`);
  if (audience === 'stage') assert.ok(!JSON.stringify(payload).includes('joinUrl') && !('join' in payload), `${audience} ${label}: never a join link`);
}

describe('public + stage views across a full round', () => {
  let t, round, streams, publicName, hiddenName, cohort, resultEvent, round2;
  const snapshots = [];
  before(async () => {
    assert.ok(REGEX_TRIPPING_SKILL_IDS.length >= 1, 'the Skill Master contains names that trip the privacy regex (e.g. Employee Experience); they are excluded from boards');
    assert.equal(fiveEligibleSet(0).length, 25);
    t = await startServer({ rngSeed: 'qa-views-1' });
  });
  after(async () => { await t.close(); });

  async function snapshotPair(label) {
    const pub = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    const stage = (await t.api.get(`/stage/events/${t.eventId}/snapshot`, t.stage)).body;
    scan('public', `snapshot ${label}`, pub); scan('stage', `snapshot ${label}`, stage);
    snapshots.push({ label, pub, stage });
    return { pub, stage };
  }

  test('Waiting: public snapshot carries the QR join link and countdown; stage never carries a join link; cohorts < 5 are suppressed in stage insights', async () => {
    round = await createRound(t, { title: 'Views 1', open: false });
    streams = { public: await openStream(t.baseUrl, `/events/${t.eventId}/stream`), stage: await openStream(t.baseUrl, `/stage/events/${t.eventId}/stream`, { token: t.stage }) };
    round = (await command(t, round.roundId, 'round.registration.open', round.version)).round;
    cohort = [];
    for (let i = 0; i < 4; i++) { const p = await join(t, { displayName: `Cohort ${i}`, consent: i % 2 === 0, profile: profileOf(cohortRole) }); await readyBoard(t, p, fiveEligibleSet(i)); cohort.push(p); }
    publicName = await join(t, { displayName: 'Public Name', consent: true, profile: profileOf(otherRole) });
    hiddenName = await join(t, { displayName: 'Hidden Name', consent: false, profile: profileOf(otherRole) });
    const b1 = await readyBoard(t, publicName, winnerSet), b2 = await readyBoard(t, hiddenName, winnerSet);
    assert.deepEqual(b1.cells.map(c => c.skillId), b2.cells.map(c => c.skillId), 'seeded layouts: identical sets -> identical boards -> same-draw co-winners');
    const { pub, stage } = await snapshotPair('waiting');
    assert.equal(pub.publicState, 'Waiting'); assert.equal(pub.round.state, 'REGISTRATION_OPEN'); assert.equal(pub.round.lockAt, round.lockAt);
    assert.ok(pub.join.joinUrl.includes('/play?t=')); assert.ok(Date.parse(pub.join.expiresAt) > t.clock.now());
    assert.deepEqual(Object.keys(pub.counts).sort(), ['active', 'completed', 'joined', 'matchedBoards']); assert.equal(pub.counts.joined, 6); assert.equal(pub.counts.completed, 6);
    assert.equal(pub.currentDraw, null); assert.deepEqual(pub.recentDraws, []); assert.deepEqual(pub.winners, []); assert.equal(pub.galaxy.count, 0);
    assert.ok(Object.keys(pub).every(k => k === 'correlationId' || k in publicContract.allow), `public snapshot keys are inside the allowlist: ${Object.keys(pub)}`);
    assert.equal(stage.publicState, 'Waiting'); assert.equal(stage.round.startOverdue, false); assert.equal(stage.counts.incomplete, 0); assert.equal(stage.counts.deferred, 0);
    assert.deepEqual(stage.resultTiming, { winningDrawNumber: null, publishedAt: null, resultWindowEndsAt: null });
    const ins = stage.insights;
    assert.deepEqual(Object.keys(ins).sort(), ['coreCriticalDensity', 'matrixAlignment', 'platformEngagement', 'roleEngagement', 'skillsBeyondMatrix', 'suppressedCohorts', 'topSkills']);
    assert.ok(!ins.roleEngagement.some(r => r.roleId === cohortRole.id), 'a 4-person role cohort is suppressed');
    assert.ok(!ins.roleEngagement.some(r => r.roleId === otherRole.id), 'a 2-person role cohort is suppressed');
    assert.ok(ins.suppressedCohorts >= 2); assert.equal(ins.coreCriticalDensity.totalSelections, 150); assert.ok(ins.topSkills.length <= 10 && ins.topSkills.every(s => 'count' in s && !('participantId' in s)));
    assert.ok(ins.matrixAlignment.rate >= 0 && ins.matrixAlignment.rate <= 1 && ins.matrixAlignment.matrixVersion);
    // a fifth member of the cohort reveals the aggregate (after the 2 s insights cache)
    const fifth = await join(t, { displayName: 'Cohort 4', consent: true, profile: profileOf(cohortRole) }); await readyBoard(t, fifth, fiveEligibleSet(4)); cohort.push(fifth);
    t.clock.advance(2500);
    const { stage: s2 } = await snapshotPair('waiting-5-cohort');
    const row = s2.insights.roleEngagement.find(r => r.roleId === cohortRole.id);
    assert.ok(row, 'cohort of 5 is shown'); assert.equal(row.joined, 5); assert.equal(row.completed, 5); assert.equal(row.name, cohortRole.name);
    assert.ok(s2.insights.platformEngagement.some(p => p.platformId === cohortRole.platformId && p.joined === 7));
    assert.ok(!s2.insights.roleEngagement.some(r => r.roleId === otherRole.id), 'the 2-person cohort stays suppressed');
  });

  test('Locked -> Playing -> Winner: snapshots stay clean, winner labels follow consent (name vs Soul # pseudonym) in result.published', async () => {
    const l = await command(t, round.roundId, 'round.lock', round.version);
    const { pub: locked, stage: lockedStage } = await snapshotPair('locked');
    assert.equal(locked.publicState, 'Waiting'); assert.equal(locked.join, null, 'no QR once locked'); assert.equal(locked.counts.active, 7); assert.equal(lockedStage.counts.active, 7);
    const s = await command(t, round.roundId, 'round.start', l.resultingVersion);
    let cur = s.round;
    for (let i = 0; i < 2; i++) cur = (await command(t, cur.roundId, 'round.draw.next', cur.version)).round;
    const { pub: playing, stage: playingStage } = await snapshotPair('playing');
    assert.equal(playing.publicState, 'Playing'); assert.equal(playing.currentDraw.number, 2); assert.equal(playing.currentDraw.bingoEvaluationActive, false); assert.ok(['Core', 'Critical'].includes(playing.currentDraw.skill.kind));
    assert.equal(playing.recentDraws.length, 2); assert.deepEqual(Object.keys(playing.recentDraws[0]).sort(), ['kind', 'number', 'skillName']); assert.equal(playing.pacingMessage, 'Bingo unlocks at draw 5');
    assert.equal(playingStage.recentDraws.length, 2); assert.equal(playingStage.publicState, 'Playing');
    const { round: end, results } = await drawUntilEnd(t, cur);
    assert.equal(end.state, 'WINNER'); round = end;
    const winners = results.at(-1).effects.winners; const totalDraws = results.at(-1).effects.draw.number;
    assert.equal(totalDraws, results.length + 2); assert.ok(totalDraws >= 5, 'no Bingo before draw 5');
    assert.ok(winners.length >= 2);
    const winnerIds = winners.map(w => w.participantId);
    assert.ok(winnerIds.includes(publicName.participantId) && winnerIds.includes(hiddenName.participantId), 'both identical boards co-win on the same draw');
    await streams.public.waitFor(ev => ev.some(e => e.event === 'result.published'), 3000, 'public result'); await streams.stage.waitFor(ev => ev.some(e => e.event === 'result.published'), 3000, 'stage result');
    resultEvent = streams.public.events.find(e => e.event === 'result.published').data;
    const labels = resultEvent.payload.winners.map(w => w.label);
    assert.ok(labels.includes('Public Name'), 'consented winner shows the display name'); assert.ok(!labels.includes('Hidden Name'), 'non-consented name never appears');
    assert.ok(labels.some(l => /^Soul #\d{4}$/.test(l)), 'non-consented winner shows a Soul # pseudonym');
    const stageResult = streams.stage.events.find(e => e.event === 'result.published').data;
    assert.deepEqual(stageResult.payload.winners.map(w => w.label).sort(), labels.slice().sort());
    assert.ok(stageResult.payload.winners.every(w => w.winningDrawNumber === totalDraws));
    const { pub: winner, stage: winnerStage } = await snapshotPair('winner');
    assert.equal(winner.publicState, 'Winner'); assert.equal(winner.winners.length, winners.length); assert.ok(winner.winners.some(w => w.label === 'Public Name')); assert.ok(!winner.winners.some(w => w.label === 'Hidden Name'));
    assert.ok(winner.round.resultWindowEndsAt); assert.equal(winner.pacingMessage, 'Bingo!');
    assert.equal(winnerStage.resultTiming.winningDrawNumber, totalDraws); assert.ok(winnerStage.resultTiming.publishedAt);
    assert.equal(winnerStage.recentDraws.length, Math.min(10, totalDraws)); assert.equal(winner.recentDraws.length, Math.min(5, totalDraws));
    assert.equal((await me(t, hiddenName)).result.isWinner, true, 'the non-consented winner still sees their own result privately');
    // contract 1.0.2 (EO-02): participant.publicLabel equals the label the public/stage screens show for that participant
    const pm = await me(t, publicName), hm = await me(t, hiddenName);
    assert.equal(pm.participant.publicLabel, 'Public Name'); assert.ok(labels.includes(pm.participant.publicLabel));
    assert.match(hm.participant.publicLabel, /^Soul #\d{4}$/); assert.ok(labels.includes(hm.participant.publicLabel), 'pseudonymous publicLabel is the label in result.published');
    assert.notEqual(hm.participant.publicLabel, pm.participant.publicLabel);
    const hiddenSoulId = hm.soul.soulId;
    assert.equal(resultEvent.payload.winners.find(w => w.soulId === hiddenSoulId).label, hm.participant.publicLabel, 'publicLabel matches the winner entry by Soul');
  });

  test('Galaxy: floated Souls carry a label only with consent; badges only for winners; every entrance is a public event', async () => {
    const pm = await me(t, publicName), hm = await me(t, hiddenName), cm = await me(t, cohort[0]);
    for (const [p, m] of [[publicName, pm], [hiddenName, hm], [cohort[0], cm]]) {
      const f = await t.api.post('/me/soul/float', { soulId: m.soul.soulId, floatToken: m.soul.floatToken }, p.token, nextKey('float'));
      assert.equal(f.status, 200, JSON.stringify(f.body));
    }
    await streams.public.waitFor(ev => ev.filter(e => e.event === 'soul.float_accepted').length === 3, 3000, 'three entrances');
    const { pub } = await snapshotPair('galaxy');
    assert.equal(pub.galaxy.count, 3);
    const bySoul = new Map(pub.galaxy.souls.map(s => [s.soulId, s]));
    assert.equal(bySoul.get(pm.soul.soulId).label, 'Public Name'); assert.equal(bySoul.get(pm.soul.soulId).badge, 'bingo-star');
    assert.equal(bySoul.get(hm.soul.soulId).label, null); assert.equal(bySoul.get(hm.soul.soulId).badge, 'bingo-star');
    assert.equal(bySoul.get(cm.soul.soulId).label, 'Cohort 0'); assert.equal(bySoul.get(cm.soul.soulId).badge, null);
    for (const s of pub.galaxy.souls) { assert.deepEqual(Object.keys(s).sort(), ENTRANCE_KEYS); assert.ok(['left', 'right', 'top', 'bottom'].includes(s.edge)); }
    // contract 1.2.0 (D-31): the decorated v3 Soul the phone showed, exactly the SoulConfig keys (face plate, eyes and antenna
    // charm included), no skill id, skill name or match count
    assert.deepEqual(SOUL_CONFIG_KEYS, SOUL_CONFIG_V3_KEYS, 'the contract SoulConfig is v3');
    for (const [name, m] of [['public', pm], ['hidden', hm], ['cohort', cm]]) {
      const cfg = bySoul.get(m.soul.soulId).config;
      assert.deepEqual(Object.keys(cfg).sort(), SOUL_CONFIG_V3_KEYS, `${name}: exactly the SoulConfig v3 keys`); assert.equal(cfg.version, 3);
      assert.deepEqual(cfg, m.soul.config, `${name}: the Galaxy shows the config the phone showed`);
      assert.deepEqual(skillStringsIn(cfg), [], `${name}: no skill id or skill name`);
      const want = expectedDecor(m.board);
      assert.deepEqual(charmSplit(cfg.charms), want.split, `${name}: charm split follows the selected skills' kinds`); assert.equal(cfg.face, want.face, `${name}: face follows the matched tiles`);
      assert.deepEqual({ plate: cfg.plate, eyes: cfg.eyes, topper: cfg.topper }, expectedSeedPicks(cfg), `${name}: plate, eyes and topper come from the seed, never from skills`);
      assert.ok(!cfg.charms.includes(cfg.topper), `${name}: the antenna charm is not a body charm`);
    }
  });

  test('Closed -> next round: previousWinners on public after the second round opens; stage still has no join link', async () => {
    const closed = closeByTimer(t, round.roundId);
    assert.equal(closed.state, 'CLOSED');
    await streams.public.waitFor(ev => ev.some(e => e.event === 'round.closed'), 2000, 'round.closed');
    const { pub: closedPub } = await snapshotPair('closed');
    assert.equal(closedPub.publicState, 'Waiting'); assert.equal(closedPub.round.state, 'CLOSED'); assert.ok(closedPub.winners.length >= 2, 'winners stay visible while the round is CLOSED and no next round is open');
    round2 = await createRound(t, { title: 'Views 2' });
    const { pub, stage } = await snapshotPair('round-2');
    assert.equal(pub.round.roundId, round2.roundId); assert.equal(pub.publicState, 'Waiting'); assert.ok(pub.join.joinUrl); assert.deepEqual(pub.winners, []);
    assert.equal(pub.previousWinners.length, 1); assert.equal(pub.previousWinners[0].roundNumber, 1); assert.equal(pub.previousWinners[0].labels.length, resultEvent.payload.winners.length);
    assert.ok(pub.previousWinners[0].labels.includes('Public Name')); assert.ok(!pub.previousWinners[0].labels.includes('Hidden Name'));
    assert.equal(pub.galaxy.count, 3, 'Galaxy persists across rounds');
    assert.equal(stage.round.roundId, round2.roundId); assert.equal(stage.nextRound, null);
    await command(t, round2.roundId, 'round.cancel', round2.version, { reason: 'end of test' });
  });

  test('every public and stage SSE payload across the round is clean and allowed for its audience; all expected event types were observed', async () => {
    await sleep(100);
    for (const s of Object.values(streams)) { s.close(); await s.done; }
    const expectedTypes = ['round.registration_opened', 'participation.updated', 'round.locked', 'round.started', 'draw.accepted', 'draw.match_counts_updated', 'bingo.detected', 'result.published', 'soul.float_accepted', 'round.closed', 'round.created', 'round.cancelled'];
    for (const [aud, s] of Object.entries(streams)) {
      assert.ok(s.events.length >= 20, `${aud} stream saw the round`);
      const seen = new Set(s.events.map(e => e.event));
      for (const ty of expectedTypes) assert.ok(seen.has(ty), `${aud} saw ${ty}`);
      for (const e of s.events) {
        scan(aud, `event ${e.event} #${e.id}`, e.data);
        assert.ok(realtime.types[e.data.type], `${e.data.type} is a contract event type`);
        assert.ok(realtime.types[e.data.type].audiences.includes(aud), `${e.data.type} allowed for ${aud}`);
        assert.deepEqual(Object.keys(e.data).sort(), ['eventId', 'occurredAt', 'payload', 'roundId', 'roundVersion', 'sequence', 'type'], 'envelope shape');
        assert.equal(e.id, e.data.sequence);
      }
      const ids = s.events.map(e => e.id);
      assert.ok(ids.every((v, i) => i === 0 || v > ids[i - 1]), `${aud} monotonic sequence`);
      for (const ty of ['board.saved', 'board.ready', 'board.locked_active', 'board.deferred', 'soul.created']) assert.ok(!seen.has(ty), `${aud} never receives participant-only ${ty}`);
      const draws = s.events.filter(e => e.event === 'draw.accepted');
      assert.ok(draws.every(d => !('myMatchedPositions' in d.data.payload) && !('matchedPositionsByParticipant' in d.data.payload)));
      const counts = s.events.filter(e => e.event === 'draw.match_counts_updated');
      assert.ok(counts.every(c => !('boardsWithFourInLine' in c.data.payload)), `${aud} never sees boardsWithFourInLine`);
      const res = s.events.find(e => e.event === 'result.published').data.payload;
      assert.deepEqual(Object.keys(res.winners[0]).sort(), aud === 'public' ? ['label', 'soulId'] : ['label', 'soulId', 'winningDrawNumber']);
      const galaxy = snapshots.find(x => x.label === 'galaxy').pub.galaxy.souls;
      const floats = s.events.filter(e => e.event === 'soul.float_accepted');
      assert.equal(floats.length, 3, `${aud} saw the three entrances`);
      for (const f of floats) {
        const entrance = f.data.payload.entrance;
        assert.deepEqual(Object.keys(f.data.payload), ['entrance']); assert.deepEqual(Object.keys(entrance).sort(), ENTRANCE_KEYS, `${aud} entrance keys`);
        assert.deepEqual(Object.keys(entrance.config).sort(), SOUL_CONFIG_V3_KEYS, `${aud} entrance config keys (v3)`); assert.deepEqual(skillStringsIn(entrance.config), []);
        assert.deepEqual(entrance.config, galaxy.find(g => g.soulId === entrance.soulId).config, `${aud}: the entrance config is the Galaxy config`);
      }
    }
    for (const { label, pub, stage } of snapshots) { scan('public', `snapshot ${label} (re-scan)`, pub); scan('stage', `snapshot ${label} (re-scan)`, stage); }
  });

  test('DEF-01 (major): non-consented winner labels in public/stage/admin snapshots and previousWinners must equal the Soul # pseudonym published in result.published', async () => {
    // Observed: snapshots render every non-consented winner as the same pseudonym derived from an undefined id (queries.js winnersOf() rows
    // carry participant_id, not id, so winnerLabel() hashes "soul:undefined"). Events and command effects use the correct per-participant pseudonym.
    const eventLabels = resultEvent.payload.winners.map(w => w.label).sort();
    const closedPub = snapshots.find(s => s.label === 'closed').pub;
    assert.deepEqual(closedPub.winners.map(w => w.label).sort(), eventLabels, 'public snapshot winners = result.published winners');
    const closedStage = snapshots.find(s => s.label === 'closed').stage;
    assert.deepEqual(closedStage.winners.map(w => w.label).sort(), eventLabels, 'stage snapshot winners = result.published winners');
    const pub2 = snapshots.find(s => s.label === 'round-2').pub;
    assert.deepEqual(pub2.previousWinners[0].labels.slice().sort(), eventLabels, 'previousWinners = result.published winners');
  });

  test('DEF-02 (major): cancelling a DRAFT next round while the current round is PLAYING must not replace the public/stage display round', async () => {
    const s = await startServer({ rngSeed: 'qa-views-2' });
    try {
      const r1 = await createRound(s, { title: 'Live' });
      const p = await join(s); await readyBoard(s, p, winnerSet);
      const l = await command(s, r1.roundId, 'round.lock', r1.version); const st = await command(s, r1.roundId, 'round.start', l.resultingVersion);
      await command(s, r1.roundId, 'round.draw.next', st.resultingVersion);
      const draft = await createRound(s, { title: 'Mistake', open: false });
      let pub = (await s.api.get(`/events/${s.eventId}/snapshot`)).body;
      assert.equal(pub.round.roundId, r1.roundId); assert.equal(pub.nextRound.roundId, draft.roundId);
      await command(s, draft.roundId, 'round.cancel', draft.version, { reason: 'created by mistake' });
      pub = (await s.api.get(`/events/${s.eventId}/snapshot`)).body;
      const stage = (await s.api.get(`/stage/events/${s.eventId}/snapshot`, s.stage)).body;
      assert.equal(pub.round.roundId, r1.roundId, 'public still shows the PLAYING round'); assert.equal(pub.publicState, 'Playing'); assert.equal(pub.notice, null);
      assert.equal(stage.round.roundId, r1.roundId, 'stage still shows the PLAYING round');
    } finally { await s.close(); }
  });
});

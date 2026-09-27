import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, drawUntilEnd, lineScenario, readSse, nextKey, EVENT_ID } from './helpers.js';
import { validateSoulConfig } from '../../../packages/game-rules/src/index.js';
import { findForbiddenKeys } from '../src/projections.js';

describe('Soul + Float (M-13, P-05, BR-16, BR-17, D-11)', () => {
  let t, p, me, others;
  before(async () => {
    t = await startServer({ drawGuidance: false });
    const sc = await lineScenario(t, { extraPlayers: [{ join: { displayName: 'Quiet', consent: false } }] });
    p = sc.p; others = sc.others;
    await drawUntilEnd(t, sc.round);
    me = (await t.api.get('/me', p.token)).body;
  });
  after(async () => { await t.close(); });

  test('every finished participant has a Soul; config validates (no rank traits); badge only for winners; token only in participant projection', async () => {
    assert.ok(me.soul.soulId.startsWith('soul_')); assert.equal(validateSoulConfig(me.soul.config).ok, true); assert.equal(me.soul.badge, 'bingo-star'); assert.equal(me.soul.floated, false);
    assert.equal(typeof me.soul.floatToken, 'string'); assert.ok(me.soul.floatToken.length >= 40);
    const other = (await t.api.get('/me', others[0].p.token)).body;
    assert.ok(other.soul); assert.equal(other.soul.badge, null); assert.ok(other.soul.floatToken); assert.notEqual(other.soul.floatToken, me.soul.floatToken);
    for (const k of ['platformId', 'roleId', 'size', 'rank', 'isWinner', 'inMatrixCount']) assert.ok(!(k in me.soul.config));
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM float_tokens WHERE token_hash = ?', me.soul.floatToken).c, 0, 'plaintext token is never stored as the lookup key');
    for (const [aud, path, tok] of [['public', `/events/${EVENT_ID}/snapshot`, null], ['stage', `/stage/events/${EVENT_ID}/snapshot`, t.stage], ['admin', `/admin/events/${EVENT_ID}/snapshot`, t.admin]]) {
      const body = (await t.api.get(path, tok)).body;
      assert.deepEqual(findForbiddenKeys(aud, body), [], aud); assert.ok(!JSON.stringify(body).includes(me.soul.floatToken));
    }
  });

  test('float once creates exactly one entrance + one soul.float_accepted event; replay returns the original; other token is FLOAT_FAILED', async () => {
    const wrong = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: 'not-a-token' }, p.token);
    assert.equal(wrong.status, 409); assert.equal(wrong.body.error.code, 'FLOAT_FAILED'); assert.equal(wrong.body.error.exceptionId, 'E13');
    const seqBefore = t.db.get('SELECT COALESCE(MAX(sequence),0) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    const streamP = readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { timeoutMs: 800 });
    await new Promise(r => setTimeout(r, 50));
    const f1 = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken }, p.token);
    assert.equal(f1.status, 200); assert.equal(f1.body.accepted, true); assert.equal(f1.body.replay, false);
    const e = f1.body.entrance;
    assert.equal(e.soulId, me.soul.soulId); assert.equal(e.badge, 'bingo-star'); assert.equal(e.label, 'Line Player'); assert.ok(['left', 'right', 'top', 'bottom'].includes(e.edge)); assert.ok(e.enteredAt);
    const f2 = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken }, p.token, nextKey('other-key'));
    assert.equal(f2.status, 200); assert.equal(f2.body.replay, true); assert.deepEqual(f2.body.entrance, e);
    const f3 = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken }, p.token, nextKey('third-key'));
    assert.equal(f3.body.replay, true);
    const rows = t.db.all("SELECT * FROM events_outbox WHERE event_id = ? AND sequence > ? AND type = 'soul.float_accepted'", EVENT_ID, seqBefore);
    assert.equal(rows.length, 1, 'exactly one entrance event ever');
    const { events } = await streamP;
    const floats = events.filter(x => x.event === 'soul.float_accepted');
    assert.equal(floats.length, 1); assert.equal(floats[0].data.payload.entrance.soulId, me.soul.soulId); assert.deepEqual(findForbiddenKeys('public', floats[0].data), []);
    const after = (await t.api.get('/me', p.token)).body;
    assert.equal(after.soul.floated, true); assert.equal(after.soul.floatToken, null, 'token hidden once consumed');
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.galaxy.count, 1); assert.equal(pub.galaxy.souls[0].soulId, me.soul.soulId);
  });

  test('expired float token is FLOAT_FAILED and never creates an entrance; a non-consented Soul enters without a label', async () => {
    const o = others[0].p;
    const om = (await t.api.get('/me', o.token)).body;
    t.db.run('UPDATE float_tokens SET expires_at = ? WHERE soul_id = ?', new Date(t.clock.now() - 1000).toISOString(), om.soul.soulId);
    const exp = await t.api.post('/me/soul/float', { soulId: om.soul.soulId, floatToken: om.soul.floatToken }, o.token);
    assert.equal(exp.status, 409); assert.equal(exp.body.error.code, 'FLOAT_FAILED'); assert.equal(exp.body.error.details.reason, 'expired');
    assert.equal((await t.api.get('/me', o.token)).body.soul.floatToken, null, 'expired token not re-shown');
    t.db.run('UPDATE float_tokens SET expires_at = ? WHERE soul_id = ?', new Date(t.clock.now() + 3600000).toISOString(), om.soul.soulId);
    const ok = await t.api.post('/me/soul/float', { soulId: om.soul.soulId, floatToken: om.soul.floatToken }, o.token);
    assert.equal(ok.status, 200); assert.equal(ok.body.entrance.label, null); assert.equal(ok.body.entrance.badge, null);
    const foreign = await t.api.post('/me/soul/float', { soulId: om.soul.soulId, floatToken: om.soul.floatToken }, p.token);
    assert.equal(foreign.status, 409, 'another participant cannot float this Soul');
    assert.equal((await t.api.get(`/events/${EVENT_ID}/snapshot`)).body.galaxy.count, 2);
  });
});

describe('Float greeting (D-42)', () => {
  async function finishedRound(overrides = {}) {
    const t = await startServer({ drawGuidance: false, ...overrides });
    const sc = await lineScenario(t, { extraPlayers: [{ join: { displayName: 'Quiet', consent: false } }] });
    await drawUntilEnd(t, sc.round);
    const me = (await t.api.get('/me', sc.p.token)).body;
    const other = (await t.api.get('/me', sc.others[0].p.token)).body;
    return { t, sc, me, other };
  }

  test('a rejected greeting is E24 with a reason and does not spend the token; a clean one reaches the public screen; none is null', async () => {
    const { t, sc, me, other } = await finishedRound();
    try {
      const bad = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken, greeting: 'visit www.spam.example' }, sc.p.token);
      assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'GREETING_REJECTED'); assert.equal(bad.body.error.exceptionId, 'E24'); assert.equal(bad.body.error.details.reason, 'link');
      const long = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken, greeting: 'x'.repeat(41) }, sc.p.token);
      assert.equal(long.body.error.details.reason, 'too-long');
      assert.equal((await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken, greeting: 42 }, sc.p.token)).status, 400);
      const ok = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken, greeting: '  Good luck,\n everyone!  ' }, sc.p.token);
      assert.equal(ok.status, 200, 'the token survived the rejected tries'); assert.equal(ok.body.entrance.greeting, 'Good luck, everyone!');
      const none = await t.api.post('/me/soul/float', { soulId: other.soul.soulId, floatToken: other.soul.floatToken }, sc.others[0].p.token);
      assert.equal(none.body.entrance.greeting, null);
      const souls = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body.galaxy.souls;
      const byId = new Map(souls.map(s => [s.soulId, s]));
      assert.equal(byId.get(me.soul.soulId).greeting, 'Good luck, everyone!');
      assert.equal(byId.get(other.soul.soulId).greeting, null, 'no greeting: the big screen shows "..."');
      assert.equal(byId.get(other.soul.soulId).label, null, 'the greeting never exposes a non-consented name');
    } finally { await t.close(); }
  });

  test('BINGO_GREETINGS=off hides greetings from public payloads; the owner still gets their own back', async () => {
    const { t, sc, me } = await finishedRound({ greetings: false });
    try {
      const streamP = readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { timeoutMs: 700 });
      await new Promise(r => setTimeout(r, 50));
      const ok = await t.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken, greeting: 'Hello team' }, sc.p.token);
      assert.equal(ok.body.entrance.greeting, 'Hello team');
      const { events } = await streamP;
      const accepted = events.find(e => e.event === 'soul.float_accepted');
      assert.ok(accepted); assert.equal(accepted.data.payload.entrance.greeting, null);
      const soul = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body.galaxy.souls.find(s => s.soulId === me.soul.soulId);
      assert.equal(soul.greeting, null);
    } finally { await t.close(); }
  });
});

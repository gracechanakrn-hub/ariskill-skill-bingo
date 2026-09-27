import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, join, saveBoard, readyBoard, boardSet, defaultRole, ELIGIBLE_IDS } from './helpers.js';
import { ROLES, ROLE_SKILL_LEVELS, SKILLS, MATRIX_FREQUENCY, MATRIX_VERSION } from '../src/skills.js';

describe('skill discovery and profile (M-02, M-03, BR-01, BR-03)', () => {
  let t;
  before(async () => { t = await startServer(); await createRound(t); });
  after(async () => { await t.close(); });

  test('taxonomy lists platforms, roles with platformId and the matrix version; profile must be explicit and consistent', async () => {
    const p = await join(t, { profile: null });
    const tax = (await t.api.get('/taxonomy', p.token)).body;
    assert.equal(tax.platforms.length, 13); assert.equal(tax.roles.length, 46); assert.equal(tax.matrixVersion, MATRIX_VERSION);
    assert.ok(tax.roles.every(r => r.id && r.name && r.platformId));
    const bad = await t.api.post('/me/profile', { platformId: tax.platforms[0].id }, p.token);
    assert.equal(bad.status, 400);
    const mismatch = await t.api.post('/me/profile', { platformId: tax.platforms[0].id, roleId: tax.roles.find(r => r.platformId !== tax.platforms[0].id).id }, p.token);
    assert.equal(mismatch.status, 400); assert.equal(mismatch.body.error.code, 'VALIDATION');
    assert.equal((await t.api.get('/me', p.token)).body.participant.platformId, null, 'nothing derived or partially saved');
    const role = tax.roles[3];
    const ok = await t.api.post('/me/profile', { platformId: role.platformId, roleId: role.id }, p.token);
    assert.equal(ok.status, 200); assert.equal(ok.body.participant.roleId, role.id); assert.equal(ok.body.participant.platformId, role.platformId);
  });

  test('recommended: role core, then critical, then optional skills, each with roleLevel and eligibility flags', async () => {
    const role = ROLES[5];
    const p = await join(t, { profile: { platformId: role.platformId, roleId: role.id } });
    const r = (await t.api.get('/skills/discovery?mode=recommended&limit=500', p.token)).body;
    assert.equal(r.mode, 'recommended'); assert.equal(r.selectedCount, 0);
    const levels = ROLE_SKILL_LEVELS.get(role.id);
    assert.equal(r.skills.length, levels.size);
    const order = { core: 0, critical: 1, optional: 2 };
    const seq = r.skills.map(s => order[s.roleLevel]);
    assert.ok(seq.every((v, i) => i === 0 || v >= seq[i - 1]), 'grouped core -> critical -> optional');
    for (const s of r.skills) {
      assert.equal(s.roleLevel, levels.get(s.id));
      const m = SKILLS.get(s.id);
      assert.equal(s.eligible, m.status === 'active', 'any active skill is draw-eligible (D-33)'); assert.equal(s.isCore, !!m.isCore); assert.equal(s.name, m.name); assert.ok('domain' in s && 'cluster' in s && 'kind' in s);
    }
    assert.deepEqual(Object.keys(r.skills[0]).sort(), ['cluster', 'domain', 'eligible', 'id', 'isCore', 'isCritical', 'kind', 'name', 'roleLevel']);
  });

  test('picker lists (D-35): core is the 7 Core Skill kind; role is the role list without them; unknown mode is 400', async () => {
    const role = ROLES[5];
    const p = await join(t, { profile: { platformId: role.platformId, roleId: role.id } });
    const core = (await t.api.get('/skills/discovery?mode=core&limit=500', p.token)).body;
    const expected = [...SKILLS.values()].filter(s => s.status === 'active' && s.kind === 'Core Skill').map(s => s.name).sort((a, b) => a.localeCompare(b));
    assert.equal(core.mode, 'core'); assert.equal(expected.length, 7);
    assert.deepEqual(core.skills.map(s => s.name), expected);
    const rec = (await t.api.get('/skills/discovery?mode=recommended&limit=500', p.token)).body.skills;
    const roleList = (await t.api.get('/skills/discovery?mode=role&limit=500', p.token)).body;
    assert.equal(roleList.mode, 'role');
    assert.ok(roleList.skills.every(s => s.kind !== 'Core Skill'), 'no core skill repeats in question 2');
    assert.deepEqual(roleList.skills.map(s => s.id), rec.filter(s => s.kind !== 'Core Skill').map(s => s.id), 'same order as recommended');
    assert.equal((await t.api.get('/skills/discovery?mode=nope', p.token)).status, 400);
  });

  test('popular: falls back to matrix frequency when nothing is selected, then reflects selections across the event; selectedCount tracks the board', async () => {
    const p = await join(t);
    const before = (await t.api.get('/skills/discovery?mode=popular&limit=5', p.token)).body;
    assert.equal(before.skills.length, 5);
    const top = [...MATRIX_FREQUENCY.entries()].sort((a, b) => b[1] - a[1] || SKILLS.get(a[0]).name.localeCompare(SKILLS.get(b[0]).name))[0][0];
    assert.equal(before.skills[0].id, top);
    const rare = ELIGIBLE_IDS[140];
    await saveBoard(t, p, [rare, ELIGIBLE_IDS[141]]);
    const q = await join(t); await saveBoard(t, q, [rare]);
    const after = (await t.api.get('/skills/discovery?mode=popular&limit=3', p.token)).body;
    assert.equal(after.skills[0].id, rare); assert.equal(after.selectedCount, 2);
    assert.equal(after.skills.length, 2, 'only selected skills once selections exist');
  });

  test('search: case-insensitive substring across name, domain and cluster; unknown mode is VALIDATION; default limit', async () => {
    const p = await join(t);
    const byName = (await t.api.get('/skills/discovery?mode=search&q=ADAPT', p.token)).body;
    assert.ok(byName.skills.some(s => s.id === 'skill_adaptability'));
    const byDomain = (await t.api.get('/skills/discovery?mode=search&q=it security&limit=100', p.token)).body;
    assert.ok(byDomain.skills.length > 0 && byDomain.skills.every(s => [s.name, s.domain, s.cluster].some(v => String(v).toLowerCase().includes('it security'))));
    const all = (await t.api.get('/skills/discovery?mode=search', p.token)).body;
    assert.equal(all.skills.length, 50);
    const none = (await t.api.get('/skills/discovery?mode=search&q=zzzzqqq', p.token)).body;
    assert.deepEqual(none.skills, []);
    const bad = await t.api.get('/skills/discovery?mode=magic', p.token);
    assert.equal(bad.status, 400);
  });

  test('no auto-fill: a READY board only ever contains explicitly posted skills', async () => {
    const p = await join(t, { profile: defaultRole(2) });
    const b = await readyBoard(t, p, boardSet(50));
    assert.deepEqual(b.selectedSkillIds, boardSet(50));
  });
});

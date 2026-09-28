import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, join, saveBoard, readyBoard, boardSet, defaultRole, MATRIX_ROLES, ELIGIBLE_IDS } from './helpers.js';
import { ROLES, PLATFORMS, SKILL_MASTER, ROLE_SKILL_LEVELS, SKILLS, MATRIX_FREQUENCY, MATRIX_VERSION } from '../src/skills.js';

describe('skill discovery and profile (M-02, M-03, BR-01, BR-03)', () => {
  let t;
  before(async () => { t = await startServer(); await createRound(t); });
  after(async () => { await t.close(); });

  test('taxonomy (D-55): the owner\'s 47 platforms and 76 roles (independent lists, roles flag inMatrix) and the matrix version; profile must be explicit', async () => {
    const p = await join(t, { profile: null });
    const tax = (await t.api.get('/taxonomy', p.token)).body;
    assert.deepEqual(Object.keys(tax).filter(k => !['correlationId', 'serverTime'].includes(k)).sort(), ['matrixVersion', 'platforms', 'roles']);
    assert.equal(tax.platforms.length, 47); assert.equal(tax.roles.length, 76); assert.equal(tax.matrixVersion, MATRIX_VERSION);
    assert.deepEqual(tax.platforms, PLATFORMS);
    assert.ok(tax.platforms.every(pl => pl.id && pl.name && Object.keys(pl).sort().join() === 'id,name'));
    assert.ok(tax.roles.every(r => r.id && r.name && typeof r.inMatrix === 'boolean' && !('platformId' in r)), 'roles carry no platform (D-55)');
    assert.equal(tax.roles.filter(r => r.inMatrix).length, 45);
    assert.ok(tax.roles.every(r => r.inMatrix === ROLE_SKILL_LEVELS.has(r.id)), 'inMatrix exactly when the Skill Matrix maps the role id');
    const bad = await t.api.post('/me/profile', { platformId: tax.platforms[0].id }, p.token);
    assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'VALIDATION');
    const badRole = await t.api.post('/me/profile', { platformId: tax.platforms[0].id, roleId: 'role_nope' }, p.token);
    assert.equal(badRole.status, 400); assert.equal(badRole.body.error.code, 'VALIDATION');
    const oldPlatform = await t.api.post('/me/profile', { platformId: 'platform_data-engineering', roleId: tax.roles[0].id }, p.token);
    assert.equal(oldPlatform.status, 400, 'pre-D-55 platform ids no longer exist'); assert.equal(oldPlatform.body.error.code, 'VALIDATION');
    assert.equal((await t.api.get('/me', p.token)).body.participant.platformId, null, 'nothing derived or partially saved');
    const role = tax.roles[3];
    const ok = await t.api.post('/me/profile', { platformId: tax.platforms[6].id, roleId: role.id }, p.token);
    assert.equal(ok.status, 200); assert.equal(ok.body.participant.roleId, role.id); assert.equal(ok.body.participant.platformId, tax.platforms[6].id);
  });

  test('profile (D-55): any valid platform is accepted with any valid role, matrix or not', async () => {
    const p = await join(t, { profile: null });
    const nonMatrix = ROLES.filter(r => !r.inMatrix);
    const pairs = [
      [PLATFORMS[0], ROLES[0]], [PLATFORMS.at(-1), ROLES.at(-1)], [PLATFORMS[10], nonMatrix[0]], [PLATFORMS[20], nonMatrix.at(-1)],
      ...PLATFORMS.map((pl, i) => [pl, ROLES[(i * 7) % ROLES.length]]),
      ...ROLES.map((r, i) => [PLATFORMS[(i * 5 + 3) % PLATFORMS.length], r]),
    ];
    for (const [pl, r] of pairs) {
      const res = await t.api.post('/me/profile', { platformId: pl.id, roleId: r.id }, p.token);
      assert.equal(res.status, 200, `${pl.id} + ${r.id}`);
      assert.equal(res.body.participant.platformId, pl.id); assert.equal(res.body.participant.roleId, r.id);
    }
  });

  test('tech / soft (picker questions 2 and 3, D-54): the role\'s Hard / Soft Skills from the Skill Matrix in level order; soft tops up to at least 8', async () => {
    for (const [i, role] of MATRIX_ROLES.entries()) {
      const p = await join(t, { profile: { platformId: PLATFORMS[i % PLATFORMS.length].id, roleId: role.id } });
      const levels = ROLE_SKILL_LEVELS.get(role.id);
      const order = { core: 0, critical: 1, optional: 2 };
      const tech = (await t.api.get('/skills/discovery?mode=tech&limit=500', p.token)).body;
      assert.equal(tech.mode, 'tech');
      const mappedHard = [...levels.keys()].filter(id => SKILLS.get(id)?.kind === 'Hard Skill' && SKILLS.get(id)?.status === 'active');
      assert.deepEqual(tech.skills.map(s => s.id).sort(), mappedHard.sort(), `${role.id}: every mapped technical skill, nothing else`);
      assert.ok(tech.skills.every(s => s.roleLevel === 'critical' || s.roleLevel === 'optional'), 'technical skills are critical or optional in the matrix');
      const seq = tech.skills.map(s => order[s.roleLevel]);
      assert.ok(seq.every((v, i) => i === 0 || v >= seq[i - 1]), 'critical before optional');
      const soft = (await t.api.get('/skills/discovery?mode=soft&limit=500', p.token)).body.skills;
      assert.ok(soft.every(s => s.kind === 'Soft Skill'), 'soft skills only');
      assert.equal(new Set(soft.map(s => s.id)).size, soft.length, 'no duplicates');
      const mappedSoft = [...levels.keys()].filter(id => SKILLS.get(id)?.kind === 'Soft Skill' && SKILLS.get(id)?.status === 'active');
      assert.deepEqual(soft.slice(0, mappedSoft.length).map(s => s.id).sort(), mappedSoft.sort(), `${role.id}: the role's own soft skills come first`);
      assert.ok(soft.length >= Math.min(8, [...SKILLS.values()].filter(x => x.kind === 'Soft Skill' && x.status === 'active').length), 'at least 8 choices');
    }
  });

  test('tech fallback (D-55): a role without Skill Matrix data gets the 30 most matrix-frequent active Hard Skills, alphabetical', async () => {
    const hard = [...SKILLS.values()].filter(s => s.status === 'active' && s.kind === 'Hard Skill');
    // Independent reference: frequency = number of matrix roles mapping the skill (roleSkillMap rows), ties by name.
    const freq = new Map();
    for (const m of SKILL_MASTER.roleSkillMap) freq.set(m.skillId, (freq.get(m.skillId) ?? 0) + 1);
    const top = hard.sort((a, b) => (freq.get(b.id) ?? 0) - (freq.get(a.id) ?? 0) || a.name.localeCompare(b.name)).slice(0, 30);
    const expected = top.map(s => s.name).sort((a, b) => a.localeCompare(b));
    const nonMatrix = ROLES.filter(r => !r.inMatrix);
    assert.equal(nonMatrix.length, 31);
    for (const role of [nonMatrix[0], nonMatrix[15], nonMatrix.at(-1)]) {
      const p = await join(t, { profile: { platformId: PLATFORMS[2].id, roleId: role.id } });
      const tech = (await t.api.get('/skills/discovery?mode=tech&limit=500', p.token)).body;
      assert.equal(tech.mode, 'tech');
      assert.equal(tech.skills.length, 30, `${role.id}: 30 fallback choices`);
      assert.ok(tech.skills.every(s => s.kind === 'Hard Skill' && s.eligible && s.roleLevel === null), 'active Hard Skills with no role level');
      assert.deepEqual(tech.skills.map(s => s.name), expected, 'the most matrix-frequent ones, alphabetical');
      const minTop = Math.min(...top.map(s => freq.get(s.id) ?? 0));
      assert.ok(hard.slice(30).every(s => (freq.get(s.id) ?? 0) <= minTop), 'no left-out Hard Skill is more frequent than a chosen one');
    }
  });

  test('soft for a role without Skill Matrix data (D-55): every active Soft Skill, alphabetical; recommended / role are empty', async () => {
    const role = ROLES.find(r => !r.inMatrix);
    const p = await join(t, { profile: { platformId: PLATFORMS[9].id, roleId: role.id } });
    const soft = (await t.api.get('/skills/discovery?mode=soft&limit=500', p.token)).body;
    const expected = [...SKILLS.values()].filter(s => s.status === 'active' && s.kind === 'Soft Skill').map(s => s.name).sort((a, b) => a.localeCompare(b));
    assert.ok(expected.length >= 8);
    assert.equal(soft.mode, 'soft');
    assert.deepEqual(soft.skills.map(s => s.name), expected);
    assert.ok(soft.skills.every(s => s.roleLevel === null));
    for (const mode of ['recommended', 'role']) {
      const r = (await t.api.get(`/skills/discovery?mode=${mode}&limit=500`, p.token)).body;
      assert.equal(r.mode, mode); assert.deepEqual(r.skills, [], `${mode} is empty without matrix data`);
    }
    const core = (await t.api.get('/skills/discovery?mode=core&limit=500', p.token)).body.skills;
    assert.equal(core.length, 7, 'core does not depend on the role');
  });

  test('recommended: role core, then critical, then optional skills, each with roleLevel and eligibility flags', async () => {
    const role = MATRIX_ROLES[5];
    const p = await join(t, { profile: defaultRole(5) });
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
    const role = MATRIX_ROLES[5];
    const p = await join(t, { profile: defaultRole(5) });
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

// D-55: platform and role choices come from the owner's lists (packages/skill-master/data/taxonomy/*.csv), built into
// packages/skill-master/data/taxonomy.json by tools/data/build_taxonomy.mjs. These tests read the CSVs independently of the
// build script and check the committed JSON against them; the determinism test runs the script in a temporary copy of
// the repo layout so the committed file is never rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import taxonomy from '../../packages/skill-master/data/taxonomy.json' with { type: 'json' };
import skillMaster from '../../packages/skill-master/data/skill-master.json' with { type: 'json' };
import { ROLES, PLATFORMS, ROLE_SKILL_LEVELS } from '../../services/game-service/src/skills.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA = join(ROOT, 'packages/skill-master/data');
const PLATFORM_CSV = 'platform-28-09-26.csv', ROLE_CSV = 'role-28-09-26.csv';
const readNames = (file) => readFileSync(join(DATA, 'taxonomy', file), 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const csvPlatforms = readNames(PLATFORM_CSV), csvRoles = readNames(ROLE_CSV);
const matrixRoleById = new Map(skillMaster.roles.map(r => [r.id, r]));

test('taxonomy.json lists the owner\'s 47 platforms and 76 roles in CSV file order, from the 28-09-26 lists', () => {
  assert.equal(csvPlatforms.length, 47); assert.equal(csvRoles.length, 76);
  assert.equal(taxonomy.version, '28-09-26');
  assert.deepEqual(taxonomy.source, { platforms: PLATFORM_CSV, roles: ROLE_CSV });
  assert.deepEqual(taxonomy.counts, { platforms: 47, roles: 76, rolesInMatrix: 45 });
  assert.deepEqual(taxonomy.platforms.map(p => p.name), csvPlatforms);
  assert.deepEqual(taxonomy.roles.map(r => r.name), csvRoles);
  assert.ok(taxonomy.platforms.every(p => Object.keys(p).sort().join() === 'id,name'));
  assert.ok(taxonomy.roles.every(r => Object.keys(r).sort().join() === 'id,matrixRoleId,name'), 'roles carry no platformId (D-55)');
});

test('taxonomy ids are unique, prefixed and slug-shaped; pre-D-55 platform ids are gone', () => {
  const pIds = taxonomy.platforms.map(p => p.id), rIds = taxonomy.roles.map(r => r.id);
  assert.equal(new Set(pIds).size, pIds.length); assert.equal(new Set(rIds).size, rIds.length);
  assert.ok(pIds.every(id => /^platform_[a-z0-9]+(-[a-z0-9]+)*$/.test(id)), 'platform ids');
  assert.ok(rIds.every(id => /^role_[a-z0-9]+(-[a-z0-9]+)*$/.test(id)), 'role ids');
  assert.ok(pIds.includes('platform_data') && pIds.includes('platform_ux-ui'));
  assert.ok(!pIds.includes('platform_data-engineering'));
});

test('45 roles are Skill Matrix roles: they keep the matrix role id (name match, plus the L&D alias); the other 31 have none', () => {
  const inMatrix = taxonomy.roles.filter(r => r.matrixRoleId);
  assert.equal(inMatrix.length, 45);
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const r of inMatrix) {
    assert.equal(r.id, r.matrixRoleId, `${r.name} keeps the matrix id`);
    const m = matrixRoleById.get(r.matrixRoleId);
    assert.ok(m, `${r.matrixRoleId} exists in skill-master.json`);
    if (r.name !== 'Learning & Development Architect') assert.equal(norm(m.name), norm(r.name), `${r.name} matches the matrix name`);
    assert.ok(ROLE_SKILL_LEVELS.has(r.id), `${r.id} has Skill Matrix skills`);
  }
  const ld = taxonomy.roles.find(r => r.name === 'Learning & Development Architect');
  assert.ok(ld); assert.equal(ld.matrixRoleId, skillMaster.roles.find(m => m.name === 'L&D Architect').id);
  assert.equal(ld.id, ld.matrixRoleId);
  const matrixNames = new Set(skillMaster.roles.map(m => norm(m.name)));
  for (const r of taxonomy.roles.filter(x => !x.matrixRoleId)) {
    assert.equal(r.matrixRoleId, null);
    assert.ok(!matrixNames.has(norm(r.name)), `${r.name} has no matrix counterpart`);
    assert.ok(!ROLE_SKILL_LEVELS.has(r.id), `${r.id} has no matrix skills`);
  }
  assert.ok(taxonomy.roles.some(r => r.id === 'role_chief-data-officer' && r.matrixRoleId === null));
  assert.ok(taxonomy.roles.some(r => r.id === 'role_ai-engineer' && r.matrixRoleId === 'role_ai-engineer'));
  assert.equal(new Set(inMatrix.map(r => r.matrixRoleId)).size, 45, 'no two owner roles map to the same matrix role');
});

test('the game service serves exactly taxonomy.json: PLATFORMS {id,name}, ROLES {id,name,inMatrix}', () => {
  assert.deepEqual(PLATFORMS, taxonomy.platforms.map(({ id, name }) => ({ id, name })));
  assert.deepEqual(ROLES, taxonomy.roles.map(r => ({ id: r.id, name: r.name, inMatrix: r.matrixRoleId !== null })));
});

test('build_taxonomy.mjs is deterministic: a run in a temporary copy reproduces taxonomy.json byte-for-byte', () => {
  const committed = readFileSync(join(DATA, 'taxonomy.json'));
  const tmp = mkdtempSync(join(tmpdir(), 'taxonomy-'));
  try {
    mkdirSync(join(tmp, 'tools/data'), { recursive: true });
    mkdirSync(join(tmp, 'packages/skill-master/data/taxonomy'), { recursive: true });
    copyFileSync(join(ROOT, 'tools/data/build_taxonomy.mjs'), join(tmp, 'tools/data/build_taxonomy.mjs'));
    copyFileSync(join(DATA, 'skill-master.json'), join(tmp, 'packages/skill-master/data/skill-master.json'));
    for (const f of [PLATFORM_CSV, ROLE_CSV]) copyFileSync(join(DATA, 'taxonomy', f), join(tmp, 'packages/skill-master/data/taxonomy', f));
    for (let run = 0; run < 2; run++) {
      execFileSync(process.execPath, [join(tmp, 'tools/data/build_taxonomy.mjs')], { cwd: tmp, stdio: 'pipe' });
      const built = readFileSync(join(tmp, 'packages/skill-master/data/taxonomy.json'));
      assert.ok(built.equals(committed), `run ${run + 1}: output differs from the committed taxonomy.json`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

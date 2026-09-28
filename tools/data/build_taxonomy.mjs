// Build packages/skill-master/data/taxonomy.json from the owner's platform and role lists (D-55):
//   packages/skill-master/data/taxonomy/platform-<date>.csv and role-<date>.csv, one name per line (BOM tolerated).
// Platforms and roles are independent choices. A role whose name matches a Skill Matrix role (skill-master.json, case
// and spacing insensitive, plus ALIASES) keeps that role's id, so its Skill Matrix skills still apply; any other role gets
// a new id and matrixRoleId null (the picker then falls back to company-wide skill lists).
// Usage: node tools/data/build_taxonomy.mjs [--platforms <csv>] [--roles <csv>]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA = fileURLToPath(new URL('../../packages/skill-master/data/', import.meta.url));
const DIR = `${DATA}taxonomy/`;
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const latest = (prefix) => readdirSync(DIR).filter(f => f.startsWith(prefix) && f.endsWith('.csv')).sort().at(-1);
const platformFile = args.platforms ?? `${DIR}${latest('platform-')}`;
const roleFile = args.roles ?? `${DIR}${latest('role-')}`;

/** Names the owner's list spells differently from the Skill Matrix. */
const ALIASES = { 'learning & development architect': 'l&d architect' };

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const slug = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function readList(file) {
  const names = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(l => l.replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const seen = new Set();
  return names.filter(n => { const k = norm(n); if (seen.has(k)) return false; seen.add(k); return true; });
}
function withIds(names, prefix, fixedId = () => null) {
  const used = new Set();
  return names.map(name => {
    let id = fixedId(name) ?? `${prefix}_${slug(name)}`;
    for (let i = 2; used.has(id); i++) id = `${prefix}_${slug(name)}-${i}`;
    used.add(id);
    return { id, name };
  });
}

const master = JSON.parse(readFileSync(`${DATA}skill-master.json`, 'utf8'));
const matrixByName = new Map(master.roles.map(r => [norm(r.name), r.id]));
const matrixIdOf = (name) => matrixByName.get(ALIASES[norm(name)] ?? norm(name)) ?? null;

const platforms = withIds(readList(platformFile), 'platform');
const roles = withIds(readList(roleFile), 'role', matrixIdOf).map(r => ({ ...r, matrixRoleId: matrixIdOf(r.name) }));
const out = {
  version: roleFile.match(/(\d\d-\d\d-\d\d)/)?.[1] ?? 'unknown',
  source: { platforms: platformFile.split('/').pop(), roles: roleFile.split('/').pop() },
  generatedBy: 'tools/data/build_taxonomy.mjs',
  counts: { platforms: platforms.length, roles: roles.length, rolesInMatrix: roles.filter(r => r.matrixRoleId).length },
  platforms,
  roles,
};
writeFileSync(`${DATA}taxonomy.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.counts), 'roles without Skill Matrix data:', roles.filter(r => !r.matrixRoleId).map(r => r.name).join(', '));

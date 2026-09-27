#!/usr/bin/env node
// Rebuilds the Soul decorations with Blender (D-29, docs/art/soul-decorations.md). No API key needed.
//   npm run ai:soul-decor                                  -> full build: stars, charms, slots, face kits, data module, review renders
//   npm run ai:soul-decor -- --mode charms --only tech-ruler,soft-daisy   -> rebuild some charms (after new icons land)
//   npm run ai:soul-decor -- --mode charms --kind soft     -> rebuild one kind
//   npm run ai:soul-decor -- --mode data [--check]         -> regenerate / check packages/ui/soul-decor-data.js
//   npm run ai:soul-decor -- --mode renders                -> review sheets only (reports/qa/screens/decor-*.png)
//   npm run ai:soul-decor -- --dry-run                     -> print the Blender command only
// Then `node tools/assets/build-all.js` copies and checks the runtime files (assets/souls/charms, assets/souls/faces).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadEnv } from './env.js';

const env = loadEnv();
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const pass = args.filter((a) => a !== '--dry-run');
if (!pass.includes('--mode')) pass.push('--mode', 'produce');
const script = join(ROOT, 'tools', 'ai', 'blender', 'soul_decor.py');
const cmd = [env.BLENDER_BIN, ['--background', '--factory-startup', '--python', script, '--', ...pass]];
console.log([cmd[0], ...cmd[1]].map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' '));
if (dry) process.exit(0);
if (!existsSync(env.BLENDER_BIN)) {
  console.error(`Blender not found at ${env.BLENDER_BIN}. Install Blender 5.x or set BLENDER_BIN in .env.`);
  process.exit(1);
}
const r = spawnSync(cmd[0], cmd[1], { stdio: 'inherit', env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '' } });
process.exit(r.status ?? 1);

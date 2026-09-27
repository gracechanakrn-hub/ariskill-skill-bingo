#!/usr/bin/env node
// Rebuilds the stage-13 Soul faces with Blender (D-31, docs/art/soul-faces.md). No API key needed.
//   npm run ai:soul-face                          -> full build: face plates, eyes, face kits, v3 body, sprites, 2D outline, data module, review sheets
//   npm run ai:soul-face -- --mode parts          -> plates, eyes and kits only (GLBs)
//   npm run ai:soul-face -- --mode body           -> the v3 body GLBs (hero + lite)
//   npm run ai:soul-face -- --mode sprites        -> the 2D sprites (needs the parts)
//   npm run ai:soul-face -- --mode data [--check] -> regenerate / check packages/ui/soul-face-data.js
//   npm run ai:soul-face -- --mode renders        -> review sheets only (reports/qa/screens/decor-v3-*.png)
//   npm run ai:soul-face -- --dry-run             -> print the Blender command only
// The plate sheet is traced once with plain python3 + PIL: python3 tools/ai/blender/soul_face.py --mode trace.
// Then `node tools/assets/build-all.js` copies and checks the runtime files (assets/souls/v3/).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadEnv } from './env.js';

const env = loadEnv();
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const pass = args.filter((a) => a !== '--dry-run');
if (!pass.includes('--mode')) pass.push('--mode', 'produce');
const script = join(ROOT, 'tools', 'ai', 'blender', 'soul_face.py');
const cmd = [env.BLENDER_BIN, ['--background', '--factory-startup', '--python', script, '--', ...pass]];
console.log([cmd[0], ...cmd[1]].map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' '));
if (dry) process.exit(0);
if (!existsSync(env.BLENDER_BIN)) {
  console.error(`Blender not found at ${env.BLENDER_BIN}. Install Blender 5.x or set BLENDER_BIN in .env.`);
  process.exit(1);
}
const r = spawnSync(cmd[0], cmd[1], { stdio: 'inherit', env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '' } });
process.exit(r.status ?? 1);

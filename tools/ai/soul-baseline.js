#!/usr/bin/env node
// Rebuilds the Arise Soul baseline character with Blender (docs/art/soul-baseline.md). No API key needed.
//   npm run ai:soul-baseline                      -> full production build into assets-src/generated/soul-baseline/v1
//   npm run ai:soul-baseline -- --mode fit        -> refit the camera to the reference (writes camera.json + overlay.png)
//   npm run ai:soul-baseline -- --mode build      -> quick preview build (match.png + overlay.png)
//   npm run ai:soul-baseline -- --dry-run         -> print the Blender command only
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadEnv } from './env.js';

const env = loadEnv();
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const pass = args.filter((a) => a !== '--dry-run');
if (!pass.includes('--mode')) pass.push('--mode', 'produce');
if (!pass.includes('--out')) pass.push('--out', join(ROOT, 'assets-src', 'generated', 'soul-baseline', 'v1'));
if (!pass.includes('--voxel')) pass.push('--voxel', pass[pass.indexOf('--mode') + 1] === 'produce' ? '0.003' : '0.006');
const script = join(ROOT, 'tools', 'ai', 'blender', 'soul_baseline.py');
const cmd = [env.BLENDER_BIN, ['--background', '--factory-startup', '--python', script, '--', ...pass]];
console.log([cmd[0], ...cmd[1]].map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' '));
if (dry) process.exit(0);
if (!existsSync(env.BLENDER_BIN)) {
  console.error(`Blender not found at ${env.BLENDER_BIN}. Install Blender 5.x or set BLENDER_BIN in .env.`);
  process.exit(1);
}
const r = spawnSync(cmd[0], cmd[1], { stdio: 'inherit', env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '' } });
process.exit(r.status ?? 1);

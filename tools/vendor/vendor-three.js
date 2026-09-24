#!/usr/bin/env node
// Vendors a pinned Three.js release into packages/vendor/three so the apps stay offline, CSP-safe
// (no import maps, no CDN) and reproducible. Usage: node tools/vendor/vendor-three.js <extracted npm package dir>
// Rewrites bare `from 'three'` specifiers in the copied addons to a relative path to build/three.module.js.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const src = process.argv[2];
if (!src || !existsSync(join(src, 'package.json'))) { console.error('usage: vendor-three.js <extracted three package dir>'); process.exit(1); }
const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
const out = join(ROOT, 'packages/vendor/three');
const FILES = [
  'build/three.module.js', 'build/three.core.js',
  'examples/jsm/postprocessing/EffectComposer.js', 'examples/jsm/postprocessing/RenderPass.js', 'examples/jsm/postprocessing/ShaderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js', 'examples/jsm/postprocessing/Pass.js', 'examples/jsm/postprocessing/MaskPass.js', 'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/shaders/CopyShader.js', 'examples/jsm/shaders/LuminosityHighPassShader.js', 'examples/jsm/shaders/OutputShader.js',
  'LICENSE',
];
const manifest = { name: 'three', version: pkg.version, license: pkg.license, source: `https://registry.npmjs.org/three/-/three-${pkg.version}.tgz`, vendoredBy: 'tools/vendor/vendor-three.js', files: [] };
for (const f of FILES) {
  const from = join(src, f), to = join(out, f);
  mkdirSync(dirname(to), { recursive: true });
  if (f.endsWith('.js') && f.startsWith('examples/')) {
    const rel = relative(dirname(to), join(out, 'build/three.module.js')).split('\\').join('/');
    const text = readFileSync(from, 'utf8').replace(/from\s+'three'/g, `from '${rel.startsWith('.') ? rel : './' + rel}'`);
    writeFileSync(to, text);
  } else copyFileSync(from, to);
  const buf = readFileSync(to);
  manifest.files.push({ path: `packages/vendor/three/${f}`, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
}
// A tiny facade so app code imports one path for core + addons.
writeFileSync(join(out, 'index.js'), `// Vendored Three.js ${pkg.version} (MIT). Regenerate with tools/vendor/vendor-three.js; never edit by hand.\nexport * from './build/three.module.js';\n`);
writeFileSync(join(out, 'addons.js'), `// Vendored Three.js ${pkg.version} addons (MIT).\nexport { EffectComposer } from './examples/jsm/postprocessing/EffectComposer.js';\nexport { RenderPass } from './examples/jsm/postprocessing/RenderPass.js';\nexport { ShaderPass } from './examples/jsm/postprocessing/ShaderPass.js';\nexport { UnrealBloomPass } from './examples/jsm/postprocessing/UnrealBloomPass.js';\nexport { OutputPass } from './examples/jsm/postprocessing/OutputPass.js';\n`);
writeFileSync(join(out, 'VENDOR.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: '@ariskill/vendor-three', version: pkg.version, type: 'module', private: true, license: 'MIT', description: 'Pinned vendored Three.js for offline, CSP-safe use' }, null, 2) + '\n');
console.log(`vendored three ${pkg.version}: ${manifest.files.length} files, ${manifest.files.reduce((a, f) => a + f.bytes, 0)} bytes`);

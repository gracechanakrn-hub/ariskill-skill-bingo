#!/usr/bin/env node
// Emits tokens.css from tokens.json deterministically. Usage: node packages/design-tokens/build.js [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export function buildCss(tokens) {
  const lines = [
    `/* ${tokens.name} v${tokens.version} - ${tokens.status.toUpperCase()} tokens. Generated from tokens.json by build.js; do not hand-edit. */`,
    '/* Provisional: the AriSkill design system was not available (OD-12). Map to verified tokens before visual sign-off. */',
  ];
  for (const key of ['dark', 'light', 'venue']) {
    const t = tokens.themes[key];
    lines.push('', `/* ${key}${t.note ? ': ' + t.note : ''} */`, `${t.selector} {`);
    for (const [k, v] of Object.entries(t.tokens)) lines.push(`  ${k}: ${v};`);
    lines.push('}');
  }
  lines.push('', '/* Colour scheme hint for form controls and scrollbars */', ':root { color-scheme: dark; }', '[data-theme="light"] { color-scheme: light; }',
    '', '/* Reduced effects: travel/parallax/bursts are replaced by short fades (motion-spec); durations collapse to one perceivable 120 ms fade, never 0 */',
    '@media (prefers-reduced-motion: reduce) {', '  :root { --duration-fast: 120ms; --duration-base: 120ms; --duration-slow: 120ms; --ease-emphasized: var(--ease-standard); }', '}');
  return lines.join('\n') + '\n';
}

export function loadTokens() { return JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8')); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const css = buildCss(loadTokens());
  const out = join(here, 'tokens.css');
  if (process.argv.includes('--check')) {
    const current = readFileSync(out, 'utf8');
    if (current !== css) { console.error('tokens.css is stale; run node packages/design-tokens/build.js'); process.exit(1); }
    console.log('tokens.css up to date');
  } else {
    writeFileSync(out, css);
    console.log(`wrote ${out}`);
  }
}

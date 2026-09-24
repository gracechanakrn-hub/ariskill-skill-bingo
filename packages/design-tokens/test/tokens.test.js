// Design token checks: token presence in JSON + CSS, WCAG contrast, colour-vision-deficiency separability of Core vs Critical.
// Run: node --test packages/design-tokens/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCss } from '../build.js';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, '..', 'tokens.json'), 'utf8'));
const css = readFileSync(join(here, '..', 'tokens.css'), 'utf8');
const dark = tokens.themes.dark.tokens, light = tokens.themes.light.tokens, venue = tokens.themes.venue.tokens;

const REQUIRED = [
  '--color-bg', '--color-bg-elevated', '--color-surface', '--color-surface-2', '--color-border', '--color-text', '--color-text-muted', '--color-text-inverse',
  '--color-accent', '--color-accent-strong', '--color-core', '--color-critical', '--color-optional', '--color-success', '--color-warning', '--color-danger', '--color-info',
  '--color-focus', '--color-match', '--color-line', '--font-sans', '--font-mono',
  '--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl', '--font-size-display',
  '--line-height-tight', '--line-height-normal',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8', '--space-9', '--space-10',
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill', '--shadow-1', '--shadow-2', '--touch-min', '--z-toast', '--z-modal',
  '--duration-fast', '--duration-base', '--duration-slow', '--ease-standard', '--ease-emphasized',
  // 1.2.0 sticker language (docs/art/sticker-art-direction.md, D-25) - names are final, other packages use them with fallbacks
  '--sticker-navy', '--sticker-space', '--sticker-aurora-teal', '--sticker-aurora-lime', '--sticker-lilac', '--sticker-violet-deep',
  '--sticker-mint', '--sticker-cyan', '--sticker-peach', '--sticker-gold', '--sticker-rose', '--sticker-badge', '--sticker-badge-ink',
  '--sticker-outline', '--sticker-shadow', '--font-display',
];
const STICKER_VALUES = {
  '--sticker-navy': '#0B1030', '--sticker-space': '#151C48', '--sticker-aurora-teal': '#4FE3C1', '--sticker-aurora-lime': '#B6FF5C',
  '--sticker-lilac': '#8B7CF0', '--sticker-violet-deep': '#3B2A7A', '--sticker-mint': '#7CF5C8', '--sticker-cyan': '#63E6FF',
  '--sticker-peach': '#FFB27A', '--sticker-gold': '#F6C453', '--sticker-rose': '#FF6FA5', '--sticker-badge': '#2D2670',
  '--sticker-badge-ink': '#E7DFFF', '--sticker-outline': '#FFFFFF',
};

// ---- colour maths (WCAG 2.x relative luminance + Machado 2009 CVD simulation + CIE Lab) ----
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a, b) { const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); }
const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const mul = (M, v) => M.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
function lab(rgbLin) {
  const [r, g, b] = rgbLin;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function cvdDistance(h1, h2, kind) { return deltaE(lab(mul(CVD[kind], hex(h1).map(lin))), lab(mul(CVD[kind], hex(h2).map(lin)))); }

test('every required token exists in tokens.json (dark) and tokens.css (:root)', () => {
  const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  for (const t of REQUIRED) {
    assert.ok(t in dark, `${t} missing in tokens.json`);
    assert.ok(new RegExp(`^\\s*${t}: .+;$`, 'm').test(rootBlock), `${t} missing in tokens.css :root`);
  }
  assert.equal(Object.keys(dark).length, REQUIRED.length, 'no undeclared tokens');
});

test('tokens.css is generated from tokens.json (no drift) and every token is labelled provisional', () => {
  assert.equal(css, buildCss(tokens));
  assert.equal(tokens.status, 'provisional');
  assert.match(css, /PROVISIONAL/);
  for (const t of REQUIRED) { assert.ok(t in tokens.verified.map, `${t} missing from provisional->verified map`); assert.equal(tokens.verified.map[t], null); }
});

test('light theme overrides all colour tokens; venue theme scales type to venue minimums', () => {
  for (const t of REQUIRED.filter((k) => k.startsWith('--color-'))) assert.ok(t in light, `${t} missing in light theme`);
  assert.match(css, /\[data-theme="light"\] \{/);
  assert.match(css, /\.theme-venue \{/);
  assert.ok(parseInt(venue['--font-size-md']) >= 40, 'venue body >= 40px');
  assert.ok(parseInt(venue['--font-size-2xl']) >= 96, 'venue headline >= 96px');
  assert.equal(dark['--touch-min'], '44px');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => dark[`--space-${i}`]), ['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px', '72px', '80px']);
  assert.ok(dark['--font-sans'].startsWith('"Plus Jakarta Sans", system-ui'), 'sans stack leads with the self-hosted Plus Jakarta Sans and falls back to system-ui');
  assert.ok(!/AriSkill Sans|Inter|Poppins|Montserrat/.test(dark['--font-sans']), 'no unverified brand fonts');
  const fontDir = join(here, '..', '..', 'vendor', 'plus-jakarta-sans');
  const fontsCss = readFileSync(join(fontDir, 'fonts.css'), 'utf8');
  assert.ok(!/https?:\/\//.test(fontsCss), 'fonts.css must not reference remote URLs (CSP default-src self)');
  for (const f of ['plus-jakarta-sans-latin.woff2', 'plus-jakarta-sans-latin-ext.woff2', 'OFL.txt', 'VENDOR.json']) assert.ok(existsSync(join(fontDir, f)), `${f} vendored`);
});

for (const [name, T] of [['dark', dark], ['light', light]]) {
  test(`${name}: text/background pairs meet WCAG AA (4.5:1) and UI colours meet 3:1 on the background`, () => {
    const surfaces = ['--color-bg', '--color-bg-elevated', '--color-surface', '--color-surface-2'];
    for (const s of surfaces) {
      assert.ok(contrast(T['--color-text'], T[s]) >= 4.5, `text on ${s}: ${contrast(T['--color-text'], T[s]).toFixed(2)}`);
      assert.ok(contrast(T['--color-text-muted'], T[s]) >= 4.5, `muted on ${s}: ${contrast(T['--color-text-muted'], T[s]).toFixed(2)}`);
    }
    for (const c of ['--color-accent', '--color-core', '--color-critical', '--color-success', '--color-warning', '--color-danger', '--color-info', '--color-focus', '--color-match']) {
      assert.ok(contrast(T['--color-text-inverse'], T[c]) >= 4.5, `inverse text on ${c}: ${contrast(T['--color-text-inverse'], T[c]).toFixed(2)}`);
      assert.ok(contrast(T[c], T['--color-bg']) >= 3, `${c} on bg: ${contrast(T[c], T['--color-bg']).toFixed(2)}`);
    }
    for (const c of ['--color-accent-strong', '--color-optional', '--color-line', '--color-border']) assert.ok(contrast(T[c], T['--color-bg']) >= 3, `${c} on bg`);
    assert.ok(contrast(T['--color-focus'], T['--color-surface-2']) >= 3, 'focus ring on surface-2');
  });

  test(`${name}: Core vs Critical remain distinguishable under protanopia, deuteranopia and tritanopia`, () => {
    for (const kind of Object.keys(CVD)) {
      const d = cvdDistance(T['--color-core'], T['--color-critical'], kind);
      assert.ok(d >= 25, `${kind}: deltaE ${d.toFixed(1)} between core and critical`);
      const d2 = cvdDistance(T['--color-core'], T['--color-optional'], kind);
      assert.ok(d2 >= 15, `${kind}: core vs optional ${d2.toFixed(1)}`);
      const d3 = cvdDistance(T['--color-critical'], T['--color-optional'], kind);
      assert.ok(d3 >= 15, `${kind}: critical vs optional ${d3.toFixed(1)}`);
    }
    // colour is never the only signal: icon/label rule carried in tokens
    assert.ok(tokens.rules.coreCriticalIcons.core && tokens.rules.coreCriticalIcons.critical && tokens.rules.coreCriticalIcons.optional);
    assert.match(tokens.rules.semanticColourNeverAlone, /never the only signal/);
  });
}

// ---- 1.2.0 sticker language ----
test('sticker tokens carry the brief values, the violet dark palette is untouched and nothing was renamed', () => {
  assert.equal(tokens.version, '1.2.0');
  for (const [k, v] of Object.entries(STICKER_VALUES)) assert.equal(dark[k], v, k);
  assert.match(dark['--sticker-shadow'], /^0 6px 14px rgba\(5, 8, 30, 0?\.55\)$/);
  // v1.1.0 violet palette unchanged
  assert.deepEqual([dark['--color-bg'], dark['--color-surface'], dark['--color-accent'], dark['--color-core'], dark['--color-critical']], ['#120A2E', '#241858', '#A98BFF', '#F5C84B', '#6FD6FF']);
  assert.ok(!Object.keys(dark).some((k) => /^--(colour|stickers?-color)/.test(k)), 'no renamed tokens');
  for (const k of Object.keys(STICKER_VALUES)) assert.match(css, new RegExp(`^  ${k}: ${STICKER_VALUES[k]};$`, 'm'));
});

test('sticker contrast pairs: pill ink on pill fill, navy on lime label, body text on every tile surface incl. sticker sky', () => {
  const pill = contrast(dark['--sticker-badge-ink'], dark['--sticker-badge']);
  assert.ok(pill >= 4.5, `pill ink on pill fill ${pill.toFixed(2)}`);
  assert.ok(pill >= 7, `AAA on the pill (measured 10.1:1; the brief's 11.9 figure was a typo): ${pill.toFixed(2)}`);
  const lime = contrast(dark['--sticker-navy'], dark['--sticker-aurora-lime']);
  assert.ok(lime >= 4.5, `navy on lime ${lime.toFixed(2)}`);
  assert.ok(contrast('#FFFFFF', dark['--sticker-aurora-lime']) < 4.5, 'white on lime fails AA, so lime labels must use navy text (rule carried in tokens)');
  assert.match(tokens.rules.sticker.limeLabel, /navy/);
  for (const s of ['--color-bg', '--color-bg-elevated', '--color-surface', '--color-surface-2', '--sticker-navy', '--sticker-space', '--sticker-badge']) {
    assert.ok(contrast(dark['--color-text'], dark[s]) >= 4.5, `text on ${s}: ${contrast(dark['--color-text'], dark[s]).toFixed(2)}`);
  }
  // white die-cut outline separates any Soul body from the sticker sky (UI contrast 3:1)
  for (const s of ['--sticker-navy', '--sticker-space']) assert.ok(contrast(dark['--sticker-outline'], dark[s]) >= 3, `outline on ${s}`);
  // gold star and cyan speckle read on navy
  for (const c of ['--sticker-gold', '--sticker-cyan', '--sticker-mint', '--sticker-aurora-teal', '--sticker-aurora-lime', '--sticker-peach']) assert.ok(contrast(dark[c], dark['--sticker-navy']) >= 3, `${c} on navy`);
  assert.match(tokens.rules.sticker.nonRanking, /BR-17/);
});

test('--font-display leads with the vendored Fredoka (OFL) and falls back to Plus Jakarta Sans; no remote font URLs', () => {
  assert.equal(dark['--font-display'], '"Fredoka", "Plus Jakarta Sans", sans-serif');
  assert.ok(dark['--font-sans'].startsWith('"Plus Jakarta Sans"'), 'body text stays Plus Jakarta Sans');
  const dir = join(here, '..', '..', 'vendor', 'fredoka');
  for (const f of ['fredoka-latin.woff2', 'fredoka-latin-ext.woff2', 'OFL.txt', 'VENDOR.json', 'fonts.css', 'package.json']) assert.ok(existsSync(join(dir, f)), `${f} vendored`);
  const fontsCss = readFileSync(join(dir, 'fonts.css'), 'utf8');
  assert.ok(!/https?:\/\//.test(fontsCss), 'fonts.css must not reference remote URLs (CSP default-src self)');
  assert.match(fontsCss, /font-family: "Fredoka"/);
  assert.match(fontsCss, /font-display: swap/);
  assert.match(fontsCss, /font-weight: 500 700/);
  const vendor = JSON.parse(readFileSync(join(dir, 'VENDOR.json'), 'utf8'));
  assert.equal(vendor.license, 'OFL-1.1');
  assert.match(vendor.source, /fonts\.googleapis\.com/);
  for (const f of vendor.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  assert.match(readFileSync(join(dir, 'OFL.txt'), 'utf8'), /SIL Open Font License, Version 1\.1/);
});

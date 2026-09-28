// Automated accessibility / CSP static checks over the four client apps (requirement 12.2, 8.1; AC 13; WCAG 2.2 AA baseline).
// Apps are built by other workstreams and may be absent or partial: an app without index.html is SKIPPED with a clear message
// and every check passes only when the app is present. Heuristics are source-level (no browser): they read index.html, every
// .js module and every .css file under the app directory. Manual walkthroughs live in tests/accessibility/README.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
// QA_APPS_ROOT lets the suite be self-tested against fixture apps outside the repo (never used by the release gate).
const APPS_ROOT = process.env.QA_APPS_ROOT || ROOT;
const APPS = [
  { id: 'employee-mobile', dir: 'apps/employee-mobile', mount: '/play', theme: 'mobile' },
  { id: 'admin-portal', dir: 'apps/admin-portal', mount: '/admin', theme: 'admin' },
  { id: 'public-galaxy', dir: 'apps/public-galaxy', mount: '/public', theme: 'venue' },
  { id: 'stage-dashboard', dir: 'apps/stage-dashboard', mount: '/stage', theme: 'venue' },
];
// UI-kit generators whose output is already escaped (packages/ui/qr.js escapeAttr, soul-renderer.js esc) may be assigned to innerHTML.
const TRUSTED_HTML_GENERATORS = ['qrToSvg(', 'renderSoulSvg(', 'renderQr('];

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name); const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== 'test') walk(p, exts, out); } // app unit tests are not shipped
    else if (exts.includes(extname(name))) out.push(p);
  }
  return out;
}
function loadApp(app) {
  const dir = join(APPS_ROOT, app.dir);
  if (!existsSync(dir)) return { present: false, reason: `${app.dir} does not exist` };
  const index = join(dir, 'index.html');
  const files = walk(dir, ['.html', '.js', '.mjs', '.css']);
  if (!existsSync(index)) return { present: false, reason: files.length ? `${app.dir}/index.html not delivered yet (${files.length} other file(s) present)` : `${app.dir} is empty (app not delivered yet)` };
  const read = (p) => ({ path: relative(APPS_ROOT, p), text: readFileSync(p, 'utf8') });
  return { present: true, html: readFileSync(index, 'utf8'), js: files.filter(f => /\.m?js$/.test(f)).map(read), css: files.filter(f => f.endsWith('.css')).map(read), htmlFiles: files.filter(f => f.endsWith('.html')).map(read) };
}
const count = (text, re) => (text.match(re) || []).length;
/** Extract the balanced argument list text of every `h('<tag>'` call. Returns [{ file, line, args, attrs }]. */
function hCalls(js, tag) {
  const out = [];
  for (const { path, text } of js) {
    const re = new RegExp(`\\bh\\(\\s*['"\`]${tag}['"\`]`, 'g');
    let m;
    while ((m = re.exec(text))) {
      let i = m.index + m[0].length, depth = 1, quote = null, argStart = i, args = [], esc = false;
      const start = i;
      for (; i < text.length && depth > 0; i++) {
        const c = text[i];
        if (quote) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === quote) quote = null; continue; }
        if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
        if (c === '(' || c === '{' || c === '[') depth += 1;
        else if (c === ')' || c === '}' || c === ']') { depth -= 1; if (depth === 0) { args.push(text.slice(argStart, i)); break; } }
        else if (c === ',' && depth === 1) { args.push(text.slice(argStart, i)); argStart = i + 1; }
      }
      const line = text.slice(0, m.index).split('\n').length;
      const cleaned = args.map(a => a.trim()).filter(Boolean);
      const attrs = (cleaned[0] ?? '').startsWith('{') ? cleaned[0] : '';
      out.push({ file: path, line, args: cleaned, attrs, full: text.slice(start, i), index: m.index, end: i });
    }
  }
  return out;
}
const attrHas = (attrs, name) => new RegExp(`(^|[\\s{,])['"]?${name}['"]?\\s*:`).test(attrs);
const isLiteral = (rhs) => /^(['"])(?:(?!\1)[^\\]|\\.)*\1$/.test(rhs) || (/^`[^`]*`$/.test(rhs) && !rhs.includes('${')) || rhs === "''" || rhs === '""';

describe('accessibility static checks', () => {
  test('shared UI kit: base.css defines a 44 px minimum touch target and applies it to buttons, options and inputs', () => {
    const css = readFileSync(join(ROOT, 'packages/ui/base.css'), 'utf8');
    const m = css.match(/--ui-touch-min:\s*var\(--touch-min,\s*(\d+)px\)/);
    assert.ok(m, '--ui-touch-min token present'); assert.ok(Number(m[1]) >= 44, `touch minimum ${m[1]}px >= 44`);
    assert.ok(count(css, /min-height:\s*var\(--ui-touch-min\)/g) >= 3, 'the token is applied to interactive classes');
    assert.ok(/\.skip-link/.test(css) && /\.visually-hidden/.test(css), 'skip-link and visually-hidden utilities exist');
    assert.ok(/:focus-visible/.test(css), 'visible focus styling');
    assert.ok(/prefers-reduced-motion/.test(css + readFileSync(join(ROOT, 'packages/ui/motion.css'), 'utf8')), 'reduced motion media query in the kit');
  });

  for (const app of APPS) {
    const loaded = loadApp(app);
    describe(`${app.id} (${app.mount})`, { skip: loaded.present ? false : `SKIPPED: ${loaded.reason}` }, () => {
      if (!loaded.present) return;
      const { html, js, css } = loaded;
      const allJs = js.map(f => f.text).join('\n');
      const allCss = css.map(f => f.text).join('\n');
      const everything = html + '\n' + allJs;

      test('index.html: lang, charset, title, viewport', () => {
        assert.ok(/<html[^>]*\slang=["'][a-z]{2}/i.test(html), '<html lang>');
        assert.ok(/<meta[^>]*charset=/i.test(html), 'charset');
        assert.ok(/<title>\s*[^<\s][^<]*<\/title>/i.test(html), 'non-empty <title>');
        assert.ok(/<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/i.test(html), 'viewport with width=device-width');
        assert.ok(!/<meta[^>]*name=["']viewport["'][^>]*(user-scalable=no|maximum-scale=1(\.0)?\b)/i.test(html), 'zoom is not disabled (reflow/zoom, 12.2)');
      });

      test('skip link and exactly one main landmark', (tc) => {
        // Employee and admin are keyboard flows (12.2): hard failures. Venue displays (public, stage) are not operated by keyboard:
        // a missing skip link / main landmark is recorded as a minor finding (diagnostic) for reports/qa/accessibility-review.md.
        const critical = app.theme !== 'venue';
        const soft = (cond, msg) => { if (critical) assert.ok(cond, msg); else if (!cond) tc.diagnostic(`MINOR ${app.id}: ${msg}`); };
        soft(/class=["'][^"']*\bskip-link\b/.test(html) || /skip-link/.test(allJs) || /href=["']#main["']/.test(html), 'skip link present (class skip-link or href="#main")');
        const htmlMains = count(html, /<main\b/gi) + count(html, /role=["']main["']/gi);
        const jsMains = hCalls(js, 'main').length + count(allJs, /createElement\(\s*['"]main['"]\s*\)/g) + count(allJs, /role:\s*['"]main['"]/g);
        assert.ok(htmlMains <= 1, `index.html declares at most one main landmark (found ${htmlMains})`);
        if (htmlMains === 1) assert.equal(jsMains, 0, 'index.html already has <main>; modules must not create another');
        soft(htmlMains + jsMains >= 1, 'a main landmark exists (index.html or created by a module)');
        if (jsMains > 1) tc.diagnostic(`${app.id}: ${jsMains} h('main') call sites in modules (alternative views); verify only one is mounted at a time`);
        soft(/<h1\b/i.test(html) || hCalls(js, 'h1').length >= 1 || /createElement\(\s*['"]h1['"]/.test(allJs), 'a page heading (h1)');
      });

      test('CSP: no inline <script>, no inline event handlers, no third-party script or stylesheet origins', () => {
        for (const m of html.matchAll(/<script\b([^>]*)>/gi)) assert.ok(/\ssrc=/.test(m[1]), `inline <script> is blocked by CSP: <script${m[1]}>`);
        assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), 'no inline on*= handlers in HTML');
        assert.ok(!/<(script|link)\b[^>]*(src|href)=["']https?:\/\//i.test(html), 'no external script/stylesheet origins (default-src self)');
        assert.ok(!/\bimport\s*\(?\s*['"]https?:\/\//.test(allJs), 'no remote module imports');
        assert.ok(/href=["']\/packages\/design-tokens\/tokens\.css["']/.test(html) && /href=["']\/packages\/ui\/base\.css["']/.test(html), 'tokens.css then base.css are loaded');
      });

      test('images and role=img SVGs have text alternatives', () => {
        for (const m of html.matchAll(/<img\b[^>]*>/gi)) assert.ok(/\salt=/.test(m[0]), `img without alt: ${m[0]}`);
        for (const m of html.matchAll(/<svg\b[^>]*role=["']img["'][^>]*>/gi)) assert.ok(/aria-label(ledby)?=/.test(m[0]) || /<title>/i.test(html.slice(m.index, m.index + 400)), `svg role=img without label: ${m[0].slice(0, 80)}`);
        for (const c of hCalls(js, 'img')) assert.ok(attrHas(c.attrs, 'alt'), `${c.file}:${c.line} h('img') without alt`);
        for (const c of hCalls(js, 'svg')) if (/role:\s*['"]img['"]/.test(c.attrs)) assert.ok(attrHas(c.attrs, 'aria-label') || attrHas(c.attrs, 'aria-labelledby'), `${c.file}:${c.line} h('svg', role img) without aria-label`);
        for (const c of hCalls(js, 'canvas')) assert.ok(attrHas(c.attrs, 'aria-label') || attrHas(c.attrs, 'aria-labelledby') || /role:\s*['"](img|presentation)['"]/.test(c.attrs) || attrHas(c.attrs, 'aria-hidden'), `${c.file}:${c.line} h('canvas') needs aria-label/role img or aria-hidden`);
        for (const m of html.matchAll(/<canvas\b[^>]*>/gi)) assert.ok(/aria-(label|hidden)|role=/.test(m[0]), `canvas without label/role: ${m[0]}`);
      });

      test('form controls have labels (label[for]/aria-label/aria-labelledby/wrapping label)', () => {
        // label targets: HTML for="", and h('label', { for: '...' }) with quoted or template-literal ids (compared as raw source text)
        const labelFor = new Set([...html.matchAll(/<label\b[^>]*\sfor=["']([^"']+)["']/gi)].map(m => m[1]).concat([...allJs.matchAll(/\b(?:for|htmlFor|'for')\s*:\s*(['"`])([^'"`]+)\1/g)].map(m => m[2])));
        const idOf = (attrs) => (attrs.match(/\bid:\s*(['"`])([^'"`]+)\1/) || [])[2];
        for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
          const tag = m[0];
          if (/type=["']hidden["']/i.test(tag)) continue;
          const id = (tag.match(/\sid=["']([^"']+)["']/) || [])[1];
          const wrapped = /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/i.test(html.slice(Math.max(0, m.index - 400), m.index));
          assert.ok(/aria-label(ledby)?=/.test(tag) || (id && labelFor.has(id)) || wrapped || /\stitle=/.test(tag), `unlabelled control: ${tag}`);
        }
        // a control created inside an h('label', ...) call is labelled by wrapping, like <label><input> in HTML (D-53 start-mode radios)
        const labelCalls = hCalls(js, 'label');
        const wrappedInLabel = (c) => labelCalls.some(l => l.file === c.file && l.index < c.index && c.index < l.end);
        for (const tag of ['input', 'select', 'textarea']) for (const c of hCalls(js, tag)) {
          if (/type:\s*['"]hidden['"]/.test(c.attrs)) continue;
          const id = idOf(c.attrs);
          const ok = attrHas(c.attrs, 'aria-label') || attrHas(c.attrs, 'aria-labelledby') || (id && labelFor.has(id)) || (id === undefined && /\bid:\s*[a-zA-Z_$]/.test(c.attrs)) /* id from a variable: assume the label is generated alongside */ || attrHas(c.attrs, 'title') || wrappedInLabel(c);
          assert.ok(ok, `${c.file}:${c.line} h('${tag}') without label association`);
        }
      });

      test('buttons have an accessible name (text child or aria-label); no title-only buttons', () => {
        for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
          const text = m[2].replace(/<[^>]+>/g, '').trim();
          assert.ok(text.length > 0 || /aria-label(ledby)?=/.test(m[1]) || /<(img|svg)\b[^>]*(alt|aria-label)=/.test(m[2]), `button without name: <button${m[1]}>${m[2].slice(0, 60)}`);
        }
        for (const c of hCalls(js, 'button')) {
          const hasChildren = c.args.length > (c.attrs ? 1 : 0);
          const named = attrHas(c.attrs, 'aria-label') || attrHas(c.attrs, 'aria-labelledby') || attrHas(c.attrs, 'text');
          assert.ok(hasChildren || named, `${c.file}:${c.line} h('button') without text child or aria-label`);
          assert.ok(!c.attrs || attrHas(c.attrs, 'type') || /\btype\b/.test(c.attrs), `${c.file}:${c.line} h('button') should declare type (button/submit)`);
        }
      });

      test('no innerHTML / insertAdjacentHTML / html: with dynamic content (XSS, T13)', () => {
        for (const { path, text } of js) {
          for (const m of text.matchAll(/\.(innerHTML|outerHTML)\s*=\s*([^;\n]+)/g)) {
            const rhs = m[2].trim();
            assert.ok(isLiteral(rhs) || TRUSTED_HTML_GENERATORS.some(g => rhs.startsWith(g)), `${path}: ${m[1]} assigned dynamic content: ${rhs.slice(0, 80)}`);
          }
          for (const m of text.matchAll(/insertAdjacentHTML\(\s*['"][a-z]+['"]\s*,\s*([^)]+)\)/g)) assert.ok(isLiteral(m[1].trim()) || TRUSTED_HTML_GENERATORS.some(g => m[1].trim().startsWith(g)), `${path}: insertAdjacentHTML with dynamic content`);
          for (const m of text.matchAll(/[{,\s]html:\s*([^,}\n]+)/g)) assert.ok(isLiteral(m[1].trim()) || TRUSTED_HTML_GENERATORS.some(g => m[1].trim().startsWith(g)), `${path}: h() html: attribute with dynamic content: ${m[1].trim().slice(0, 80)}`);
          assert.ok(!/document\.write\(/.test(text), `${path}: document.write`);
          assert.ok(!/\beval\(|new Function\(/.test(text), `${path}: eval / new Function`);
        }
      });

      test('live region for realtime announcements; tabs use role=tablist; reduced motion and mute are respected', () => {
        assert.ok(/aria-live=/.test(html) || /\bannounce\(/.test(allJs) || /['"]aria-live['"]\s*:|aria-live:/.test(allJs), 'at least one aria-live region or announce() usage');
        const tabs = count(everything, /role=["']tab["']|role:\s*['"]tab['"]/g);
        if (tabs > 0) { assert.ok(/tablist/.test(everything), 'role=tab present but no tablist'); assert.ok(/aria-selected/.test(everything), 'tabs manage aria-selected'); assert.ok(/tabpanel/.test(everything), 'tabpanels present'); }
        assert.ok(/prefersReducedMotion|restoreReducedMotion|prefers-reduced-motion/.test(allJs + allCss), 'reduced motion honoured (motion.js API or media query)');
        if (/audio\.js|createAudioManager/.test(allJs)) assert.ok(/setMuted|muted/i.test(allJs), 'audio manager used -> a mute control exists');
        const globalKeys = js.flatMap(({ path, text }) => text.split('\n').map((l, i) => [path, i + 1, l]).filter(([, , l]) => /\b(document|window)\.addEventListener\(\s*['"]key(down|up|press)['"]/.test(l) && !/unlock|once:\s*true|Escape|focusTrap/i.test(l)));
        assert.deepEqual(globalKeys.map(([p, i]) => `${p}:${i}`), [], 'no global keyboard shortcuts (document-level key listeners may only unlock audio once or handle Escape/focus traps)');
      });

      test('app CSS: no focus outline removal without :focus-visible, touch target token never lowered, reflow-friendly units', () => {
        for (const { path, text } of css) {
          for (const m of text.matchAll(/([^{}]+)\{[^{}]*outline\s*:\s*(none|0)\b[^{}]*\}/g)) {
            const selector = m[1].trim();
            const interactive = /\b(button|a|input|select|textarea|summary)\b|\.btn|\.option|\.tab\b|\.chip|\[role=|:focus/.test(selector);
            if (interactive) assert.ok(/:focus-visible/.test(text), `${path}: "${selector}" removes the outline of an interactive element without a :focus-visible replacement`);
          }
          for (const m of text.matchAll(/--(ui-)?touch-min:\s*(\d+)px/g)) assert.ok(Number(m[2]) >= 44, `${path} lowers the touch target token to ${m[2]}px`);
          if (app.theme === 'mobile') assert.ok(!/min-width:\s*(3[3-9]\d|[4-9]\d\d|\d{4,})px/.test(text), `${path}: fixed min-width > 320 px breaks reflow at 320 px`);
        }
        if (app.theme === 'venue') assert.ok(/theme-venue/.test(html) || /theme-venue/.test(allJs), 'venue apps use the theme-venue scale (40 px body / 96 px headline)');
        if (app.id === 'admin-portal') assert.ok(/data-theme=["']light["']/.test(html) || /data-theme/.test(allJs), 'admin uses the light theme');
      });

      test('copy comes from the shared catalog (no hard-coded exception copy) and server authority is respected', () => {
        assert.ok(/packages\/contracts\/index\.js/.test(allJs), 'imports the copy catalog (t()/exception())');
        const randomGameState = js.flatMap(({ path, text }) => text.split('\n').map((l, i) => [path, i + 1, l]).filter(([, , l]) => /Math\.random\(\)/.test(l) && /\b(draw|winner|match|position|shuffle|cell|skill|pool|bingo)/i.test(l)));
        assert.deepEqual(randomGameState.map(([p, i]) => `${p}:${i}`), [], 'clients never randomize game state (ids and decoration may use Math.random)');
        assert.ok(!/localStorage\.setItem\([^)]*(token|session)/i.test(allJs) || /sessionStorage/.test(allJs), 'session tokens are not persisted in localStorage beyond the session');
      });
    });
  }
});

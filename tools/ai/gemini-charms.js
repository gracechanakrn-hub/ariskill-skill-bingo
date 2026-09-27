#!/usr/bin/env node
// tools/ai/gemini-charms.js - the 100 technical + soft charm icons of the Soul decorations (stage 12, D-29,
// docs/art/soul-decorations.md). One Gemini image request per catalog charm: the family style in
// tools/ai/prompts/charms.json plus the charm's `look`. Raw images land in assets-src/generated/charms/raw/ (git-ignored),
// tools/ai/lib/charm_cutout.py cuts each one out of the flat key colour, runs the QA checks and the shipped attempt is
// written to assets-src/charms/icons/<id>.png (256x256 RGBA). Unlike the visuals plates these icons ship as game art
// (D-29, owner sign-off OD-19), so every icon's model, full prompt and sha256s go to assets-src/charms/provenance.json.
//
//   node tools/ai/gemini-charms.js --list                       ids, kind, attempts and QA state
//   node tools/ai/gemini-charms.js --dry-run --pilot            print the requests, write them redacted to reports/ai/dry-run/
//   node tools/ai/gemini-charms.js --pilot                      the 6 pilot charms (charms.json "pilot"; no attempt cap)
//   node tools/ai/gemini-charms.js                              every charm without a passing icon or flagged in review (resumable)
//   node tools/ai/gemini-charms.js --kind soft --only soft-rose,soft-tulip --regen   new attempts even when they pass
//   node tools/ai/gemini-charms.js --process                    cut-out, QA, contact sheets and provenance only (no requests)
//   options: --model <id>  --concurrency 3  --temperature <n>  --max-attempts 3  --refs 0 (no style references)
//            --phase <label> (e.g. compare: never shipped, no cap)  --dry-run-dir <dir>
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, loadEnv, requireKey, redact } from './env.js';
import { DRY_RUN_DIR, GENERATED_DIR, REPORTS_AI, ensureDir, log, warn, nowStamp, parseArgs, postJson, readJson, sha256Hex, shapeDryRun, writeDryRun, writeJson } from './lib/common.js';
import { buildGenerateRequest, composePrompt, extractImages, extractModelParts, extractText, geminiHeaders, geminiUrl } from './lib/gemini.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROMPTS_PATH = join(HERE, 'prompts', 'charms.json');
export const CATALOG_PATH = join(ROOT, 'packages', 'game-rules', 'src', 'soul-catalog.js');
export const CUTOUT_PY = join(HERE, 'lib', 'charm_cutout.py');
export const CHARM_GEN_DIR = join(GENERATED_DIR, 'charms');
export const RAW_DIR = join(CHARM_GEN_DIR, 'raw');
export const CUT_DIR = join(CHARM_GEN_DIR, 'cut');
export const ATTEMPTS_PATH = join(CHARM_GEN_DIR, 'attempts.json');
export const ICON_DIR = join(ROOT, 'assets-src', 'charms', 'icons');
export const PROVENANCE_PATH = join(ROOT, 'assets-src', 'charms', 'provenance.json');
export const QA_PATH = join(REPORTS_AI, 'charms-qa.json');
export const SHEETS = { technical: join(ROOT, 'reports', 'qa', 'screens', 'charms-technical.png'), soft: join(ROOT, 'reports', 'qa', 'screens', 'charms-soft.png') };
export const DEFAULT_MODEL = 'gemini-3.1-flash-image';
export const CHARM_KINDS = ['technical', 'soft'];
export const SHEET_BACKGROUND = '#6C5CC8';
export const licenseFor = (model) => `AI-generated with Google Gemini (${model}); shipped as game art under D-29, owner sign-off OD-19`;

const rel = (p) => relative(ROOT, p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The catalog data between the SOUL_CATALOG_JSON markers (strict JSON, so no JS evaluation is needed). */
export function readCatalog(path = CATALOG_PATH) {
  const m = readFileSync(path, 'utf8').match(/BEGIN SOUL_CATALOG_JSON\s*\nconst DATA = ([\s\S]*?);\s*\n\/\/ END SOUL_CATALOG_JSON/);
  if (!m) throw new Error(`no SOUL_CATALOG_JSON block in ${path}`);
  return JSON.parse(m[1]);
}

export function loadPrompts(path = PROMPTS_PATH) {
  const p = readJson(path);
  for (const k of ['type', 'subject', 'environment', 'technical', 'constraints']) if (!p.style?.[k]) throw new Error(`charms.json style.${k} is missing`);
  if (!/^#[0-9A-F]{6}$/i.test(p.key?.hex || '') || p.key.rgb?.length !== 3) throw new Error('charms.json key needs hex (#RRGGBB) and rgb');
  return p;
}

/** The 100 technical + soft charms in catalog order (the 50 core stars are drawn by Blender). */
export function charmItems(catalog, prompts = null) {
  const items = catalog.charms.filter((c) => CHARM_KINDS.includes(c.kind));
  const named = prompts ? [...Object.keys(prompts.overrides || {}), ...(prompts.pilot || []), ...['ship', 'reject', 'review'].flatMap((k) => Object.keys(prompts[k] || {}))] : [];
  for (const id of named) if (!items.some((c) => c.id === id)) throw new Error(`charms.json names ${id}, which is not a technical or soft charm`);
  return items;
}

const keyFill = (text, prompts) => text.replaceAll('{keyHex}', prompts.key.hex).replaceAll('{key}', prompts.key.name);

/** Full prompt for one charm: the 5-part family style with the charm's look, plus its override detail. */
export function charmPrompt(item, prompts) {
  const s = prompts.style;
  const o = prompts.overrides?.[item.id] || {};
  const fill = (t) => keyFill(t.replaceAll('{look}', o.look || item.look), prompts);
  return composePrompt({
    type: fill(s.type),
    subject: fill(s.subject) + (o.detail ? ` ${o.detail.trim()}` : ''),
    environment: fill(s.environment),
    technical: fill(s.technical),
    constraints: fill(s.constraints),
  });
}

export function readBook(path = ATTEMPTS_PATH) {
  if (existsSync(path)) return readJson(path);
  return { version: 1, tool: 'tools/ai/gemini-charms.js', note: 'Every Gemini attempt (raw PNGs are git-ignored; sha256 kept here) with its QA result. The shipped attempt per charm is in assets-src/charms/provenance.json.', requests: 0, runs: [], attempts: [] };
}

/** Style references (charms.json references.use: [{id, attempt}]): earlier raw images sent as inlineData parts. */
export function loadReferences(prompts, book, { allowMissing = false } = {}) {
  return (prompts.references?.use || []).map(({ id, attempt }) => {
    const a = book.attempts.find((x) => x.id === id && x.attempt === attempt && x.file);
    const path = a && join(ROOT, a.file);
    if (!a || !existsSync(path)) {
      if (allowMissing) return { id, attempt, file: a?.file || null, sha256: a?.rawSha256 || null, mimeType: a?.mimeType || 'image/png', data: null };
      throw new Error(`style reference ${id} attempt ${attempt} has no raw image (see ${rel(ATTEMPTS_PATH)})`);
    }
    const bytes = readFileSync(path);
    return { id, attempt, file: a.file, sha256: sha256Hex(bytes), mimeType: a.mimeType || 'image/png', data: bytes.toString('base64') };
  });
}

/** One generateContent request per charm (pure; used by --dry-run and the tests). */
export function planRequests({ items, prompts, model, temperature = null, refs = [] }) {
  const intro = refs.length ? keyFill(prompts.references.intro, prompts) : null;
  return items.map((item) => {
    const text = charmPrompt(item, prompts);
    const temp = temperature ?? prompts.overrides?.[item.id]?.temperature ?? prompts.defaults?.temperature ?? 0.7;
    const body = buildGenerateRequest({ prompt: text, temperature: temp, aspectRatio: '1:1' });
    Object.assign(body.generationConfig.imageConfig, prompts.imageConfig || {});
    if (refs.length) body.contents[0].parts.unshift({ text: intro }, ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })));
    const prompt = refs.length ? `${intro}\n[${refs.length} reference image(s): ${refs.map((r) => `${r.id} attempt ${r.attempt}`).join(', ')}]\n${text}` : text;
    return { id: item.id, kind: item.kind, model, temperature: temp, prompt, references: refs.map(({ id, attempt, file, sha256 }) => ({ id, attempt, file, sha256 })), url: geminiUrl(model), body };
  });
}

/** Attempt shipped for a charm: the pinned one (charms.json ship), else the latest passing, non-rejected run/pilot one. */
export function shipCandidate(id, book, prompts) {
  const tries = book.attempts.filter((a) => a.id === id && a.file);
  const pin = prompts.ship?.[id];
  if (pin) return tries.find((a) => a.attempt === pin) || null;
  const rejected = new Set(prompts.reject?.[id] || []);
  const ok = tries.filter((a) => !rejected.has(a.attempt) && ['run', 'pilot'].includes(a.phase));
  return [...ok].reverse().find((a) => a.qa?.pass) || ok[ok.length - 1] || null;
}

/** Visual-review note when the shipped attempt is flagged in charms.json review ({id: {attempt, note}}), else null. */
export function reviewNote(id, attempt, prompts) {
  const r = prompts.review?.[id];
  return r && r.attempt === attempt ? r.note : null;
}

/**
 * Which charms a run generates: no passing icon yet, or the shipped attempt is flagged for visual review.
 * Exploratory phases (pilot, compare) skip nothing and have no attempt cap.
 */
export function selectItems({ items, prompts, book, only = null, kind = null, pilot = false, regen = false, phase = 'run', maxAttempts = 3 }) {
  let sel = items;
  if (pilot) sel = sel.filter((c) => prompts.pilot.includes(c.id));
  if (kind) {
    if (!CHARM_KINDS.includes(kind)) throw new Error(`--kind must be ${CHARM_KINDS.join(' or ')}`);
    sel = sel.filter((c) => c.kind === kind);
  }
  if (only) {
    const ids = [].concat(only).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
    for (const id of ids) if (!items.some((c) => c.id === id)) throw new Error(`no technical or soft charm ${id}; use --list`);
    sel = sel.filter((c) => ids.includes(c.id));
  }
  if (phase !== 'run') return { chosen: sel, skipped: [] };
  const chosen = [], skipped = [];
  for (const c of sel) {
    const used = book.attempts.filter((a) => a.id === c.id && a.file && a.phase === 'run').length;
    const cand = shipCandidate(c.id, book, prompts);
    if (!regen && cand?.qa?.pass && !reviewNote(c.id, cand.attempt, prompts)) skipped.push({ id: c.id, why: `attempt ${cand.attempt} passes (use --regen for a new one)` });
    else if (used >= maxAttempts) skipped.push({ id: c.id, why: `${used} attempts used (cap ${maxAttempts})` });
    else chosen.push(c);
  }
  return { chosen, skipped };
}

/** postJson with backoff on 429, 5xx and network errors; other 4xx fail at once (prompt, model or key problems). */
export async function postWithRetry(url, opts, { retries = 4, baseMs = 4000, onSend = () => {}, onRetry = () => {}, wait = sleep } = {}) {
  for (let i = 0; ; i++) {
    onSend();
    try { return await postJson(url, opts); } catch (e) {
      const status = Number(/^HTTP (\d{3}) /.exec(e.message)?.[1] || 0);
      if (!(status === 429 || status >= 500 || status === 0) || i >= retries) throw e;
      const ms = Math.round(baseMs * 2 ** i * (0.8 + 0.4 * Math.random()));
      onRetry(status ? `HTTP ${status}` : e.name === 'TimeoutError' ? 'timeout' : 'network error', ms);
      await wait(ms);
    }
  }
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

async function generateOne(step, { key, book, run, phase, budget }) {
  const attempt = book.attempts.filter((a) => a.id === step.id).length + 1;
  const rec = { id: step.id, kind: step.kind, attempt, phase, model: step.model, temperature: step.temperature, prompt: step.prompt, references: step.references, requests: 0 };
  book.attempts.push(rec); // reserves the attempt number before the request goes out
  const t0 = Date.now();
  log(`-> ${step.id} attempt ${attempt} (${step.model}, t=${step.temperature}${step.references.length ? `, ${step.references.length} refs` : ''})`);
  try {
    const res = await postWithRetry(step.url, { headers: geminiHeaders(key), body: step.body, timeoutMs: 180000 }, {
      onSend: () => {
        if (book.requests >= budget) throw new Error(`request budget ${budget} reached (charms.json budget / --budget)`);
        rec.requests++; run.requests++; book.requests++;
      },
      onRetry: (why, ms) => log(`   ${step.id}: ${why}, retrying in ${(ms / 1000).toFixed(1)} s`),
    });
    const parts = extractModelParts(res);
    const images = extractImages(parts);
    if (!images.length) throw new Error(`no image in the response (${extractText(parts).slice(0, 200) || res?.candidates?.[0]?.finishReason || 'no text either'})`);
    const img = images[0];
    const file = storeRaw(img, join(ensureDir(RAW_DIR), `${step.id}-a${attempt}.png`));
    Object.assign(rec, { file: rel(file), mimeType: img.mimeType, rawSha256: sha256Hex(img.bytes), bytes: img.bytes.length, fileSha256: sha256Hex(readFileSync(file)),
      modelText: extractText(parts).slice(0, 500) || null, usage: res.usageMetadata || null });
    log(`   saved ${rel(file)} (${img.mimeType}, ${img.bytes.length.toLocaleString()} bytes, ${Date.now() - t0} ms)`);
  } catch (e) {
    rec.error = redact(e.message).slice(0, 500);
    warn(`FAILED ${step.id} attempt ${attempt}: ${rec.error}`);
  }
  rec.createdAt = new Date().toISOString();
  rec.elapsedMs = Date.now() - t0;
  return rec;
}

async function generate(steps, { key, book, phase, concurrency, budget }) {
  const run = { startedAt: new Date().toISOString(), phase, model: steps[0].model, planned: steps.length, requests: 0, ok: 0, failed: 0 };
  book.runs.push(run);
  let streak = 0;
  await pool(steps, concurrency, async (step) => {
    if (run.stopped) return;
    const rec = await generateOne(step, { key, book, run, phase, budget });
    if (rec.file) { run.ok++; streak = 0; } else if (++streak >= 5 || /budget/.test(rec.error)) run.stopped = /budget/.test(rec.error) ? rec.error : '5 charms in a row failed; check the key, model id and quota';
    writeJson(ATTEMPTS_PATH, book);
  });
  run.failed = run.planned - run.ok;
  run.finishedAt = new Date().toISOString();
  writeJson(ATTEMPTS_PATH, book);
  if (run.stopped) warn(`Stopped early: ${run.stopped}.`);
  return run;
}

/**
 * Raw images are kept as PNG (git-ignored under assets-src/generated). The image models return JPEG, so those bytes are
 * re-encoded losslessly (the decoded pixels the cutter reads); rawSha256 stays the hash of the bytes the API returned.
 */
export function storeRaw(img, file) {
  if (img.mimeType === 'image/png') { writeFileSync(file, img.bytes); return file; }
  const r = spawnSync('python3', [CUTOUT_PY, 'topng', file], { input: img.bytes, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '' } });
  if (r.status !== 0) throw new Error(`could not store the ${img.mimeType} image as PNG: ${String(r.stderr).slice(-400)}`);
  return file;
}

function runPy(cmd, job) {
  const r = spawnSync('python3', [CUTOUT_PY, cmd], { input: JSON.stringify(job), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '' } });
  if (r.status !== 0) throw new Error(`charm_cutout.py ${cmd} failed: ${redact((r.stderr || r.error?.message || '').slice(-1200))}`);
  return JSON.parse(r.stdout);
}

const failedChecks = (qa) => (qa ? Object.entries(qa.checks).filter(([, v]) => !v).map(([k]) => k) : ['missing']);

/** Cut out + QA every attempt not yet checked with the current cutter, ship one attempt per charm, write the reports. */
export function processAll({ book, prompts, items, catalog }) {
  const cutKey = sha256Hex(Buffer.concat([readFileSync(CUTOUT_PY), Buffer.from(JSON.stringify([prompts.key.rgb, prompts.cutout]))])).slice(0, 16);
  const todo = book.attempts.filter((a) => a.file && existsSync(join(ROOT, a.file)) && a.qa?.cutKey !== cutKey);
  const res = runPy('cutout', { key: prompts.key.rgb, size: prompts.cutout.size, pad: prompts.cutout.pad,
    items: todo.map((a) => ({ id: `${a.id}#${a.attempt}`, raw: join(ROOT, a.file), out: join(CUT_DIR, `${a.id}-a${a.attempt}.png`) })) });
  res.items.forEach((r, i) => {
    const cut = r.out && existsSync(r.out) ? r.out : null;
    todo[i].qa = { cutKey, pass: r.pass, checks: r.checks, metrics: r.metrics, cut: cut && rel(cut), sha256: cut && sha256Hex(readFileSync(cut)) };
  });
  if (todo.length) { writeJson(ATTEMPTS_PATH, book); log(`Cut out and checked ${todo.length} attempt(s).`); }

  const rows = items.map((item) => {
    const a = shipCandidate(item.id, book, prompts);
    const icon = join(ICON_DIR, `${item.id}.png`);
    if (a?.qa?.cut) copyFileSync(join(ROOT, a.qa.cut), join(ensureDir(ICON_DIR), `${item.id}.png`));
    return { item, a: a?.qa?.cut ? a : null, icon };
  });
  const passOf = (r) => !!r.a?.qa.pass;
  const noteOf = (r) => (r.a ? reviewNote(r.item.id, r.a.attempt, prompts) : null);
  const tally = (list) => ({ charms: list.length, pass: list.filter(passOf).length, fail: list.filter((r) => r.a && !passOf(r)).length, missing: list.filter((r) => !r.a).length, flagged: list.filter(noteOf).length });
  const models = [...new Set(rows.filter((r) => r.a).map((r) => r.a.model))];
  const withImage = book.attempts.filter((a) => a.file);

  writeJson(QA_PATH, {
    version: 1, tool: 'tools/ai/gemini-charms.js', createdAt: new Date().toISOString(), catalogVersion: catalog.version,
    key: prompts.key.hex, cutout: prompts.cutout, thresholds: res.qa, cutter: res.cut,
    summary: { ...tally(rows), byKind: Object.fromEntries(CHARM_KINDS.map((k) => [k, tally(rows.filter((r) => r.item.kind === k))])), models, requests: book.requests, attemptsWithImage: withImage.length, failedRequests: book.attempts.filter((a) => a.error).length },
    items: rows.map((r) => ({ ...r, note: noteOf(r) })).map(({ item, a, icon, note }) => (a ? { id: item.id, kind: item.kind, attempt: a.attempt, phase: a.phase, model: a.model, raw: a.file, icon: rel(icon), pass: a.qa.pass, failed: failedChecks(a.qa), ...(note ? { review: note } : {}), checks: a.qa.checks, metrics: a.qa.metrics }
      : { id: item.id, kind: item.kind, pass: false, failed: ['missing'] })),
    attempts: book.attempts.map((a) => ({ id: a.id, attempt: a.attempt, phase: a.phase, model: a.model, pass: a.qa ? a.qa.pass : false, failed: a.qa ? failedChecks(a.qa) : undefined, error: a.error })),
  });

  for (const kind of CHARM_KINDS) {
    const list = rows.filter((r) => r.item.kind === kind);
    const t = tally(list);
    runPy('sheet', { out: SHEETS[kind], columns: 10, background: SHEET_BACKGROUND, title: `Charm icons: ${kind} (${list.length})`,
      subtitle: `QA pass ${t.pass}/${t.charms}${t.missing ? `, missing ${t.missing}` : ''}${t.flagged ? `, ${t.flagged} flagged for regeneration (amber)` : ''} - ${models.join(', ') || 'no model yet'} - 128 px and 48 px - ${new Date().toISOString().slice(0, 10)}`,
      items: list.map((r) => ({ id: r.item.id, icon: r.a ? r.icon : null, pass: passOf(r), failed: r.a ? failedChecks(r.a.qa) : ['missing'], review: noteOf(r) })) });
  }

  writeJson(PROVENANCE_PATH, {
    version: 1, tool: 'tools/ai/gemini-charms.js', decision: 'D-29 (docs/art/soul-decorations.md), owner sign-off OD-19', catalogVersion: catalog.version,
    format: { size: prompts.cutout.size, pad: prompts.cutout.pad, pixel: 'RGBA 8-bit, non-interlaced PNG; transparent pixels stored white', key: prompts.key.hex,
      raw: 'rawSha256 hashes the bytes the API returned (rawMimeType); the git-ignored raw file is a lossless PNG of those pixels' },
    entries: rows.filter((r) => r.a).map(({ item, a, icon }) => ({
      id: item.id, kind: item.kind, file: rel(icon), model: a.model, prompt: a.prompt, temperature: a.temperature, attempt: a.attempt, references: a.references,
      raw: a.file, rawMimeType: a.mimeType, rawSha256: a.rawSha256, sha256: a.qa.sha256, createdAt: a.createdAt, shipped: a.qa.pass, license: licenseFor(a.model),
    })),
  });
  return { rows, tally: tally(rows) };
}

function dehydrateBody(body, refs) {
  let i = 0;
  return { ...body, contents: body.contents.map((c) => ({ ...c, parts: c.parts.map((p) => {
    if (!p.inlineData) return p;
    const r = refs[i++];
    return { inlineData: { mimeType: p.inlineData.mimeType, data: `<${r.file || 'missing locally'}, sha256 ${(r.sha256 || '?').slice(0, 12)}, base64 omitted>` } };
  }) })) };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { booleans: ['dry-run', 'list', 'help', 'pilot', 'regen', 'process'] });
  if (args.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n')); return 0; }
  const env = loadEnv();
  const prompts = loadPrompts();
  const catalog = readCatalog();
  const items = charmItems(catalog, prompts);
  const book = readBook();
  if (args.list) {
    for (const c of items) {
      const a = shipCandidate(c.id, book, prompts);
      const n = book.attempts.filter((x) => x.id === c.id && x.file).length;
      const state = a?.qa ? (a.qa.pass ? `a${a.attempt} pass${reviewNote(c.id, a.attempt, prompts) ? ' REVIEW' : ''}` : `a${a.attempt} FAIL ${failedChecks(a.qa).join(',')}`) : '-';
      log(`${c.id.padEnd(22)} ${c.kind.padEnd(9)} ${String(n).padStart(2)} att  ${state.padEnd(15)} ${c.look}${prompts.overrides?.[c.id] ? ' (+override)' : ''}`);
    }
    return 0;
  }
  if (args.process) {
    const { tally } = processAll({ book, prompts, items, catalog });
    log(`QA pass ${tally.pass}/${tally.charms} (fail ${tally.fail}, missing ${tally.missing}, flagged for regeneration ${tally.flagged}). ${rel(QA_PATH)}, ${rel(SHEETS.technical)}, ${rel(SHEETS.soft)}, ${rel(PROVENANCE_PATH)}`);
    return 0;
  }

  const model = args.model || process.env.GEMINI_IMAGE_MODEL || prompts.model || DEFAULT_MODEL;
  const dryRun = !!args['dry-run'];
  const phase = args.pilot ? 'pilot' : typeof args.phase === 'string' ? args.phase : 'run';
  const maxAttempts = Number(args['max-attempts'] ?? prompts.maxAttempts ?? 3);
  const { chosen, skipped } = selectItems({ items, prompts, book, only: args.only || null, kind: args.kind || null, pilot: !!args.pilot, regen: !!args.regen, phase, maxAttempts });
  const refs = Number(args.refs ?? 1) === 0 ? [] : loadReferences(prompts, book, { allowMissing: dryRun });
  const temperature = args.temperature !== undefined ? Number(args.temperature) : null;
  const steps = planRequests({ items: chosen, prompts, model, temperature, refs });
  for (const s of skipped) log(`skip ${s.id}: ${s.why}`);

  if (dryRun) {
    const scope = args.pilot ? 'pilot' : args.only ? 'only' : args.kind || 'all';
    const record = { tool: 'gemini-charms', name: scope, dryRun: true, createdAt: new Date().toISOString(), model, phase, count: steps.length,
      requests: steps.map((s) => {
        const r = shapeDryRun({ tool: 'gemini-charms', name: s.id, url: s.url, headers: geminiHeaders('<GEMINI_API_KEY>'), body: dehydrateBody(s.body, s.references),
          outputs: [rel(join(RAW_DIR, `${s.id}-a<n>.png`)), rel(join(ICON_DIR, `${s.id}.png`)), rel(PROVENANCE_PATH)], notes: [`temperature ${s.temperature}`, `phase ${phase}`, licenseFor(model)] });
        return { id: s.id, ...r.request, outputs: r.outputs, notes: r.notes };
      }) };
    let written;
    if (typeof args['dry-run-dir'] === 'string') {
      written = join(ensureDir(args['dry-run-dir']), `gemini-charms-${scope}-${nowStamp()}.json`);
      writeFileSync(written, redact(JSON.stringify(record, null, 2)) + '\n');
    } else written = writeDryRun(record);
    log(`DRY RUN - nothing is sent. ${steps.length} request(s) to ${geminiUrl(model)}${refs.length ? ` with ${refs.length} style reference image(s)` : ''}`);
    steps.forEach((s, i) => log(i < 6 ? `\n### ${s.id}\n${s.prompt}` : `### ${s.id}: ${s.prompt.split('\n')[1]}`));
    log(`\nRequest shapes (key header redacted): ${written}`);
    log(`Key status: GEMINI_API_KEY ${env.GEMINI_API_KEY ? 'present' : 'EMPTY (fill .env before a real run)'}`);
    return 0;
  }
  if (!steps.length) {
    log('Nothing to generate.');
    const { tally } = processAll({ book, prompts, items, catalog });
    log(`QA pass ${tally.pass}/${tally.charms} (fail ${tally.fail}, missing ${tally.missing}).`);
    return 0;
  }

  const key = requireKey(env, 'GEMINI_API_KEY');
  const budget = Number(args.budget ?? prompts.budget ?? 260);
  log(`${steps.length} charm(s), model ${model}, phase ${phase}, concurrency ${Number(args.concurrency || 3)}, requests so far ${book.requests}/${budget}`);
  const run = await generate(steps, { key, book, phase, concurrency: Math.max(1, Number(args.concurrency || 3)), budget });
  const { tally, rows } = processAll({ book, prompts, items, catalog });
  const ran = new Set(steps.map((s) => s.id));
  for (const r of rows.filter((x) => ran.has(x.item.id))) log(`${r.item.id.padEnd(22)} ${r.a ? `attempt ${r.a.attempt} ${r.a.qa.pass ? 'pass' : `FAIL ${failedChecks(r.a.qa).join(', ')}`}` : 'no image'}`);
  log(`Run: ${run.ok}/${run.planned} images, ${run.requests} request(s) (total ${book.requests}). QA pass ${tally.pass}/${tally.charms} (fail ${tally.fail}, missing ${tally.missing}).`);
  log(`Sheets: ${rel(SHEETS.technical)}, ${rel(SHEETS.soft)}. QA: ${rel(QA_PATH)}. Provenance: ${rel(PROVENANCE_PATH)}.`);
  return run.ok === run.planned ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code)).catch((e) => { warn(`error: ${redact(e.message)}`); process.exit(1); });
}

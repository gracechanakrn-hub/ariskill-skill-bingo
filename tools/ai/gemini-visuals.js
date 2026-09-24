#!/usr/bin/env node
// tools/ai/gemini-visuals.js - "use Gemini for visual": art-direction reference plates from tools/ai/prompts/visuals.json.
// Outputs: assets-src/generated/<batch-id>/<name>.png + provenance.json (model, prompt, temperature, sha256, createdAt,
// license note). Reference material only - never shipped at runtime (docs/ai-tooling.md).
//
//   node tools/ai/gemini-visuals.js --dry-run                      print every request, write reports/ai/dry-run/*.json
//   node tools/ai/gemini-visuals.js --only soul-family-sheet        one plate
//   node tools/ai/gemini-visuals.js --model gemini-3-pro-image-preview
//   node tools/ai/gemini-visuals.js --batch <id> --only <name> --refine "make the orbs warmer"   multi-turn edit of an existing plate
//   options: --batch <id> (default: timestamp)  --temperature <n>  --list
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, requireKey, redact } from './env.js';
import { GENERATED_DIR, LICENSE_NOTE, PROVENANCE_VERSION, ensureDir, log, warn, nowStamp, parseArgs, postJson, provenanceEntry, readJson, shapeDryRun, writeDryRun, writeJson } from './lib/common.js';
import { buildGenerateRequest, buildRefineRequest, composePrompt, dehydrateParts, extractImages, extractModelParts, extractText, geminiHeaders, geminiUrl, rehydrateParts } from './lib/gemini.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOG_PATH = join(HERE, 'prompts', 'visuals.json');

/** Full prompt text for a catalog plate: 5 parts + the shared style anchor / sky / hard-no lines. */
export function platePrompt(plate, shared) {
  const parts = { ...plate.parts };
  parts.technical = `${parts.technical}\nStyle anchor: ${shared.styleAnchor}\nSky: ${shared.sky}`;
  parts.constraints = `${parts.constraints}\n${shared.hardNo}`;
  return composePrompt(parts);
}

export function loadCatalog(path = CATALOG_PATH) {
  const cat = readJson(path);
  const names = new Set();
  for (const p of cat.plates) {
    if (names.has(p.name)) throw new Error(`duplicate plate name ${p.name}`);
    names.add(p.name);
    platePrompt(p, cat.shared); // throws on a missing part
  }
  return cat;
}

/** Plan of requests for a run (pure; used by --dry-run and by the tests). */
export function planRun({ catalog, only = null, model, temperature = null, refine = null, batch }) {
  const plates = catalog.plates.filter((p) => !only || [].concat(only).includes(p.name));
  if (only && !plates.length) throw new Error(`no plate named ${only}; use --list`);
  if (refine && plates.length !== 1) throw new Error('--refine needs exactly one --only <name>');
  return plates.map((plate) => {
    const prompt = platePrompt(plate, catalog.shared);
    const temp = temperature ?? plate.temperature ?? 0.8;
    const base = { name: plate.name, model, prompt, temperature: temp, aspectRatio: plate.aspectRatio, url: geminiUrl(model), outDir: join(GENERATED_DIR, batch) };
    if (!refine) return { ...base, kind: 'generate', body: buildGenerateRequest({ prompt, temperature: temp, aspectRatio: plate.aspectRatio }), file: `${plate.name}.png` };
    return { ...base, kind: 'refine', instruction: refine, keep: plate.keep || [], file: null, body: null };
  });
}

function provenancePath(dir) { return join(dir, 'provenance.json'); }
function readProvenance(dir) { const p = provenancePath(dir); return existsSync(p) ? readJson(p) : { version: PROVENANCE_VERSION, tool: 'tools/ai/gemini-visuals.js', license: LICENSE_NOTE, entries: [] }; }

function nextRefineName(entries, name) {
  const n = entries.filter((e) => e.name === name && e.kind === 'refine').length + 1;
  return `${name}-r${n}.png`;
}

async function runGenerate(step, key, dir, prov) {
  log(`-> ${step.name} (${step.model}, ${step.aspectRatio}, t=${step.temperature})`);
  const t0 = Date.now();
  const res = await postJson(step.url, { headers: geminiHeaders(key), body: step.body, timeoutMs: 180000 });
  const parts = extractModelParts(res);
  const images = extractImages(parts);
  if (!images.length) throw new Error(`${step.name}: no image in the response (${extractText(parts).slice(0, 200) || 'no text either'})`);
  ensureDir(dir);
  const file = join(dir, step.file);
  writeFileSync(file, images[0].bytes);
  const entry = provenanceEntry({ file: step.file, model: step.model, prompt: step.prompt, temperature: step.temperature, bytes: images[0].bytes, extra: {
    name: step.name, kind: 'generate', aspectRatio: step.aspectRatio, mimeType: images[0].mimeType, modelText: extractText(parts).slice(0, 2000) || null,
    modelParts: dehydrateParts(parts, [step.file, ...images.slice(1).map((_, i) => `${step.name}-extra${i + 1}.png`)]), elapsedMs: Date.now() - t0,
  } });
  images.slice(1).forEach((img, i) => writeFileSync(join(dir, `${step.name}-extra${i + 1}.png`), img.bytes));
  prov.entries.push(entry);
  writeJson(provenancePath(dir), prov);
  log(`   saved ${step.file} (${images[0].bytes.length.toLocaleString()} bytes, sha256 ${entry.sha256.slice(0, 12)}..., ${entry.elapsedMs} ms)`);
}

async function runRefine(step, key, dir, prov, dryRun) {
  const source = [...prov.entries].reverse().find((e) => e.name === step.name);
  if (!source) throw new Error(`${step.name}: nothing to refine in ${dir} (run a generate first)`);
  const modelParts = dryRun ? source.modelParts : rehydrateParts(source.modelParts, dir);
  const body = buildRefineRequest({ originalPrompt: source.prompt, modelParts, instruction: step.instruction, keep: step.keep, temperature: step.temperature, aspectRatio: step.aspectRatio });
  const file = nextRefineName(prov.entries, step.name);
  if (dryRun) return { body, file };
  log(`-> refine ${step.name} -> ${file}: "${step.instruction}"`);
  const t0 = Date.now();
  const res = await postJson(step.url, { headers: geminiHeaders(key), body, timeoutMs: 180000 });
  const parts = extractModelParts(res);
  const images = extractImages(parts);
  if (!images.length) throw new Error(`${step.name}: refine returned no image (${extractText(parts).slice(0, 200)})`);
  writeFileSync(join(dir, file), images[0].bytes);
  const entry = provenanceEntry({ file, model: step.model, prompt: body.contents[body.contents.length - 1].parts[0].text, temperature: step.temperature, bytes: images[0].bytes, extra: {
    name: step.name, kind: 'refine', refinedFrom: source.file, instruction: step.instruction, aspectRatio: step.aspectRatio, mimeType: images[0].mimeType,
    modelText: extractText(parts).slice(0, 2000) || null, modelParts: dehydrateParts(parts, [file]), elapsedMs: Date.now() - t0,
  } });
  prov.entries.push(entry);
  writeJson(provenancePath(dir), prov);
  log(`   saved ${file} (${images[0].bytes.length.toLocaleString()} bytes, ${entry.elapsedMs} ms)`);
  return { body, file };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { booleans: ['dry-run', 'list', 'help'] });
  if (args.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n')); return 0; }
  const env = loadEnv();
  const catalog = loadCatalog();
  if (args.list) { for (const p of catalog.plates) log(`${p.name.padEnd(24)} ${p.aspectRatio.padEnd(5)} ${p.purpose}`); return 0; }
  const model = args.model || env.GEMINI_IMAGE_MODEL;
  const dryRun = !!args['dry-run'];
  const batch = args.batch || nowStamp();
  const refine = typeof args.refine === 'string' ? args.refine : null;
  const steps = planRun({ catalog, only: args.only || null, model, temperature: args.temperature !== undefined ? Number(args.temperature) : null, refine, batch });
  const dir = join(GENERATED_DIR, batch);
  const prov = readProvenance(dir);

  if (dryRun) {
    log(`DRY RUN - nothing is sent. Batch ${batch}; ${steps.length} request(s) to ${geminiUrl(model)}`);
    for (const step of steps) {
      let body = step.body, file = step.file;
      if (step.kind === 'refine') {
        if (!prov.entries.some((e) => e.name === step.name)) { warn(`${step.name}: no earlier plate in ${dir}; the refine request is shaped against an empty history`); step.instruction = refine; }
        const r = prov.entries.some((e) => e.name === step.name) ? await runRefine(step, null, dir, prov, true)
          : { body: buildRefineRequest({ originalPrompt: step.prompt, modelParts: [{ text: '<model parts from the earlier generate turn>' }], instruction: refine, keep: step.keep, temperature: step.temperature, aspectRatio: step.aspectRatio }), file: `${step.name}-r1.png` };
        body = r.body; file = r.file;
      }
      const record = shapeDryRun({ tool: 'gemini-visuals', name: step.name, url: step.url, headers: geminiHeaders('<GEMINI_API_KEY>'), body,
        outputs: [join(dir, file), provenancePath(dir)], notes: [`aspect ${step.aspectRatio}`, `temperature ${step.temperature}`, `kind ${step.kind}`, LICENSE_NOTE] });
      const written = writeDryRun(record);
      log(`\n### ${step.name} [${step.kind}] -> ${written}`);
      log(body.contents[body.contents.length - 1].parts[0].text);
    }
    log(`\nKey status: GEMINI_API_KEY ${env.GEMINI_API_KEY ? 'present' : 'EMPTY (fill .env before a real run)'}`);
    return 0;
  }

  const key = requireKey(env, 'GEMINI_API_KEY');
  log(`Batch ${batch} -> ${dir} (${steps.length} plate(s), model ${model})`);
  let failures = 0;
  for (const step of steps) {
    try {
      if (step.kind === 'refine') await runRefine(step, key, dir, prov, false);
      else await runGenerate(step, key, dir, prov);
    } catch (e) { failures++; warn(`FAILED ${step.name}: ${redact(e.message)}`); }
  }
  log(`Done: ${steps.length - failures}/${steps.length} ok. Provenance: ${provenancePath(dir)}. ${LICENSE_NOTE}.`);
  return failures ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code)).catch((e) => { warn(`error: ${redact(e.message)}`); process.exit(1); });
}

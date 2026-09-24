// tools/assets/test/audio.test.js - validates the generated audio set, its manifest and the AudioManager.
// Run: node --test tools/assets/test/audio.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANIFEST_JSON = path.join(ROOT, 'assets/manifest/audio.json');
const MANIFEST_YAML = path.join(ROOT, 'assets/manifest/audio.yaml');
const COPY_JSON = path.join(ROOT, 'packages/contracts/copy.json');
const AUDIO_JS = path.join(ROOT, 'packages/ui/audio.js');
const CUES_SRC = path.join(ROOT, 'assets-src/audio/cues.json');

const EXPECTED_IDS = ['ambient_galaxy', 'registration_ready', 'draw_leadin', 'draw_reveal', 'cell_match', 'draw5_unlock', 'bingo', 'soul_reveal', 'float_countdown', 'float_launch', 'error_soft', 'reconnect'];
const MAX_DURATION = { registration_ready: 0.6, draw_leadin: 0.4, draw_reveal: 0.8, cell_match: 0.15, draw5_unlock: 1.0, bingo: 1.5, soul_reveal: 2.0, float_countdown: 0.2, float_launch: 1.2, error_soft: 0.4, reconnect: 0.5 };

const manifest = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
const copy = JSON.parse(readFileSync(COPY_JSON, 'utf8'));
const byId = Object.fromEntries(manifest.cues.map((c) => [c.id, c]));

// ---- tiny WAV reader ------------------------------------------------------------------------
function readWav(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', `${file}: RIFF`);
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE', `${file}: WAVE`);
  assert.equal(buf.readUInt32LE(4), buf.length - 8, `${file}: RIFF size`);
  let off = 12; let fmt = null; let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4); const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  assert.ok(fmt && data, `${file}: fmt and data chunks`);
  const n = data.length / 2; const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { fmt, samples, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}
const dbfs = (x) => (x <= 0 ? -120 : 20 * Math.log10(x));
function stats(samples) {
  let peak = 0; let sum = 0;
  for (const s of samples) { const a = Math.abs(s); if (a > peak) peak = a; sum += s * s; }
  return { peak_dbfs: dbfs(peak), rms_dbfs: dbfs(Math.sqrt(sum / samples.length)) };
}

// ---- manifest + files ------------------------------------------------------------------------
describe('audio manifest', () => {
  test('lists exactly the twelve required cues with provenance fields', () => {
    assert.deepEqual(manifest.cues.map((c) => c.id).sort(), [...EXPECTED_IDS].sort());
    assert.equal(manifest.license, 'internal-original');
    assert.equal(manifest.generator_script, 'tools/assets/build-audio.py');
    for (const c of manifest.cues) {
      assert.equal(c.license, 'internal-original', c.id);
      assert.equal(c.generator_script, 'tools/assets/build-audio.py', c.id);
      assert.equal(c.approved_by, null, c.id);
      assert.match(c.checksum, /^sha256:[0-9a-f]{64}$/, c.id);
      for (const k of ['source_file', 'source_format', 'runtime_file', 'runtime_format', 'version', 'duration_s', 'sample_rate', 'channels', 'bytes', 'peak_dbfs', 'rms_dbfs']) assert.ok(k in c, `${c.id}.${k}`);
    }
  });
  test('audio.yaml is the canonical twin of audio.json', () => {
    const yaml = readFileSync(MANIFEST_YAML, 'utf8');
    for (const c of manifest.cues) { assert.ok(yaml.includes(`id: "${c.id}"`), c.id); assert.ok(yaml.includes(c.checksum), `${c.id} checksum in yaml`); }
    assert.ok(yaml.includes(`bytes: ${manifest.totals.bytes}`));
  });
  test('every runtime file exists, matches its checksum and is 22050 Hz / 16-bit / mono PCM', () => {
    for (const c of manifest.cues) {
      const file = path.join(ROOT, c.runtime_file);
      assert.ok(existsSync(file), `${c.runtime_file} missing`);
      const w = readWav(file);
      assert.equal(`sha256:${w.sha256}`, c.checksum, `${c.id} checksum`);
      assert.equal(w.bytes, c.bytes, `${c.id} bytes`);
      assert.equal(statSync(file).size, c.bytes);
      assert.equal(w.fmt.format, 1, `${c.id} PCM`); assert.equal(w.fmt.channels, 1); assert.equal(w.fmt.sampleRate, 22050); assert.equal(w.fmt.bits, 16);
      assert.equal(c.sample_rate, 22050); assert.equal(c.channels, 1);
      assert.ok(Math.abs(w.samples.length / 22050 - c.duration_s) < 1e-3, `${c.id} duration`);
    }
  });
  test('budgets: total <= 1.6 MB, each one-shot <= 120 KB, durations within cue limits', () => {
    const total = manifest.cues.reduce((s, c) => s + c.bytes, 0);
    assert.equal(total, manifest.totals.bytes);
    assert.ok(total <= 1.6 * 1024 * 1024, `total ${total}`);
    for (const c of manifest.cues) {
      if (c.kind !== 'audio-loop') assert.ok(c.bytes <= 120 * 1024, `${c.id} ${c.bytes} bytes`);
      if (MAX_DURATION[c.id]) assert.ok(c.duration_s <= MAX_DURATION[c.id] + 1e-6, `${c.id} ${c.duration_s}s > ${MAX_DURATION[c.id]}`);
    }
    assert.ok(byId.ambient_galaxy.duration_s >= 6 && byId.ambient_galaxy.duration_s <= 8);
    assert.ok(byId.soul_reveal.duration_s >= 1.5);
  });
  test('loudness: no peak above -1 dBFS; RMS within 3 dB of target; ambient bed at -24 dBFS', () => {
    for (const c of manifest.cues) {
      const w = readWav(path.join(ROOT, c.runtime_file));
      const s = stats(w.samples);
      assert.ok(s.peak_dbfs <= -1.0 + 1e-6, `${c.id} peak ${s.peak_dbfs.toFixed(2)}`);
      assert.ok(Math.abs(s.peak_dbfs - c.peak_dbfs) < 0.05, `${c.id} manifest peak`);
      assert.ok(Math.abs(s.rms_dbfs - c.rms_dbfs) < 0.05, `${c.id} manifest rms`);
      const target = c.kind === 'audio-loop' ? -24 : c.rms_target_dbfs;
      assert.ok(Math.abs(s.rms_dbfs - target) <= manifest.budgets.rms_tolerance_db, `${c.id} rms ${s.rms_dbfs.toFixed(2)} vs ${target}`);
      if (c.kind !== 'audio-loop') assert.ok(c.rms_target_dbfs >= -20 && c.rms_target_dbfs <= -16, `${c.id} one-shot target about -16 dBFS`);
    }
    assert.ok(Math.abs(byId.ambient_galaxy.rms_dbfs + 24) < 0.5);
    assert.ok(byId.bingo.peak_dbfs <= -1.0);
  });
  test('one-shots start and end at silence (10 ms fades)', () => {
    for (const c of manifest.cues) {
      if (c.kind === 'audio-loop') continue;
      const w = readWav(path.join(ROOT, c.runtime_file));
      assert.ok(Math.abs(w.samples[0]) < 0.002, `${c.id} first sample`);
      assert.ok(Math.abs(w.samples[w.samples.length - 1]) < 0.002, `${c.id} last sample`);
      assert.equal(c.fade_ms, 10);
    }
  });
  test('ambient loop points are sample-accurate and the seam is click-free', () => {
    const c = byId.ambient_galaxy;
    assert.equal(c.kind, 'audio-loop');
    const w = readWav(path.join(ROOT, c.runtime_file));
    assert.equal(c.loop.start_sample, 0);
    assert.equal(c.loop.end_sample, w.samples.length);
    const seam = Math.abs(w.samples[0] - w.samples[w.samples.length - 1]);
    let maxStep = 0;
    for (let i = 1; i < w.samples.length; i++) maxStep = Math.max(maxStep, Math.abs(w.samples[i] - w.samples[i - 1]));
    assert.ok(seam <= maxStep * 1.25 + 1 / 32768, `seam step ${seam} vs internal max ${maxStep}`);
    assert.ok(seam <= 0.02, `seam step ${seam} above absolute threshold`);
    // slope continuity across the seam (second difference) must also look like an ordinary sample
    const slopeSeam = Math.abs((w.samples[0] - w.samples[w.samples.length - 1]) - (w.samples[w.samples.length - 1] - w.samples[w.samples.length - 2]));
    let maxSlope = 0;
    for (let i = 2; i < w.samples.length; i++) maxSlope = Math.max(maxSlope, Math.abs((w.samples[i] - w.samples[i - 1]) - (w.samples[i - 1] - w.samples[i - 2])));
    assert.ok(slopeSeam <= maxSlope * 1.25 + 1 / 32768, `seam slope ${slopeSeam} vs ${maxSlope}`);
    for (const o of manifest.cues) if (o.kind !== 'audio-loop') assert.equal(o.loop, null, `${o.id} has no loop`);
  });
  test('every cue has a caption and a visual equivalent; copy keys exist in copy.json', () => {
    for (const c of manifest.cues) {
      assert.ok(typeof c.caption === 'string' && c.caption.trim().length > 0, `${c.id} caption`);
      assert.ok(typeof c.visual_equivalent === 'string' && c.visual_equivalent.length > 10, `${c.id} visual equivalent`);
      if (c.copy_key) assert.ok(c.copy_key in copy.key, `${c.id} copy key ${c.copy_key}`);
      assert.ok(Array.isArray(c.event_types) && c.event_types.length > 0, `${c.id} event types`);
      assert.ok(Array.isArray(c.audiences) && c.audiences.length > 0, `${c.id} audiences`);
    }
    assert.equal(byId.draw5_unlock.copy_key, 'play.evaluationActive');
    assert.deepEqual(byId.bingo.duck, { db: 8, ms: 2000 });
    assert.equal(byId.cell_match.rate_limit_ms, 250);
  });
  test('event types reference the realtime contract (or documented client moments)', () => {
    const contract = JSON.parse(readFileSync(path.join(ROOT, 'contracts/realtime-events.json'), 'utf8'));
    const known = new Set(Object.keys(contract.types));
    const local = new Set(['app.start', 'client.float_countdown', 'client.exception', 'client.reconnecting', 'round.draw.next.pending']);
    for (const c of manifest.cues) for (const t of c.event_types) assert.ok(known.has(t) || local.has(t), `${c.id}: unknown event type ${t}`);
  });
  test('source recipe and manifest agree on ids', () => {
    const src = JSON.parse(readFileSync(CUES_SRC, 'utf8'));
    assert.deepEqual(Object.keys(src.cues).sort(), [...EXPECTED_IDS].sort());
    assert.equal(src.version, manifest.version);
  });
});

// ---- AudioManager -----------------------------------------------------------------------------
describe('packages/ui/audio.js', () => {
  test('imports in Node and its embedded CUES policy matches the manifest', async () => {
    const m = await import(AUDIO_JS);
    assert.equal(typeof m.createAudioManager, 'function');
    assert.equal(m.AUDIO_MANIFEST_VERSION, manifest.version);
    assert.deepEqual(Object.keys(m.CUES).sort(), [...EXPECTED_IDS].sort());
    for (const c of manifest.cues) {
      const e = m.CUES[c.id];
      assert.equal(e.file, path.basename(c.runtime_file), c.id);
      assert.equal(e.loop, c.kind === 'audio-loop', c.id);
      assert.equal(e.priority, c.priority, c.id);
      assert.equal(e.rateLimitMs, c.rate_limit_ms, c.id);
      assert.deepEqual(e.duck, c.duck, c.id);
      assert.equal(e.caption, c.caption, c.id);
      assert.equal(e.copyKey, c.copy_key, c.id);
    }
    for (const [app, list] of Object.entries(m.PRELOAD_BY_APP)) for (const id of list) assert.ok(byId[id].preload.includes(app) || byId[id].audiences.includes(app), `${app} preloads ${id}`);
    for (const id of ['draw_reveal', 'cell_match', 'bingo', 'float_launch']) assert.ok(m.PRELOAD_BY_APP.participant.includes(id));
    for (const id of ['ambient_galaxy', 'draw_reveal', 'bingo', 'float_launch']) assert.ok(m.PRELOAD_BY_APP.public.includes(id));
  });

  test('works with no AudioContext (E14): every method returns safely, captions still fire', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    assert.equal(typeof globalThis.AudioContext, 'undefined');
    const captions = [];
    const a = createAudioManager({ app: 'participant', storage: null, onCaption: (c) => captions.push(c) });
    assert.equal(await a.unlock(), false);
    const avail = await a.preload(['bingo', 'cell_match']);
    assert.equal(avail.bingo, 'unavailable'); assert.equal(avail.cell_match, 'unavailable');
    assert.equal(a.play('bingo'), false);
    assert.equal(a.play('nope'), false);
    assert.equal(a.play('ambient_galaxy'), false);
    assert.equal(a.startAmbient(), false); assert.equal(a.stopAmbient(), true);
    assert.equal(a.duck(8, 2000), false);
    assert.equal(a.setMuted(true), true); assert.equal(a.setMuted(false), false);
    assert.equal(a.setMasterVolume(0.5), 0.5); assert.equal(a.setMasterVolume('x'), 1); assert.equal(a.setMasterVolume(9), 1);
    const s = a.state();
    assert.equal(s.supported, false); assert.equal(s.unlocked, false); assert.equal(s.autoplayDenied, false);
    assert.equal(a.caption('bingo'), 'Bingo detected');
    assert.equal(a.caption('unknown'), '');
    assert.equal(captions.length, 1); assert.equal(captions[0].id, 'bingo'); assert.equal(captions[0].played, false); assert.equal(captions[0].reason, 'unsupported');
    a.dispose();
    assert.equal(a.play('bingo'), false);
  });

  test('caption() prefers the copy catalog via translate and falls back to plain text', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const translate = (key, vars) => (copy.key[key] || key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
    const a = createAudioManager({ storage: null, translate });
    assert.equal(a.caption('draw_reveal', { number: 7 }), 'Draw 7');
    assert.equal(a.caption('draw5_unlock'), 'Bingo is live');
    assert.equal(a.caption('error_soft'), 'Notice: see message');
    const b = createAudioManager({ storage: null, translate: () => { throw new Error('boom'); } });
    assert.equal(b.caption('bingo'), 'Bingo detected');
  });

  test('persists mute/volume per app in storage and tolerates a broken storage', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const a = createAudioManager({ app: 'public', storage });
    a.setMuted(true); a.setMasterVolume(0.4);
    assert.deepEqual(JSON.parse(store.get('ariskill-skill-bingo:audio:public')), { muted: true, volume: 0.4 });
    const b = createAudioManager({ app: 'public', storage });
    assert.equal(b.state().muted, true); assert.equal(b.state().volume, 0.4);
    const c = createAudioManager({ app: 'stage', storage });
    assert.equal(c.state().muted, false);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const d = createAudioManager({ app: 'admin', storage: broken, startMuted: true });
    assert.equal(d.state().muted, true); assert.equal(d.setMuted(false), false);
  });

  // ---- fake Web Audio for behavioural tests ------------------------------------------------
  function makeFakeAudio({ resumeWorks = true, decodeFails = new Set(), fetchFails = new Set() } = {}) {
    const log = [];
    class Param { constructor(v) { this.value = v; this.events = []; } cancelScheduledValues(t) { this.events.push(['cancel', t]); } setValueAtTime(v, t) { this.events.push(['set', v, t]); } linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); } }
    class Node { constructor(ctx) { this.ctx = ctx; } connect() { return this; } disconnect() {} }
    class Gain extends Node { constructor(ctx) { super(ctx); this.gain = new Param(1); } }
    class Source extends Node {
      constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; this.onended = null; this.started = null; this.stopped = null; }
      start(when) { this.started = when; log.push(['start', this.buffer && this.buffer.id, when]); }
      stop(when) { this.stopped = when ?? this.ctx.currentTime; log.push(['stop', this.buffer && this.buffer.id]); if (this.onended) this.onended(); }
    }
    class FakeAudioContext {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.closed = false; FakeAudioContext.last = this; }
      async resume() { if (resumeWorks) this.state = 'running'; }
      async close() { this.closed = true; }
      createGain() { return new Gain(this); }
      createBufferSource() { return new Source(this); }
      decodeAudioData(ab) { const id = ab.id; if (decodeFails.has(id)) return Promise.reject(new Error('decode')); return Promise.resolve({ id, duration: byId[id].duration_s, sampleRate: 22050 }); }
    }
    const fetch = async (url) => {
      if (url.endsWith('audio.json')) return { ok: true, json: async () => manifest };
      const id = path.basename(url, '.wav');
      if (fetchFails.has(id)) return { ok: false };
      return { ok: true, arrayBuffer: async () => ({ id }) };
    };
    return { FakeAudioContext, fetch, log };
  }

  test('unlock + preload + play with a fake AudioContext; missing files degrade silently', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const fake = makeFakeAudio({ fetchFails: new Set(['soul_reveal']), decodeFails: new Set(['reconnect']) });
    const captions = [];
    const a = createAudioManager({ app: 'participant', storage: null, audioContextClass: fake.FakeAudioContext, fetch: fake.fetch, baseUrl: '/assets/audio', onCaption: (c) => captions.push(c) });
    assert.equal(a.play('draw_reveal'), false); // locked before gesture
    assert.equal(captions.at(-1).reason, 'locked');
    assert.equal(await a.unlock(), true);
    const avail = await a.preload(['draw_reveal', 'bingo', 'soul_reveal', 'reconnect', 'ambient_galaxy', 'cell_match']);
    assert.equal(avail.draw_reveal, 'ready'); assert.equal(avail.soul_reveal, 'unavailable'); assert.equal(avail.reconnect, 'unavailable');
    assert.equal(a.play('soul_reveal'), false);
    assert.equal(captions.at(-1).reason, 'unavailable');
    assert.equal(a.play('draw_reveal', { gainDb: -3, vars: { number: 3 } }), true);
    assert.equal(captions.at(-1).played, true); assert.equal(captions.at(-1).caption, 'Skill drawn');
    assert.equal(a.state().activeVoices, 1);
    assert.equal(a.play('registration_ready'), false); // never preloaded -> not-loaded, triggers lazy load
    assert.equal(captions.at(-1).reason, 'not-loaded');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(a.state().available.registration_ready, 'ready');
    assert.equal(a.setMuted(true), true);
    assert.equal(a.play('bingo'), false); assert.equal(captions.at(-1).reason, 'muted');
    a.setMuted(false);
  });

  test('autoplay denied: unlock resolves false, state reports it, play stays silent', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const fake = makeFakeAudio({ resumeWorks: false });
    const captions = [];
    const a = createAudioManager({ storage: null, audioContextClass: fake.FakeAudioContext, fetch: fake.fetch, onCaption: (c) => captions.push(c) });
    await a.preload(['bingo']);
    assert.equal(await a.unlock(), false);
    assert.equal(a.state().autoplayDenied, true);
    assert.equal(a.play('bingo'), false);
    assert.equal(captions.at(-1).reason, 'autoplay-denied');
    assert.equal(a.startAmbient(), false);
  });

  test('rate limit, voice cap with priority stealing, replay guards, stale scheduling', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const fake = makeFakeAudio();
    let serverNow = 1_000_000;
    const a = createAudioManager({ app: 'participant', storage: null, audioContextClass: fake.FakeAudioContext, fetch: fake.fetch, clockNow: () => serverNow });
    await a.unlock();
    await a.preload(['cell_match', 'draw_reveal', 'bingo', 'error_soft', 'float_countdown', 'reconnect', 'registration_ready', 'draw5_unlock', 'draw_leadin']);
    // cell_match: max one per 250 ms
    assert.equal(a.play('cell_match'), true);
    assert.equal(a.play('cell_match'), false);
    assert.equal(a.play('cell_match'), false);
    // voice cap: 4 voices; a newcomer of strictly lower priority is dropped, equal/higher steals the lowest voice
    assert.equal(a.play('draw_reveal'), true);        // p2
    assert.equal(a.play('registration_ready'), true); // p2
    assert.equal(a.play('draw5_unlock'), true);       // p2 -> 4 voices incl. cell_match p1
    assert.equal(a.state().activeVoices, 4);
    assert.equal(a.play('error_soft'), false);        // p0 < lowest (p1) -> dropped
    assert.equal(a.state().activeVoices, 4);
    assert.ok(!fake.log.some((e) => e[0] === 'stop'));
    assert.equal(a.play('bingo'), true);              // p3 steals cell_match (p1)
    assert.equal(a.state().activeVoices, 4);
    assert.deepEqual(fake.log.filter((e) => e[0] === 'stop'), [['stop', 'cell_match']]);
    assert.equal(a.play('draw_leadin'), false);       // p1 < lowest remaining (p2) -> dropped
    // let every voice end, then check the replay guards
    fake.FakeAudioContext.last.currentTime = 10;
    assert.equal(a.state().activeVoices, 0);
    assert.equal(a.play('draw_reveal', { fresh: false }), false);
    a.setConnectionEpoch(41);
    assert.equal(a.play('float_countdown', { sequence: 40 }), false);
    assert.equal(a.play('float_countdown', { sequence: 42 }), true);
    a.setReplaying(true); assert.equal(a.play('draw5_unlock'), false); a.setReplaying(false);
    // scheduling by server timestamp
    assert.equal(a.play('float_countdown', { at: serverNow - 5000 }), false); // stale
    const t0 = fake.log.length;
    assert.equal(a.play('float_countdown', { at: new Date(serverNow + 1500).toISOString() }), true);
    const startEvt = fake.log.slice(t0).find((e) => e[0] === 'start' && e[1] === 'float_countdown');
    const ctxNow = fake.FakeAudioContext.last.currentTime;
    assert.ok(startEvt && Math.abs(startEvt[2] - ctxNow - 1.5) < 1e-9, `scheduled at +1.5 s, got ${startEvt && startEvt[2] - ctxNow}`);
  });

  test('ambient loop uses manifest loop points, fades in, and bingo ducks it by 8 dB for 2 s', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const fake = makeFakeAudio();
    const a = createAudioManager({ app: 'public', storage: null, audioContextClass: fake.FakeAudioContext, fetch: fake.fetch });
    await a.unlock();
    await a.preload();
    assert.equal(a.state().available.ambient_galaxy, 'ready');
    assert.equal(a.startAmbient(), true);
    assert.equal(a.startAmbient(), true);
    assert.equal(a.state().ambientPlaying, true);
    const startEvt = fake.log.find((e) => e[0] === 'start' && e[1] === 'ambient_galaxy');
    assert.ok(startEvt);
    assert.equal(a.play('bingo'), true);
    assert.equal(a.duck(8, 2000), true); // already ducked at least this long -> no-op true
    assert.equal(a.stopAmbient(), true);
    assert.equal(a.state().ambientPlaying, false);
    a.dispose();
  });

  test('ambient source is configured with sample-accurate loop points', async () => {
    const { createAudioManager } = await import(AUDIO_JS);
    const fake = makeFakeAudio();
    const sources = [];
    class Ctx extends fake.FakeAudioContext { createBufferSource() { const s = super.createBufferSource(); sources.push(s); return s; } }
    const a = createAudioManager({ app: 'stage', storage: null, audioContextClass: Ctx, fetch: fake.fetch });
    await a.unlock(); await a.preload(['ambient_galaxy']); a.startAmbient();
    const src = sources.find((s) => s.buffer && s.buffer.id === 'ambient_galaxy');
    assert.equal(src.loop, true);
    assert.equal(src.loopStart, 0);
    assert.ok(Math.abs(src.loopEnd - byId.ambient_galaxy.loop.end_sample / 22050) < 1e-9);
  });
});

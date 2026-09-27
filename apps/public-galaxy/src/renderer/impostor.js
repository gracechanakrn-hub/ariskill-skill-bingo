// 3D impostors and Float entrances of decorated (v2 / v3) Souls on the public Galaxy (D-29 docs/art/soul-decorations.md
// "Public Galaxy", D-31 docs/art/soul-faces.md). Browser-only; the plan (queue, tiles, poses, budgets) lives in
// impostor-plan.js.
//
// One offscreen card stage: its own small WebGLRenderer (transparent, preserveDrawingBuffer) set up exactly like the
// phone reveal - the same soul3d rig (figure, charms, face kit, v3 plate / eyes / antenna charm, medallion badge),
// studio lights, reflections, AgX tone mapping and exposure, seen through the phone lens (packages/ui/soul3d card.js). It
//   - bakes settled Souls: the rig is rendered once into the bake tile and drawn into the Soul's atlas cell (the atlas
//     then serves it to the Galaxy's instanced sticker quads like any sprite), a few per frame after the frame;
//   - renders live entrances: each entering Soul's rig, posed per frame (entrancePose), into its own tile; the Galaxy
//     draws the stage canvas as a texture, so the big screen shows the real 3D Soul for its hero moment.
// Each Soul stands on the body of its config's variant (soul3d soulBodyVariant): the baseline for v2, the v3 body for
// v3; both variants load (and stay cached) with the stage. GLTFLoader (packages/vendor/three/loaders.js, D-28) and the
// body models load only when decorated Souls are due: the first one asks for an impostor, or a round ends (warm(): its
// decorated Souls Float next). Any failure (no WebGL, a lost context, a loader error, an init timeout, no body at all)
// marks the stage failed: queued jobs fall back to the 2D composition and entrances to their atlas sprite; a Soul whose
// variant did not load (the v3 body before the face data is built) does the same on its own. A charm, face kit, plate,
// eyes or antenna charm that cannot load is left out on its own (soul3d decor.js); with none of them the Soul bakes as
// the plain gradient Soul.
import { buildSoulRig, createSoulCardStage, loadSoulModels, soulBodyVariant, loadSoulDecor, hasDecor } from '../../../../packages/ui/soul3d/index.js';
import { IMPOSTOR, createBakeQueue, tileRect, tileUv, liveTileSize, entrancePose, wantsImpostor } from './impostor-plan.js';

const LOADERS_URL = '/packages/vendor/three/loaders.js';
const KEEPER_CONFIG = Object.freeze({ version: 2, catalog: 1, seed: 'impostor-keeper', gradient: 0, glow: 0, face: null, charms: [], constellation: [], driftPhase: 0 });

/**
 * createImpostorStage({ THREE, loadLoaders, onChange, now, faceData }) -> stage
 *   accepts(soul, detail) / request(job) / pump(budgetMs) / renderEntrances(items, pixelRatio) / canvas / state / stats / dispose()
 * job: { key, soul: { soulId, config, badge }, cell, priority, draw(canvas, sx, sy, size), fail() }
 * `faceData` replaces packages/ui/soul-face-data.js (tests); by default the models and decorations use the real one.
 */
export function createImpostorStage({ THREE, loadLoaders = () => import(LOADERS_URL), onChange = null, now = () => performance.now(), faceData = undefined } = {}) {
  let state = 'idle';                 // idle -> loading -> ready | failed
  let renderer = null, canvas = null, card = null, models = null, mods = null, keeper = null, initTimer = 0; // models: { v2, v3 } ({ body, hull } | null)
  const queue = createBakeQueue();
  const decors = new Map();           // soulId -> { promise, value, settled, since }
  const live = new Map();             // soulId -> { rig, tile }
  const stats = { state, initMs: null, baked: 0, rebaked: 0, failed: 0, bakeMs: { last: 0, avg: 0, max: 0, n: 0 }, live: { frames: 0, avgMs: 0, maxMs: 0 }, error: null };

  function setState(next) { state = next; stats.state = next; if (onChange) { try { onChange(next); } catch { /* observer errors never break the stage */ } } }

  function init() {
    if (state !== 'idle') return;
    setState('loading');
    const t0 = now();
    initTimer = setTimeout(() => { if (state === 'loading') fail('init timeout'); }, IMPOSTOR.initTimeoutMs);
    Promise.resolve().then(loadLoaders).then((loaders) => {
      if (state !== 'loading') return null;
      mods = { THREE, addons: { GLTFLoader: loaders.GLTFLoader } };
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = IMPOSTOR.stage;
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: false });
      renderer.setPixelRatio(1);
      renderer.setSize(IMPOSTOR.stage, IMPOSTOR.stage, false);
      renderer.autoClear = false;
      canvas.addEventListener('webglcontextlost', onLost, false);
      card = createSoulCardStage(THREE, renderer, { envSize: 64 });
      // both body variants, in parallel; each resolves null on its own when it cannot load
      return Promise.all([loadSoulModels(mods, 'high', { variant: 'v2', face: faceData }), loadSoulModels(mods, 'high', { variant: 'v3', face: faceData })]);
    }).then((loaded) => {
      if (state !== 'loading') return;
      const [v2, v3] = loaded;
      if (!v2 && !v3) throw new Error('Soul body models unavailable');
      models = { v2, v3 };
      // the keeper holds the body / hull / badge shader programs for the stage's lifetime (compiled once here), so a
      // Soul's own materials never release and rebuild them (every variant shares the body and hull shaders)
      const k = v2 || v3;
      keeper = buildSoulRig(THREE, { body: k.body, hull: k.hull, config: KEEPER_CONFIG, badge: 'bingo-star', quality: 'high', decorMaterials: 'shared' });
      const r = tileRect(IMPOSTOR.bakeTile, { size: 64 });
      card.render(keeper, { x: r.x, y: r.glY, size: r.size });
      clearTimeout(initTimer);
      stats.initMs = Math.round(now() - t0);
      setState('ready');
    }).catch((err) => { clearTimeout(initTimer); fail(String((err && err.message) || err)); });
  }

  function fail(reason) {
    if (state === 'failed') return;
    stats.error = reason;
    setState('failed');
    for (const job of queue.drain()) { try { job.fail(); } catch { /* the atlas handles its own errors */ } }
    for (const { rig } of live.values()) rig.dispose();
    live.clear();
  }
  function onLost(ev) { if (ev && ev.preventDefault) ev.preventDefault(); fail('context lost'); }

  function decorFor(soul) {
    const id = String(soul.soulId);
    let d = decors.get(id);
    if (!d) {
      d = { value: null, settled: false, since: now() };
      d.promise = loadSoulDecor(mods, soul.config, { face: faceData }).then((v) => { d.value = v; d.settled = true; return v; });
      decors.set(id, d);
    }
    return d;
  }
  const decorReady = (soul) => { const d = decorFor(soul); return d.settled || now() - d.since > IMPOSTOR.decorWaitMs; };

  function record(bucket, ms) {
    bucket.n = (bucket.n || 0) + 1;
    bucket.last = ms;
    bucket.avg += (ms - bucket.avg) / bucket.n;
    bucket.max = Math.max(bucket.max, ms);
  }

  /** The loaded body and hull of the Soul's variant (the v3 body for a v3 config), or null when that variant failed. */
  const modelsFor = (soul) => (models && models[soulBodyVariant(soul && soul.config)]) || null;
  function rigFor(soul, decor) {
    const m = modelsFor(soul);
    if (!m) throw new Error(`no ${soulBodyVariant(soul && soul.config)} body models`);
    return buildSoulRig(THREE, { body: m.body, hull: m.hull, config: soul.config, badge: soul.badge || null, decor, quality: 'high', decorMaterials: 'shared' });
  }

  function bake(job) {
    const t0 = now();
    let rig = null;
    try {
      if (!modelsFor(job.soul)) throw new Error(`no ${soulBodyVariant(job.soul.config)} body models`); // 2D in its cell
      const d = decorFor(job.soul);
      rig = rigFor(job.soul, d.settled ? d.value : null);
      const r = tileRect(IMPOSTOR.bakeTile, { size: job.cell });
      card.render(rig, { x: r.x, y: r.glY, size: r.size });
      job.draw(canvas, r.x, r.y, r.size);
      stats.baked++;
      record(stats.bakeMs, now() - t0);
      // baked plain while the decorations were still on their way: bake again once they land
      if (!d.settled) d.promise.then((v) => { if (hasDecor(v) && state === 'ready') { stats.rebaked++; queue.add({ ...job, priority: 0 }); } });
    } catch (err) {
      stats.failed++;
      stats.error = String((err && err.message) || err);
      try { job.fail(); } catch { /* ignore */ }
    } finally {
      if (rig) rig.dispose();
    }
  }

  return {
    get state() { return state; },
    get canvas() { return canvas; },
    stats,
    /**
     * Start loading ahead of the first decorated Soul (the Galaxy calls it when a round ends: its Souls are decorated,
     * and their Floats follow within seconds), so the first Float entrance already gets the live 3D figure.
     */
    warm() { init(); return state; },
    /**
     * Whether this stage will draw `soul` (a decorated Soul at a sprite level) - and not failed, nor ready without its
     * body variant. Starts the lazy init.
     */
    accepts(soul, detail = 'simple') {
      if (state === 'failed' || !wantsImpostor(soul, detail)) return false;
      init();
      return state === 'ready' ? !!modelsFor(soul) : state !== 'failed';
    },
    /** Queue an atlas bake (deduplicated by key; entrances first). A failed stage fails the job at once. */
    request(job) {
      if (state === 'failed') { job.fail(); return false; }
      init();
      queue.add(job);
      return true;
    },
    /** Bake queued Souls for about `budgetMs` (at least one when any is ready). Returns the number baked. */
    pump(budgetMs = IMPOSTOR.budgetMs) {
      if (state !== 'ready' || !queue.size) return 0;
      const t0 = now();
      let n = 0;
      while (n < IMPOSTOR.maxPerPump) {
        if (n >= IMPOSTOR.minPerPump && now() - t0 >= budgetMs) break;
        const job = queue.take((j) => !modelsFor(j.soul) || decorReady(j.soul)); // no body for its variant: fails at once
        if (!job) break;
        bake(job);
        n++;
      }
      return n;
    },
    /**
     * Renders the live entrance figures (items from scene.frame().entrances with phase / t / size / scale) into their
     * tiles. Returns Map soulId -> uv rect for the Galaxy's hero quads; empty when the stage is not ready. An entering
     * Soul flies in from its first frame: when its charms / face are still downloading they join the figure as soon as
     * they land (the Galaxy learns the config only at the Float). Finished entrances free their tile.
     */
    renderEntrances(items, pixelRatio = 1, { reducedMotion = false } = {}) {
      const out = new Map();
      if (state !== 'ready') return out;
      const t0 = now();
      const active = new Set();
      for (const e of items) {
        if (!wantsImpostor(e, 'full') || !modelsFor(e)) continue; // no body for its variant: the atlas sprite flies in
        const id = String(e.soulId);
        active.add(id);
        let slot = live.get(id);
        if (!slot) {
          const used = new Set([...live.values()].map((l) => l.tile));
          let tile = -1;
          for (let i = 0; i < IMPOSTOR.bakeTile; i++) if (!used.has(i)) { tile = i; break; }
          if (tile < 0) continue;
          const d = decorFor(e);
          slot = { rig: rigFor(e, d.settled ? d.value : null), tile, decorated: d.settled };
          live.set(id, slot);
          if (!d.settled) d.promise.then((v) => { const s = live.get(id); if (s === slot && hasDecor(v)) s.rig.setDecor(v); });
        }
        const r = tileRect(slot.tile, { size: liveTileSize(e.size, e.scale, pixelRatio) });
        try { card.render(slot.rig, { x: r.x, y: r.glY, size: r.size }, entrancePose(e.phase, e.t, { reducedMotion })); }
        catch (err) { fail(String((err && err.message) || err)); return new Map(); }
        out.set(id, { ...tileUv(r), size: r.size });
      }
      for (const [id, slot] of live) if (!active.has(id)) { slot.rig.dispose(); live.delete(id); }
      if (out.size) { stats.live.frames++; const ms = now() - t0; stats.live.avgMs += (ms - stats.live.avgMs) / stats.live.frames; stats.live.maxMs = Math.max(stats.live.maxMs, ms); }
      return out;
    },
    get pending() { return queue.size; },
    dispose() {
      clearTimeout(initTimer);
      for (const job of queue.drain()) { try { job.fail(); } catch { /* ignore */ } }
      for (const { rig } of live.values()) rig.dispose();
      live.clear();
      if (keeper) keeper.dispose();
      if (card) card.dispose();
      if (canvas) canvas.removeEventListener('webglcontextlost', onLost);
      if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* ignore */ } }
      if (state !== 'failed') setState('failed');
      renderer = null; card = null; keeper = null;
    },
  };
}

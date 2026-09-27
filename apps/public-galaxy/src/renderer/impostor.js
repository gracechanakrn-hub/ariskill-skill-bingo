// 3D impostors and Float entrances of decorated (v2 / v3) Souls on the public Galaxy (D-29 docs/art/soul-decorations.md
// "Public Galaxy", D-31 docs/art/soul-faces.md). Browser-only; the plan (queue, tiles, poses, budgets) lives in
// impostor-plan.js.
//
// One offscreen card stage: its own small WebGLRenderer (transparent, preserveDrawingBuffer) set up exactly like the
// phone reveal - the same soul3d rig (figure, charms, face kit, v3 plate / eyes / antenna charm, medallion badge),
// studio lights, reflections, AgX tone mapping and exposure, seen through the phone lens (packages/ui/soul3d card.js). It
//   - bakes settled Souls: the rig is rendered once into the bake tile and drawn into the Soul's atlas cell (the atlas
//     then serves it to the Galaxy's instanced sticker quads like any sprite), a few per frame after the frame;
//   - renders live figures, each into its own tile, which the Galaxy draws from the stage canvas as a texture: Float
//     entrances (posed per frame by entrancePose) so the big screen shows the real 3D Soul for its hero moment, and
//     (stage 15, D-36) the one Soul visiting the front to say hi and the few Souls doing an idle micro action in orbit,
//     on acting rigs posed by soul3d actionPose (at rest they draw exactly their baked impostor, so nothing pops).
//     Tiles go to entrances first, then the visit (a 2 x 2 block when free, one tile when entrances need the room),
//     then the performers; an item without a tile keeps its atlas sprite.
// The big screen's Souls have no white die-cut (every rig here is built with dieCut: false), and a Bingo winner wears the
// gold crown instead of the medallion (winnerCrown, D-36): the Blender GLB once it has loaded, the same crown from
// primitives until then.
// Each Soul stands on the body of its config's variant (soul3d soulBodyVariant): the baseline for v2, the v3 body for
// v3; both variants load (and stay cached) with the stage, and one still loading 9 s in (IMPOSTOR.variantWaitMs) counts
// as missing until it lands, so a hung download never fails the stage. GLTFLoader (packages/vendor/three/loaders.js,
// D-28) and the body models load only when decorated Souls are due: the first one asks for an impostor, or a round ends
// (warm(): its decorated Souls Float next). Any failure (no WebGL, a lost context, a loader error, an init timeout, no body at all)
// marks the stage failed: queued jobs fall back to the 2D composition and entrances to their atlas sprite; a Soul whose
// variant did not load (the v3 body before the face data is built) does the same on its own. A charm, face kit, plate,
// eyes or antenna charm that cannot load is left out on its own (soul3d decor.js); with none of them the Soul bakes as
// the plain gradient Soul.
import { buildSoulRig, createSoulCardStage, loadSoulModels, soulBodyVariant, loadSoulDecor, hasDecor, actionPose, REST_POSE, SOUL_ACTIONS, loadWinnerCrown } from '../../../../packages/ui/soul3d/index.js';
import { IMPOSTOR, LIVE_ROLES, createBakeQueue, tileRect, tileUv, liveTileSize, entrancePose, wantsImpostor, allocateLiveTile } from './impostor-plan.js';

const LOADERS_URL = '/packages/vendor/three/loaders.js';
const KEEPER_CONFIG = Object.freeze({ version: 2, catalog: 1, seed: 'impostor-keeper', gradient: 0, glow: 0, face: null, charms: [], constellation: [], driftPhase: 0 });

/** `p`, or null when it has not settled within `ms` (the load itself carries on). */
function inTime(p, ms) {
  let timer = 0;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, ms), null); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * createImpostorStage({ THREE, loadLoaders, onChange, now, faceData }) -> stage
 *   accepts(soul, detail) / request(job) / pump(budgetMs) / renderLive(items, pixelRatio) / canvas / state / stats / dispose()
 * job: { key, soul: { soulId, config, badge }, cell, priority, draw(canvas, sx, sy, size), fail() }
 * `faceData` replaces packages/ui/soul-face-data.js (tests); by default the models and decorations use the real one.
 * `variantWaitMs` (tests) replaces IMPOSTOR.variantWaitMs.
 */
export function createImpostorStage({ THREE, loadLoaders = () => import(LOADERS_URL), onChange = null, now = () => performance.now(), faceData, variantWaitMs = IMPOSTOR.variantWaitMs } = {}) {
  let state = 'idle';                 // idle -> loading -> ready | failed
  let renderer = null, canvas = null, card = null, models = null, mods = null, keeper = null, actingKeeper = null, initTimer = 0; // models: { v2, v3 } ({ body, hull } | null)
  let crown = null;                   // the winner's crown GLB scene (D-36) once it has loaded; the rigs clone it
  const queue = createBakeQueue();
  const decors = new Map();           // soulId -> { promise, value, settled, since }
  const live = new Map();             // soulId -> { rig, role, tile: { index, span, tiles } }
  const stats = { state, initMs: null, baked: 0, rebaked: 0, failed: 0, bakeMs: { last: 0, avg: 0, max: 0, n: 0 }, live: { frames: 0, avgMs: 0, maxMs: 0, last: null }, error: null };

  function setState(next) { state = next; stats.state = next; if (onChange) { try { onChange(next); } catch { /* observer errors never break the stage */ } } }

  function init() {
    if (state !== 'idle') return;
    setState('loading');
    const t0 = now();
    initTimer = setTimeout(() => { if (state === 'loading') fail('init timeout'); }, IMPOSTOR.initTimeoutMs);
    Promise.resolve().then(loadLoaders).then((loaders) => {
      if (state !== 'loading') return null;
      mods = { THREE, addons: { GLTFLoader: loaders.GLTFLoader } };
      // the winner's crown GLB (D-36) never holds up the stage: until it lands the rigs build the same crown from primitives
      loadWinnerCrown(mods).then((scene) => { if (scene) crown = scene; });
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = IMPOSTOR.stage;
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: false });
      renderer.setPixelRatio(1);
      renderer.setSize(IMPOSTOR.stage, IMPOSTOR.stage, false);
      renderer.autoClear = false;
      canvas.addEventListener('webglcontextlost', onLost, false);
      card = createSoulCardStage(THREE, renderer, { envSize: 64 });
      // both body variants, in parallel; each resolves null on its own when it cannot load, or when it is still loading
      // variantWaitMs into init (one hung download never fails the stage; the late variant joins when it lands)
      const load = (variant) => {
        const p = loadSoulModels(mods, 'high', { variant, face: faceData });
        p.then((m) => { if (m && models && !models[variant] && state === 'ready') models[variant] = m; }, () => {});
        return inTime(p, t0 + variantWaitMs - now());
      };
      return Promise.all([load('v2'), load('v3')]);
    }).then((loaded) => {
      if (state !== 'loading') return;
      const [v2, v3] = loaded;
      if (!v2 && !v3) throw new Error('Soul body models unavailable');
      models = { v2, v3 };
      // the keepers hold the shader programs for the stage's lifetime (compiled once here), so a Soul's own materials
      // never release and rebuild them (every variant shares them): the plain body and the badge, and the skinned body
      // of the acting rigs (rendered once mid-action)
      const k = v2 || v3;
      keeper = buildSoulRig(THREE, { body: k.body, hull: k.hull, config: KEEPER_CONFIG, badge: 'bingo-star', quality: 'high', decorMaterials: 'shared', dieCut: false, winnerCrown: crown || true });
      actingKeeper = buildSoulRig(THREE, { body: k.body, hull: k.hull, config: KEEPER_CONFIG, quality: 'high', decorMaterials: 'shared', dieCut: false, actions: true });
      const r = tileRect(IMPOSTOR.bakeTile, { size: 64 });
      card.render(keeper, { x: r.x, y: r.glY, size: r.size });
      actingKeeper.setPose(actionPose('sway', 1));
      card.render(actingKeeper, { x: r.x, y: r.glY, size: r.size });
      actingKeeper.rest();
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
  /** A rig for `soul` (no white die-cut on the big screen); `actions` gives it the skeleton of the micro actions. */
  function rigFor(soul, decor, { actions = false } = {}) {
    const m = modelsFor(soul);
    if (!m) throw new Error(`no ${soulBodyVariant(soul && soul.config)} body models`);
    return buildSoulRig(THREE, { body: m.body, hull: m.hull, config: soul.config, badge: soul.badge || null, decor, quality: 'high', decorMaterials: 'shared', dieCut: false, actions, winnerCrown: crown || true });
  }
  const liveRole = (e) => (LIVE_ROLES.includes(e.role) ? e.role : 'entrance');
  /** The pose of a visit's or performer's acting rig: its act (actions.js) or the rest pose. */
  const actPose = (act) => (act && SOUL_ACTIONS.includes(act.action) ? actionPose(act.action, act.t, { side: act.side }) : REST_POSE);

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
     * Renders the live figures into their tiles. items: { soulId, config, badge, size, scale, role, ... } where role is
     * 'entrance' (the default: scene.frame().entrances with phase / t, posed by entrancePose), 'visit' (a visits[]
     * item: its act waves hi, rest while it floats out and back) or 'performer' (a souls[] item with an act: the idle
     * micro action at orbit size; rest when act is null). Tiles go to entrances first, then the visit (a 2 x 2 block
     * when one is free; when an entrance finds no tile the visit gives back three of its four), then performers; an
     * item keeps its tile while it stays live, one that finds none keeps its atlas sprite (a performer's baked rest
     * image is exactly its first live frame, so nothing pops). Returns Map soulId -> uv rect ({ u0, v0, u1, v1, size }
     * in the stage canvas) for the Galaxy's quads; empty when the stage is not ready. A figure whose charms / face are
     * still downloading gets them as soon as they land. Items that left free their tile.
     */
    renderLive(items, pixelRatio = 1, { reducedMotion = false } = {}) {
      const out = new Map();
      if (state !== 'ready') return out;
      const t0 = now();
      const want = [];
      for (const e of items) {
        if (!wantsImpostor(e, 'full') || !modelsFor(e)) continue; // no body for its variant: the atlas sprite
        const role = liveRole(e);
        if (reducedMotion && role !== 'entrance') continue;        // no idle actions or visits under reduced motion
        want.push({ e, role, id: String(e.soulId) });
      }
      want.sort((a, b) => LIVE_ROLES.indexOf(a.role) - LIVE_ROLES.indexOf(b.role));
      const roles = new Map(want.map((w) => [w.id, w.role]));
      for (const [id, slot] of live) if (roles.get(id) !== slot.role) { slot.rig.dispose(); live.delete(id); }
      const used = () => [...live.values()].flatMap((l) => l.tile.tiles);
      const counts = { entrance: 0, visit: 0, performer: 0, noTile: 0 };
      for (const w of want) {
        let slot = live.get(w.id);
        if (!slot) {
          let tile = allocateLiveTile(used(), w.role === 'visit' ? IMPOSTOR.visitSpan : 1);
          if (!tile && w.role === 'entrance') {
            // the hero moment first: a visit holding a block keeps only its top-left tile
            const visit = [...live.values()].find((l) => l.role === 'visit' && l.tile.span > 1);
            if (visit) { visit.tile = { index: visit.tile.index, span: 1, tiles: [visit.tile.index] }; tile = allocateLiveTile(used(), 1); }
          }
          if (!tile) { counts.noTile++; continue; }
          const d = decorFor(w.e);
          slot = { rig: rigFor(w.e, d.settled ? d.value : null, { actions: w.role !== 'entrance' }), role: w.role, tile };
          live.set(w.id, slot);
          if (!d.settled) d.promise.then((v) => { if (live.get(w.id) === slot && hasDecor(v)) slot.rig.setDecor(v); });
        }
        const span = slot.tile.span;
        const r = tileRect(slot.tile.index, { size: liveTileSize(w.e.size, w.e.scale, pixelRatio, { tile: IMPOSTOR.tile * span }), span });
        try {
          if (w.role === 'entrance') card.render(slot.rig, { x: r.x, y: r.glY, size: r.size }, entrancePose(w.e.phase, w.e.t, { reducedMotion }));
          else { slot.rig.setPose(actPose(w.e.act)); card.render(slot.rig, { x: r.x, y: r.glY, size: r.size }); }
        } catch (err) { fail(String((err && err.message) || err)); return new Map(); }
        out.set(w.id, { ...tileUv(r), size: r.size });
        counts[w.role]++;
      }
      stats.live.last = counts;
      if (out.size) { stats.live.frames++; const ms = now() - t0; stats.live.avgMs += (ms - stats.live.avgMs) / stats.live.frames; stats.live.maxMs = Math.max(stats.live.maxMs, ms); }
      return out;
    },
    /** renderLive for Float entrances only (items without a role are entrances). */
    renderEntrances(items, pixelRatio = 1, opts = {}) { return this.renderLive(items, pixelRatio, opts); },
    get pending() { return queue.size; },
    dispose() {
      clearTimeout(initTimer);
      for (const job of queue.drain()) { try { job.fail(); } catch { /* ignore */ } }
      for (const { rig } of live.values()) rig.dispose();
      live.clear();
      if (keeper) keeper.dispose();
      if (actingKeeper) actingKeeper.dispose();
      if (card) card.dispose();
      if (canvas) canvas.removeEventListener('webglcontextlost', onLost);
      if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* ignore */ } }
      if (state !== 'failed') setState('failed');
      renderer = null; card = null; keeper = null; actingKeeper = null;
    },
  };
}

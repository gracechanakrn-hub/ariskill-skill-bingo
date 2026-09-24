#!/usr/bin/env node
// Load / reconnect-storm evidence for requirement 15.4 and the Performance gate (workflow section 15).
//
//   PLAYERS=150 node tests/load/reconnect-storm.js        fast run (release-gate default)
//   PLAYERS=450 node tests/load/reconnect-storm.js        release run: expected attendance 300 + 50 % headroom (15.4 "capacity test")
//
// The game service is created in-process (createApp, in-memory SQLite, port 0); N players join, build boards and each opens a
// participant SSE stream; N public screens open public SSE streams (2N streams total). Measured:
//   - draw fan-out: time from issuing `round.draw.next` until every stream has received the matching draw.accepted (p95 per stream)
//   - reconnect storm: all 2N streams drop at once, one draw happens while they are down, all resume with Last-Event-ID;
//     recovery = time from the storm until every stream has caught up (received the missed draw)
//   - snapshot p95 under concurrent public snapshot reads, setup API p95 (session/profile/save/finalize)
//   - invariants: no duplicate draw event per stream, no sequence gaps, no duplicate winner/entrance
// Exit 1 if p95 draw fan-out > MAX_FANOUT_P95_MS (1000) or reconnect recovery > MAX_RECONNECT_MS (5000).
// Because client and server share one event loop, the client-side timings include the client's own parsing work: conservative.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { join as pathJoin } from 'node:path';
import { startServer, createRound, command, join, saveBoard, boardSet, ELIGIBLE_IDS, ROLES, openStream, sleep, nextKey } from '../e2e/helpers.js';

const ROOT = pathJoin(fileURLToPath(import.meta.url), '..', '..', '..');
const PLAYERS = Number.parseInt(process.env.PLAYERS ?? '150', 10);
const DRAWS = Number.parseInt(process.env.DRAWS ?? '6', 10);
const MAX_FANOUT_P95_MS = Number.parseFloat(process.env.MAX_FANOUT_P95_MS ?? '1000');
const MAX_RECONNECT_MS = Number.parseFloat(process.env.MAX_RECONNECT_MS ?? '5000');
const MAX_SNAPSHOT_P95_MS = Number.parseFloat(process.env.MAX_SNAPSHOT_P95_MS ?? '500');
const BATCH = 50;
const OUT = pathJoin(ROOT, 'reports', 'qa', 'load-report.json');

const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 100) / 100; };
const stats = (arr) => ({ n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), max: arr.length ? Math.round(Math.max(...arr) * 100) / 100 : null });
async function inBatches(items, fn, size = BATCH) { const out = []; for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn))); return out; }
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

async function main() {
  const started = new Date().toISOString();
  log(`reconnect-storm: PLAYERS=${PLAYERS} DRAWS=${DRAWS} (streams: ${2 * PLAYERS})`);
  const t = await startServer({ sseHeartbeatMs: 15000 });
  const report = { runId: existsSync(pathJoin(ROOT, 'build/RUN_ID')) ? readFileSync(pathJoin(ROOT, 'build/RUN_ID'), 'utf8').trim() : null, generatedAt: started, node: process.version, params: { players: PLAYERS, publicStreams: PLAYERS, participantStreams: PLAYERS, totalStreams: 2 * PLAYERS, draws: DRAWS, batch: BATCH, rateLimitsRelaxed: true, inProcess: true }, thresholds: { drawFanoutP95Ms: MAX_FANOUT_P95_MS, reconnectRecoveryMs: MAX_RECONNECT_MS, snapshotP95Ms: MAX_SNAPSHOT_P95_MS }, results: {}, invariants: {}, notes: [] };
  try {
    // ---- setup: N players with READY boards ----------------------------------------------------------------------
    const round = await createRound(t, { title: 'Load' });
    const setupLat = [];
    const timed = async (fn) => { const t0 = performance.now(); const r = await fn(); setupLat.push(performance.now() - t0); return r; };
    const t0setup = performance.now();
    const players = await inBatches([...Array(PLAYERS).keys()], async (i) => {
      const role = ROLES[i % ROLES.length];
      const p = await timed(() => join(t, { employeeRef: `load-${i}`, displayName: `Load ${i}`, consent: i % 2 === 0, profile: { platformId: role.platformId, roleId: role.id } }));
      const set = boardSet((i * 7) % (ELIGIBLE_IDS.length - 25));
      const s = await timed(() => saveBoard(t, p, set, 0)); if (s.status !== 200) throw new Error(`save ${i}: ${JSON.stringify(s.body)}`);
      const f = await timed(() => t.api.post('/me/board/finalize', { boardVersion: s.body.resultingVersion }, p.token, nextKey('fin'))); if (f.status !== 200) throw new Error(`finalize ${i}: ${JSON.stringify(f.body)}`);
      return p;
    });
    report.results.setupApi = { ...stats(setupLat), totalMs: Math.round(performance.now() - t0setup), calls: setupLat.length };
    log(`setup: ${PLAYERS} boards READY in ${report.results.setupApi.totalMs} ms; API p95 ${report.results.setupApi.p95} ms`);

    // ---- streams ------------------------------------------------------------------------------------------------------
    const arrivals = new Map(); // key `${streamIndex}:${drawNumber}` -> perf time
    const dupes = { draws: 0 };
    let streams = [];
    const attach = (h, idx) => { h.idx = idx; h.seen = new Set(); h.onEvent((ev) => { if (ev.event === 'draw.accepted') { const n = ev.data.payload.draw.number; if (h.seen.has(n)) dupes.draws += 1; h.seen.add(n); arrivals.set(`${idx}:${n}`, performance.now()); } }); return h; };
    const t0open = performance.now();
    const pubs = await inBatches([...Array(PLAYERS).keys()], (i) => openStream(t.baseUrl, `/events/${t.eventId}/stream`).then(h => attach(h, `pub${i}`)));
    const parts = await inBatches(players.map((p, i) => [p, i]), ([p, i]) => openStream(t.baseUrl, '/me/stream', { token: p.token }).then(h => attach(h, `prt${i}`)));
    streams = [...pubs, ...parts];
    if (streams.some(s => s.status !== 200)) throw new Error('some streams failed to open');
    report.results.streamsOpenMs = Math.round(performance.now() - t0open);
    log(`streams: ${streams.length} open in ${report.results.streamsOpenMs} ms (server sees ${t.app.hub.size()})`);

    // ---- play: draw fan-out ----------------------------------------------------------------------------------------------
    const l = await command(t, round.roundId, 'round.lock', round.version); let cur = (await command(t, round.roundId, 'round.start', l.resultingVersion)).round;
    const fanout = [], cmdLat = [], perDraw = [];
    const waitAll = async (n, timeoutMs = 15000) => { const deadline = performance.now() + timeoutMs; while (performance.now() < deadline) { if (streams.every(s => s.seen.has(n))) return true; await sleep(2); } return false; };
    let drawsDone = 0;
    for (let d = 1; d <= DRAWS && cur.state === 'PLAYING'; d++) {
      const t0 = performance.now();
      const r = await command(t, cur.roundId, 'round.draw.next', cur.version);
      cmdLat.push(performance.now() - t0); cur = r.round; drawsDone += 1;
      const n = r.effects.draw.number;
      const complete = await waitAll(n);
      const lat = streams.map(s => arrivals.get(`${s.idx}:${n}`)).filter(x => x !== undefined).map(x => x - t0);
      perDraw.push({ number: n, delivered: lat.length, complete, p95Ms: pct(lat, 95), maxMs: lat.length ? Math.round(Math.max(...lat)) : null, commandMs: Math.round(cmdLat.at(-1)) });
      fanout.push(...lat);
      log(`draw ${n}: delivered to ${lat.length}/${streams.length} streams, p95 ${pct(lat, 95)} ms, max ${perDraw.at(-1).maxMs} ms, command ${Math.round(cmdLat.at(-1))} ms${complete ? '' : ' (INCOMPLETE)'}`);
    }
    report.results.drawFanout = { ...stats(fanout), draws: drawsDone, perDraw, allDelivered: perDraw.every(x => x.complete) };
    report.results.drawCommand = stats(cmdLat);

    // ---- reconnect storm --------------------------------------------------------------------------------------------------
    const lastIds = streams.map(s => s.lastId);
    const stormAt = performance.now();
    for (const s of streams) s.close();
    await Promise.all(streams.map(s => s.done));
    const dropMs = performance.now() - stormAt;
    let offlineDraw = null;
    if (cur.state === 'PLAYING') { const r = await command(t, cur.roundId, 'round.draw.next', cur.version); cur = r.round; offlineDraw = r.effects.draw.number; drawsDone += 1; }
    const resumed = await inBatches(streams.map((s, i) => [s, i]), ([s, i]) => openStream(t.baseUrl, s.idx.startsWith('pub') ? `/events/${t.eventId}/stream` : '/me/stream', { token: s.idx.startsWith('pub') ? null : players[Number(s.idx.slice(3))].token, lastEventId: lastIds[i] }).then(h => attach(h, s.idx)), 100);
    const recovery = [];
    const latest = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', t.eventId).s;
    const deadline = performance.now() + MAX_RECONNECT_MS * 3;
    const caughtUp = (h) => (offlineDraw ? h.seen.has(offlineDraw) : (h.lastId ?? 0) >= latest || h.comments.length > 0);
    const recoveredAt = new Map();
    while (performance.now() < deadline) {
      for (const h of resumed) if (!recoveredAt.has(h.idx) && caughtUp(h)) recoveredAt.set(h.idx, performance.now() - stormAt);
      if (recoveredAt.size === resumed.length) break;
      await sleep(5);
    }
    for (const h of resumed) if (recoveredAt.has(h.idx)) recovery.push(recoveredAt.get(h.idx));
    const gaps = resumed.filter(h => { const ids = h.events.map(e => e.id); return ids.some((v, i) => i > 0 && v <= ids[i - 1]); }).length;
    const notResumedFrom = resumed.filter((h, i) => h.events.some(e => e.id <= lastIds[i])).length;
    report.results.reconnectStorm = { streams: resumed.length, dropMs: Math.round(dropMs), offlineDraw, recovered: recovery.length, recoveryAllMs: recovery.length === resumed.length ? Math.round(Math.max(...recovery)) : null, ...stats(recovery), replayedBelowLastEventId: notResumedFrom, nonMonotonicStreams: gaps };
    log(`reconnect storm: ${resumed.length} streams dropped in ${Math.round(dropMs)} ms; ${recovery.length}/${resumed.length} recovered; all caught up in ${report.results.reconnectStorm.recoveryAllMs ?? 'n/a'} ms (p95 ${report.results.reconnectStorm.p95} ms)`);
    streams = resumed;

    // ---- snapshot p95 under concurrent reads ---------------------------------------------------------------------------------
    const snapLat = [];
    await inBatches([...Array(PLAYERS).keys()], async () => { const t0 = performance.now(); const r = await t.api.get(`/events/${t.eventId}/snapshot`); if (r.status !== 200) throw new Error('snapshot failed'); snapLat.push(performance.now() - t0); });
    const stageLat = [];
    await inBatches([...Array(Math.min(PLAYERS, 50)).keys()], async () => { const t0 = performance.now(); const r = await t.api.get(`/stage/events/${t.eventId}/snapshot`, t.stage); if (r.status !== 200) throw new Error('stage snapshot failed'); stageLat.push(performance.now() - t0); });
    report.results.publicSnapshot = stats(snapLat); report.results.stageSnapshot = stats(stageLat);
    log(`snapshots: public p95 ${report.results.publicSnapshot.p95} ms (n=${snapLat.length}), stage p95 ${report.results.stageSnapshot.p95} ms`);

    // ---- invariants ------------------------------------------------------------------------------------------------------------
    const drawRows = t.db.all('SELECT number, skill_id FROM draws WHERE round_id = ? ORDER BY number', round.roundId);
    report.invariants = {
      duplicateDrawEventsOnStreams: dupes.draws,
      drawsPersisted: drawRows.length, drawsIssued: drawsDone, uniqueSkills: new Set(drawRows.map(d => d.skill_id)).size === drawRows.length,
      winnersPersisted: t.db.get('SELECT COUNT(*) AS c FROM winners WHERE round_id = ?', round.roundId).c,
      entrancesEmitted: t.db.get("SELECT COUNT(*) AS c FROM events_outbox WHERE type = 'soul.float_accepted'").c,
      serverConnectionsAfterStorm: t.app.hub.size(), expectedConnections: streams.length,
    };
    for (const s of streams) s.close(); await Promise.all(streams.map(s => s.done));
  } finally { await t.close(); }

  const r = report.results;
  const checks = {
    drawFanoutP95: r.drawFanout?.p95 !== null && r.drawFanout?.p95 <= MAX_FANOUT_P95_MS && r.drawFanout?.allDelivered === true,
    reconnectRecovery: r.reconnectStorm?.recoveryAllMs !== null && r.reconnectStorm?.recoveryAllMs <= MAX_RECONNECT_MS && r.reconnectStorm?.recovered === r.reconnectStorm?.streams,
    snapshotP95: r.publicSnapshot?.p95 <= MAX_SNAPSHOT_P95_MS,
    noDuplicateDraws: report.invariants.duplicateDrawEventsOnStreams === 0 && report.invariants.uniqueSkills === true && report.invariants.drawsPersisted === report.invariants.drawsIssued,
    noReplayBelowLastEventId: r.reconnectStorm?.replayedBelowLastEventId === 0 && r.reconnectStorm?.nonMonotonicStreams === 0,
  };
  report.checks = checks;
  report.pass = checks.drawFanoutP95 && checks.reconnectRecovery && checks.noDuplicateDraws && checks.noReplayBelowLastEventId;
  report.notes.push('Release run = expected attendance 300 + 50 % headroom -> PLAYERS=450 (900 streams). The gate default PLAYERS=150 is a fast run.');
  report.notes.push('snapshotP95 is informational (15.4 API p95 <= 500 ms target); only draw fan-out and reconnect recovery gate the exit code.');
  report.notes.push('Rate limits are relaxed for setup (session 5/min per IP would block N players from one IP); production limits are per IP/actor.');
  report.notes.push('In-process measurement on a developer machine; venue network latency is not included and must be validated at rehearsal (reports/qa/venue-performance.md).');
  mkdirSync(pathJoin(ROOT, 'reports', 'qa'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  log(`report: ${OUT}`);
  log(JSON.stringify({ pass: report.pass, drawFanoutP95Ms: r.drawFanout?.p95, drawFanoutMaxMs: r.drawFanout?.max, reconnectRecoveryAllMs: r.reconnectStorm?.recoveryAllMs, reconnectP95Ms: r.reconnectStorm?.p95, publicSnapshotP95Ms: r.publicSnapshot?.p95, setupApiP95Ms: r.setupApi?.p95, checks }));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => { process.stderr.write(`reconnect-storm failed: ${e.stack ?? e}\n`); process.exit(1); });

// Server-side timers (round-state-machine.json "timers"): lockAt -> lock only, resultWindow -> CLOSED, startGrace -> overdue flag,
// retention hourly. A 250 ms tick over an injectable clock; tests call tick() directly after moving the clock.
import { runRetention } from './retention.js';

export function createTimers({ db, game, clock, config, log, projections = null }) {
  let handle = null;
  let lastRetention = clock.now();
  let running = false;

  function tick() {
    if (running) return; // re-entrancy guard (synchronous, but defensive)
    running = true;
    try {
      const now = clock.iso();
      for (const r of db.all(`SELECT id FROM rounds WHERE state = 'REGISTRATION_OPEN' AND lock_at IS NOT NULL AND lock_at <= ?`, now)) game.lockByTimer(r.id);
      for (const r of db.all(`SELECT id FROM rounds WHERE state = 'WINNER'`)) { try { game.closeByTimer(r.id); } catch (e) { log?.error('timer close failed', { roundId: r.id, error: e.message }); } }
      for (const r of db.all(`SELECT id FROM rounds WHERE state = 'LOCKED' AND overdue_notified = 0`)) { try { game.markOverdue(r.id); } catch (e) { log?.error('overdue flag failed', { roundId: r.id, error: e.message }); } }
      if (clock.now() - lastRetention >= 3600 * 1000) { lastRetention = clock.now(); try { runRetention({ db, config, clock, projections, log }, clock.now()); } catch (e) { log?.error('retention failed', { error: e.message }); } }
    } catch (e) {
      log?.error('timer tick failed', { error: e.message });
    } finally { running = false; }
  }
  function start() { if (handle) return; handle = setInterval(tick, config.timerIntervalMs); handle.unref?.(); }
  function stop() { if (handle) clearInterval(handle); handle = null; }
  return { tick, start, stop, isRunning: () => !!handle };
}

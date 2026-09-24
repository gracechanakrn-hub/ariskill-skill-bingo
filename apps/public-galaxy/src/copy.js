// Copy access for the public screen. Everything user-facing goes through t()/exception() from
// packages/contracts. A few operator-only control labels (sound toggle, volume, renderer mode) have no key in
// copy.json yet; `tt` returns the catalog value when the key exists and a documented fallback otherwise
// (recorded in README.md / known_issues so the copy owner can add the keys without touching this app).
import { t, exception, COPY } from '../../../packages/contracts/index.js';

export { t, exception };

export function hasKey(key) { return Object.prototype.hasOwnProperty.call(COPY.key, key); }

export function tt(key, vars = {}, fallback = key) {
  if (hasKey(key)) return t(key, vars);
  return String(fallback).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/** Operator control labels with catalog fallbacks (keys proposed for copy.json). */
export const LOCAL = Object.freeze({
  enableSound: ['public.audio.enable', 'Click to enable sound'],
  mute: ['public.audio.mute', 'Mute'],
  unmute: ['public.audio.unmute', 'Unmute'],
  volume: ['public.audio.volume', 'Volume'],
  mode2d: ['public.renderer.canvas2d', '2D mode'],
  modeStatic: ['public.renderer.static', 'Static mode'],
  stale: ['public.stale', 'Display may be out of date'],
  galaxySummary: ['public.galaxy.summary', '{count} Souls in the Arise Galaxy'],
  loading: ['public.loading', 'Loading the Skill Galaxy...'],
  error: ['public.error', 'The Galaxy is unavailable. Retrying...'],
  eventName: ['public.eventName', 'AriSkill Skill Bingo'],
  roundLabel: ['public.round', 'Round {number}'],
  locksIn: ['public.waiting.locksIn', 'Registration locks in'],
  waitingStart: ['play.waitingStart', 'Board locked. Waiting for the host to start...'],
  coWinners: ['public.winner.coWinners', '{count} co-winners'],
  live: ['public.connection.live', 'Live'],
  quality: ['public.renderer.quality', 'Quality {level}'],
});

export function label(name, vars = {}) {
  const [key, fallback] = LOCAL[name];
  return tt(key, vars, fallback);
}

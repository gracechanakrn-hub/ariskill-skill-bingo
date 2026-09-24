// apps/employee-mobile/src/audio-motion.js - audio manager, celebration guard and motion preferences for /play.
// Sound never carries required information (docs/audio/sound-spec.md); every cue has a visible/live-region twin.
// Celebrations (motion + cue) are taken from the same guarded decision (docs/motion/motion-spec.md section 5).
import { createAudioManager } from '/packages/ui/audio.js';
import { createCelebrationGuard, setReducedMotion, restoreReducedMotion, prefersReducedMotion, MOTION } from '/packages/ui/motion.js';
import { announce } from '/packages/ui/dom.js';
import { t } from '/packages/contracts/index.js';

export { MOTION };

/**
 * createAudioMotion({ clockNow, getConnectionEpoch }) -> { audio, guard, cue, unlock, setMuted, isMuted, setReduced, isReduced, ... }
 * Participant audio starts locked (silent) until unlock() runs inside the join tap; mute persists in localStorage
 * (handled by the AudioManager under `ariskill-skill-bingo:audio:participant`).
 */
export function createAudioMotion({ clockNow, getConnectionEpoch }) {
  const audio = createAudioManager({
    app: 'participant',
    clockNow,
    translate: t,
    onCaption: ({ caption, played }) => { if (!played && caption) announce(caption, { politeness: 'polite' }); },
  });
  audio.preload();
  const guard = createCelebrationGuard({ getConnectionEpoch });
  const played = { bingoRounds: new Set(), soulReveals: new Set(), floats: new Set() };
  restoreReducedMotion();

  return {
    audio,
    guard,
    /** Resume the AudioContext inside a user gesture. Returns whether sound is available now. */
    unlock: () => audio.unlock(),
    setMuted: (flag) => audio.setMuted(flag),
    isMuted: () => audio.state().muted,
    audioSupported: () => audio.state().supported,
    setReduced: (flag) => setReducedMotion(flag),
    isReduced: () => prefersReducedMotion(),
    /** Reconnect guards: replayed backlog never re-celebrates (motion spec section 6, sound spec section 4). */
    beginReplay(lastAppliedSequence) { audio.setConnectionEpoch(lastAppliedSequence); audio.setReplaying(true); },
    endReplay() { audio.setReplaying(false); },
    markSnapshotApplied(sequence) { guard.markSnapshotApplied(sequence); },
    /** shouldCelebrate(key, meta) from the guard; `meta` is the sse-client meta plus `sequence`. */
    allow(key, meta) { return guard.shouldCelebrate(key, meta); },
    // ---- cue helpers (dedupe at app level; the manager rate-limits as a second line of defence) ----
    cueBoardReady() { audio.play('registration_ready'); },
    cueDraw(draw, matched, unlocksBingo) {
      audio.play('draw_reveal', { vars: { number: draw.number } });
      if (matched) audio.play('cell_match');
      if (unlocksBingo) audio.play('draw5_unlock');
    },
    cueBingo(roundId) {
      if (played.bingoRounds.has(roundId)) return false;
      played.bingoRounds.add(roundId);
      return audio.play('bingo');
    },
    cueSoulReveal(soulId) {
      if (played.soulReveals.has(soulId)) return false;
      played.soulReveals.add(soulId);
      return audio.play('soul_reveal');
    },
    cueFloatTick(atServerMs) { audio.play('float_countdown', { at: atServerMs }); },
    cueFloatLaunch(soulId) {
      if (played.floats.has(soulId)) return false;
      played.floats.add(soulId);
      return audio.play('float_launch');
    },
    cueError() { audio.play('error_soft'); },
  };
}

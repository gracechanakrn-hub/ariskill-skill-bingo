// Injectable clock so timers and expiry logic can be driven deterministically in tests (BR-19: server time is authoritative).
export function createClock(initialMs = null) {
  let offset = 0; let frozen = initialMs;
  const clock = {
    now() { return frozen !== null ? frozen : Date.now() + offset; },
    iso() { return new Date(clock.now()).toISOString(); },
    /** Freeze the clock at an absolute epoch-ms value (tests). */
    set(ms) { frozen = ms; },
    /** Advance the (frozen or live) clock by ms. */
    advance(ms) { if (frozen !== null) frozen += ms; else offset += ms; },
    /** Return to live time. */
    unfreeze() { frozen = null; },
  };
  return clock;
}

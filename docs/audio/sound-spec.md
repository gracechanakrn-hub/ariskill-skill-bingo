# AriSkill Skill Bingo - Sound Specification

**Stage:** 4-sound | **Run:** run-20260922-113339 | **Version:** 1.0.0 | **Status:** submitted (provisional pending audio owner sign-off; `approved_by: null` in the manifest)

Sound in Skill Bingo supports pacing and feedback. It never carries required information (requirement section 10, accessibility 12.2): every cue has a visible/caption equivalent, every app works fully with audio muted, unavailable (E14) or denied by autoplay policy.

Inputs honoured: requirements sections 10, 8.3 (E14), 11, 12.2; `contracts/realtime-events.json` 1.0.0; `packages/contracts/copy.json` 1.0.0; decision D-14; workflow sections 5.2 and 11; `docs/stack-verification.md` (Python 3.14 + numpy, zero third-party JS).

## 1. Deliverable map

| Artifact | Path | Notes |
|---|---|---|
| Editable source (synthesis recipes + integration policy) | `assets-src/audio/cues.json` | The only file to edit to change a cue |
| Generator | `tools/assets/build-audio.py` | Python 3 + numpy + stdlib `wave`; deterministic (seed 20260922); `--check` verifies outputs are current |
| Runtime audio | `assets/audio/*.wav` | 22 050 Hz, 16-bit PCM, mono; never hand-edited |
| Canonical manifest | `assets/manifest/audio.yaml` | Workflow 5.2 fields + measured audio metrics |
| Browser manifest | `assets/manifest/audio.json` | Identical content, fetched by the AudioManager |
| AudioManager | `packages/ui/audio.js` | Browser ESM, zero dependencies, Node-importable |
| Tests | `tools/assets/test/audio.test.js` | `node --test`; 19 tests |

## 2. Cue sheet

Event types are the authoritative names in `contracts/realtime-events.json`. Types prefixed `client.` or `app.` are local UI moments (not server events) and are listed so the integration is unambiguous. Priority: 3 top, 0 lowest. "Rate" is the manager's per-cue minimum interval between audible plays.

| Cue id | File | Trigger (event type) | Audiences | Design | Length | Priority | Rate | Ducks bed | Loop | Preload | Caption (copy key) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `ambient_galaxy` | ambient_galaxy.wav | `app.start` on public/stage, only after the first user gesture (`unlock()`) | public, stage | Calm evolving pad on A (A1 sub, A2/E3/A3/C#4/E4/B4 sines with 2 partials, slow AM), soft band-limited air; nothing above 3 kHz | 7.000 s loop | 0 | - | - | yes, `loop.start_sample 0`, `end_sample 154350` | public, stage | "Galaxy ambience playing" (-) |
| `registration_ready` | registration_ready.wav | `board.ready` | participant | Warm two-note E5 -> A5 (fourth up), triangle + sine octave, LP 3.2 kHz | 0.600 s | 2 | 1000 ms | - | - | - | "Your Skill Bingo is ready!" (`board.complete`) |
| `draw_leadin` | draw_leadin.wav | Admin: local `round.draw.next.pending` (Next Skill pressed, awaiting `draw.accepted`). Public: optional lead-in ahead of the card flip on `draw.accepted` | admin, public | Soft noise riser (250 -> 2.6 kHz sweep) with a rising A4 -> A5 sine; no chime, so it never reads as the reveal | 0.400 s | 1 | 1000 ms | - | - | public | "Drawing the next skill" (`admin.nextSkillPending`) |
| `draw_reveal` | draw_reveal.wav | `draw.accepted` | participant, public, stage, admin | Bright bell chime A5/C#6/E6 with inharmonic partials, 30 ms arpeggio | 0.800 s | 2 | 800 ms | - | - | all four | "Skill drawn" (`play.draw`, e.g. "Draw 7") |
| `cell_match` | cell_match.wav | `draw.accepted` with non-empty `myMatchedPositions` | participant | 1.66 kHz -> 1.1 kHz sine blip + 4 ms noise transient | 0.120 s | 1 | 250 ms | - | - | participant | "Matched on your board" (`play.matched`) |
| `draw5_unlock` | draw5_unlock.wav | `draw.accepted` where `draw.number == 5` (`bingoEvaluationActive` turns true) | participant, public, stage | Rising A4 -> C#5 -> E5 motif with A5/A3 support: "Bingo is live" | 1.000 s | 2 | 5000 ms | - | - | participant, public | "Bingo is live" (`play.evaluationActive`) - mandatory visible copy |
| `bingo` | bingo.wav | `bingo.detected`; also `result.published` with winners when no `bingo.detected` was received (dedupe by roundId) | participant, public, stage, admin | Noise lift into an A-major saw/sine strike plus E6 bell | 1.500 s | 3 | 3000 ms | -8 dB for 2000 ms | - | all four | "Bingo detected" (`result.bingo`) |
| `soul_reveal` | soul_reveal.wav | `soul.created` / opening the reveal screen (once per soulId) | participant | Gentle rising E4 -> G#4 -> B4 -> E5 over an E/B pad, all below 2.5 kHz | 1.900 s | 2 | 5000 ms | - | - | - | "Your Soul is ready to join Arise." (`soul.ready`) |
| `float_countdown` | float_countdown.wav | local `client.float_countdown` step 3, 2, 1 (one file, played once per visible step at the scheduled time) | participant | Soft A5/A4 tick | 0.180 s | 1 | 300 ms | - | - | participant | "3 -> 2 -> 1 -> FLOAT" (`soul.countdown`) |
| `float_launch` | float_launch.wav | `soul.float_accepted` (participant: own soulId; public/stage: each entrance, deduped by soulId) | participant, public, stage | Noise whoosh (400 Hz -> 6 kHz) into a soft A-major bloom | 1.200 s | 3 | 600 ms | -4 dB for 1200 ms | - | participant, public, stage | "Your Soul is in the Galaxy" (`soul.floated`) |
| `error_soft` | error_soft.wav | local `client.exception` (any E-code toast/banner) | all | Low A3 -> G3 double-blip, dull triangle below 1.2 kHz, descending; never a rising interval, never bright | 0.400 s | 0 | 1500 ms | - | - | - | "Notice: see message" (-; the E-code copy is the equivalent) |
| `reconnect` | reconnect.wav | local `client.reconnecting` (E12/E7 banner shown) | public, stage, admin | Very subtle single A4 sine, slow attack | 0.500 s | 0 | 10 000 ms | - | - | - | "Reconnecting to the Skill Galaxy..." (`reconnect`) - optional |

Measured values (from `assets/manifest/audio.json`, generated):

| Cue | Bytes | Peak dBFS | RMS dBFS (target) | Limiter GR |
|---|---|---|---|---|
| ambient_galaxy | 308 744 | -12.97 | -24.00 (-24) | 0.00 dB |
| registration_ready | 26 504 | -2.27 | -16.07 (-16) | 0.18 dB |
| draw_leadin | 17 684 | -2.65 | -18.00 (-18) | 0.08 dB |
| draw_reveal | 35 324 | -1.29 | -16.66 (-16, peak-bound) | 1.29 dB |
| cell_match | 5 336 | -3.42 | -18.00 (-18) | 0.01 dB |
| draw5_unlock | 44 144 | -3.73 | -16.04 (-16) | 0.00 dB |
| bingo | 66 194 | -1.36 | -16.02 (-16) | 1.07 dB |
| soul_reveal | 83 834 | -5.13 | -17.00 (-17) | 0.00 dB |
| float_countdown | 7 982 | -2.64 | -18.00 (-18) | 0.08 dB |
| float_launch | 52 964 | -1.75 | -16.00 (-16) | 0.49 dB |
| error_soft | 17 684 | -7.07 | -19.20 (-19) | 0.00 dB |
| reconnect | 22 094 | -10.55 | -20.00 (-20) | 0.00 dB |
| **Total** | **688 488** (0.66 MB of 1.6 MB budget) | | | |

## 3. Mix hierarchy

From bottom to top of the mix:

1. **Ambient bed** (`ambient_galaxy`, -24 dBFS RMS) - continuity only, lowest level, its own gain bus so it can be ducked.
2. **Status / error** (`reconnect`, `error_soft`, -19 to -20 dBFS) - lowest *priority*: they are the first to be dropped when voices are scarce and never interrupt a reveal.
3. **Feedback** (`cell_match`, `float_countdown`, `draw_leadin`, -18 dBFS) - short, frequent, low priority.
4. **Reveals and transitions** (`draw_reveal`, `registration_ready`, `draw5_unlock`, `soul_reveal`, -16 to -17 dBFS) - mid priority.
5. **Moments** (`bingo`, `float_launch`, -16 dBFS, peak <= -1.36 dBFS) - top priority, the only cues that duck the bed.

Cues share one A-major tonal centre so overlaps never clash; `error_soft` is the sole descending/dull cue so it is recognisably "not success" even at low volume.

## 4. Ducking and rapid-event rules

- **Ducking** is applied on the ambient bus only: `bingo` -8 dB for 2000 ms, `float_launch` -4 dB for 1200 ms; 30 ms dip, 400 ms recovery ramp. An explicit `duck(db, ms)` is also available; a duck that would end before an already scheduled one is a no-op.
- **Max concurrent one-shot voices: 4** (the bed does not count). When full, a newcomer of *strictly lower* priority than every active voice is dropped; otherwise the lowest-priority (then earliest-ending) voice is stopped and the newcomer plays.
- **Per-cue rate limits** (table above). `cell_match` is capped at one audible play per 250 ms; the limit counts audible plays only.
- **Replay after reconnect plays nothing.** Apps pass `fresh: false` (or `sequence`) for events at or below the connection epoch, and/or call `setReplaying(true)` while applying a snapshot/backlog. The manager never plays for those, and never emits captions for them. This mirrors the motion contract (replays set final state without re-celebrating).
- **Stale scheduled cues** (`at` more than 400 ms in the past) are dropped, so a late Float tick cannot fire out of step with the visual countdown.
- **Duplicates**: apps dedupe `bingo` per roundId and `float_launch`/`soul_reveal` per soulId before calling `play`; the manager's rate limits are a second line of defence.
- A draw storm (admin clicking faster than pacing) yields at most one `draw_reveal` per 800 ms and one `cell_match` per 250 ms: never an unsafe or chaotic mix.

## 5. Loudness, peak and file targets

| Target | Value | Verified by |
|---|---|---|
| Format | WAV, 22 050 Hz, 16-bit PCM, mono | WAV header test |
| One-shot loudness | about -16 dBFS RMS (feedback cues -18, status cues -19/-20), tolerance +-3 dB | manifest + re-measured in test |
| Ambient bed loudness | -24 dBFS RMS | test |
| Peak ceiling | <= -1 dBFS on every file (soft-knee tanh limiter from -4 dBFS) | test |
| Fades | 10 ms linear in/out on every one-shot (loop has none; the manager fades the bed in over 1.5 s and out over 0.8 s) | test (first/last sample silence) |
| Loop | 6-8 s; sample-accurate loop points; seam discontinuity <= 1.25 x the largest intra-loop sample step and <= 0.02 FS; slope continuity checked too. Measured seam step 0.00095 FS vs 0.0212 FS internal max | test |
| Budgets | total <= 1.6 MB (actual 0.66 MB); each one-shot <= 120 KB (largest 83.8 KB) | test |
| Durations | each cue within the table limits | test |

Normalisation rule in the generator: gain = min(RMS gain to target, peak gain to 0 dBFS), then the limiter tames the last 4 dB to the -1 dBFS ceiling; `normalisation: peak` in the manifest marks the one cue (`draw_reveal`) where the peak bound won.

## 6. Preload list

`PRELOAD_BY_APP` in `packages/ui/audio.js` (`preload()` with no arguments uses it):

| App | Preload immediately after `createAudioManager` | Lazy (loaded on first request) |
|---|---|---|
| participant | draw_reveal, cell_match, bingo, float_launch, float_countdown, draw5_unlock | registration_ready, soul_reveal, error_soft |
| public | ambient_galaxy, draw_reveal, bingo, float_launch, draw_leadin, draw5_unlock | error_soft, reconnect |
| stage | ambient_galaxy, draw_reveal, bingo, float_launch | reconnect, error_soft |
| admin | draw_reveal, bingo | draw_leadin, error_soft, reconnect |

Preload may run before the user gesture (fetch + decode work in a suspended context) so the first cue after `unlock()` is instant. A cue requested before it is loaded returns `false`, emits its caption with `reason: 'not-loaded'` and starts loading for next time.

## 7. Mute, volume and autoplay policy

- **Participant (employee mobile):** audio is silent until the first user gesture. The app calls `unlock()` from the "Join the event" / "Start building my board" tap (or a sound toggle). No sound control is required beyond a mute toggle; mute/volume persist in `localStorage` under `ariskill-skill-bingo:audio:participant`.
- **Admin, public, stage:** master mute and master volume controls are mandatory (requirement 10) and persist per app (`ariskill-skill-bingo:audio:<app>`). Public/stage operators click once on the presenter screen to unlock; `startAmbient()` is called only after `unlock()` resolves `true`.
- **Autoplay denied** (`unlock()` resolves `false`, `state().autoplayDenied === true`): nothing plays, no error is shown to employees; presenter apps may show a small "Click to enable sound" affordance and call `unlock()` again on the next gesture. Captions continue to fire.
- **No AudioContext / construction failure** (E14): `state().supported === false`; every method returns safely; the app shows `exceptions.E14` copy "Sound is unavailable on this device." once, at most, in the settings/mute control - never as a blocking toast.
- Mute is a gain ramp (50 ms) on the master bus, so toggling never clicks.

## 8. Silent mode and caption/visual equivalents

The AudioManager emits `onCaption({ id, caption, played, reason, delayMs })` for **every accepted play request**, including when muted, locked, denied, unsupported or unavailable (`played: false`). Apps route it to a polite `aria-live` region and/or a small caption chip so silent-mode users get the same timing feedback. Rate-limited, stale and replayed requests emit nothing (they would only add clutter).

| Cue | Visual equivalent (already required by the flow/motion specs) | Caption |
|---|---|---|
| ambient_galaxy | Galaxy scene drifting; the bed carries no state | "Galaxy ambience playing" (announced once when the bed starts) |
| registration_ready | Board completion glow (<= 800 ms) and `board.complete` | "Your Skill Bingo is ready!" |
| draw_leadin | Admin: `admin.nextSkillPending` "Drawing..."; public: pre-reveal shimmer | "Drawing the next skill" |
| draw_reveal | Skill card reveal + live-region "Draw {number}: {skill}" | `play.draw` |
| cell_match | Matching cell glow/pulse; final matched state persists | `play.matched` |
| draw5_unlock | `play.evaluationActive` / `public.playing.live` replaces the pacing label | "Bingo is live" |
| bingo | Line traced once; Winner view burst; `result.bingo` / `public.winner.title` | "Bingo detected" |
| soul_reveal | Staged reveal (1.5-2.5 s, skippable) with `soul.ready` | "Your Soul is ready to join Arise." |
| float_countdown | On-screen 3 -> 2 -> 1 digits are authoritative | `soul.countdown` |
| float_launch | Launch acknowledgment + `soul.floated`; public Soul entrance | "Your Soul is in the Galaxy" |
| error_soft | The E-code toast/banner text itself | "Notice: see message" |
| reconnect | E12 banner over the retained last frame | `reconnect` |

`caption(id, vars)` returns the copy-catalog text when the app injects `translate: t` from `packages/contracts` (e.g. `caption('draw_reveal', { number: 7 })` -> "Draw 7"), otherwise the plain text above. `copy.json` is not modified by this stage.

## 9. Missing-file and failure behaviour

| Failure | Behaviour |
|---|---|
| 404 / network error on a WAV | cue marked `unavailable`; `play()` returns false and emits the caption with `reason: 'unavailable'`; no retry storm (one lazy retry per explicit request) |
| Decode error (corrupt/unsupported file) | same as above |
| Manifest fetch fails | embedded `CUES` policy is used; loop falls back to `0..buffer.duration` (identical to the manifest for this asset) |
| `AudioContext` construction throws | `supported` stays true but `state().lastError === 'context'`; all methods return false |
| Any internal exception | caught; method returns false/undefined; `state().lastError` set; nothing propagates to the app |
| Checksum drift | `python3 tools/assets/build-audio.py --check` and the test suite fail the build |

## 10. Venue output notes

- Programme level: the bed sits 8 dB under the one-shots so a venue PA can be set for comfortable reveals while the bed stays background; expect about -24 dBFS bed / -16 dBFS cues at master volume 1.0. Set the public screen's master volume between 0.6 and 0.8 on a PA with its own limiter; keep the stage dashboard's master at or below 0.5 (it usually shares a room with the PA) or muted.
- All cues are mono and band-limited (bed <= 3 kHz, cues <= 7 kHz) so they translate on ceiling speakers, laptop speakers and phones alike; nothing relies on stereo image or sub-bass (lowest partial 55 Hz, low gain).
- No cue exceeds -1 dBFS true peak in the file; with the master bus at <= 1.0 and a single-voice bed, the summed output cannot clip unless the venue mixer adds gain. Bingo and float_launch are peak-limited and never stack more than 4 voices.
- Rehearsal check: play `bingo` and `float_launch` at venue level and confirm the PA limiter does not engage; walk the room during `ambient_galaxy` to confirm it is felt, not heard.
- Phones: cues are audible through a phone speaker at 50 % volume; the 1.6 kHz `cell_match` tick was chosen for phone-speaker efficiency.

## 11. Licence and provenance

- Every file in `assets/audio` is synthesised by `tools/assets/build-audio.py` from `assets-src/audio/cues.json` (numpy, fixed seed 20260922). No recorded, sampled, downloaded or third-party material is used; no external tool is required.
- Licence: `internal-original` (decision D-14). Manifest records `generator_script`, `generator_version 1.0.0`, `source_file`, `checksum sha256`, `license`, `approved_by: null` per cue and at the top level.
- Reproducibility: two consecutive runs produce byte-identical WAVs and manifests (verified with `shasum -a 256`). Regenerate after editing `cues.json`; commit the source, the generator and the outputs together.

## 12. AudioManager integration guide (`packages/ui/audio.js`)

```js
import { createAudioManager, PRELOAD_BY_APP } from '/packages/ui/audio.js';
import { t } from '/packages/contracts/index.js';

const audio = createAudioManager({
  app: 'participant',                 // participant | admin | public | stage
  baseUrl: '/assets/audio',
  manifestUrl: '/assets/manifest/audio.json',
  clockNow: () => Date.now() + serverOffsetMs,   // E7 corrected server clock
  translate: t,
  onCaption: ({ id, caption, played }) => liveRegion.textContent = caption,
});
audio.preload();                       // PRELOAD_BY_APP[app]; safe before the gesture
joinButton.addEventListener('click', async () => { await audio.unlock(); });
```

API (all methods are exception-safe and return `false`/safe values instead of throwing):

| Method | Purpose |
|---|---|
| `unlock(): Promise<boolean>` | Call inside a user gesture; resumes the context. `false` -> `state().autoplayDenied` |
| `preload(ids?): Promise<available>` | Fetch + decode; failures mark `unavailable` |
| `play(id, { at, gainDb, vars, fresh, sequence }): boolean` | One-shots only. `at` (ms or ISO, server time) schedules via `clockNow`; `fresh:false`/`sequence <= epoch` never play |
| `startAmbient() / stopAmbient()` | Seamless loop with manifest loop points, 1.5 s fade in, 0.8 s fade out |
| `duck(db, ms)` | Manual ambient duck (bingo/float_launch duck automatically) |
| `setMuted(bool) / setMasterVolume(0..1)` | Persisted per app in localStorage |
| `setReplaying(bool) / setConnectionEpoch(sequence)` | Reconnect guards |
| `onCaption(fn) -> unsubscribe` | Visual/live-region equivalents |
| `caption(id, vars)` | Caption text (copy catalog via `translate`, else plain text) |
| `state()` | `{ supported, unlocked, muted, volume, autoplayDenied, available, ambientPlaying, replaying, activeVoices, epoch, lastError }` |
| `dispose()` | Stops everything and closes the context |

### Event -> cue mapping per app

| App | Event / moment | Call |
|---|---|---|
| participant | `board.ready` | `play('registration_ready')` |
| participant | `draw.accepted` | `play('draw_reveal', { vars: { number } })`; if `myMatchedPositions.length` -> `play('cell_match')`; if `draw.number === 5` -> `play('draw5_unlock')` (with `play.evaluationActive` copy shown) |
| participant | `bingo.detected` (or `result.published` when missed) | `play('bingo')` once per roundId |
| participant | `soul.created` / reveal screen opened | `play('soul_reveal')` once per soulId |
| participant | Float countdown steps at server times T-3, T-2, T-1 | `play('float_countdown', { at })` per visible step |
| participant | `soul.float_accepted` for own soulId | `play('float_launch')` |
| participant | any E-code toast | `play('error_soft')` |
| admin | Next Skill pressed (awaiting draw) | `play('draw_leadin')` |
| admin | `draw.accepted` | `play('draw_reveal', { vars: { number } })` |
| admin | `bingo.detected` | `play('bingo')` |
| admin | E-code / E10 | `play('error_soft')`; reconnecting -> `play('reconnect')` |
| public | first presenter click | `unlock().then(ok => ok && startAmbient())` |
| public | `draw.accepted` | optional `play('draw_leadin')` then `play('draw_reveal')` at the card flip; `draw.number === 5` -> `play('draw5_unlock')` |
| public | `bingo.detected` | `play('bingo')` (bed ducks 8 dB for 2 s) |
| public | `soul.float_accepted` (each new soulId) | `play('float_launch')` |
| public | E12 reconnecting | `play('reconnect')`; snapshot/backlog apply -> `setReplaying(true/false)` |
| stage | same as public minus `draw_leadin`; master volume defaults low | |

All apps: on reconnect call `setConnectionEpoch(lastAppliedSequence)` before applying the backlog, or pass `fresh: false` for replayed events. Never call `play` for events that only restore state.

## 13. Verification

| Command | Result |
|---|---|
| `python3 tools/assets/build-audio.py` (x2) + `shasum -a 256` diff | identical bytes across runs |
| `python3 tools/assets/build-audio.py --check` | outputs up to date |
| `node --test tools/assets/test/audio.test.js` | 19/19 pass |
| `node --check packages/ui/audio.js` | ok |
| `ls -la assets/audio` | 12 files, 688 488 bytes |

Hard checks (workflow 11): decodable PCM WAV in every supported browser (plain 16-bit PCM, no codec); duration/size/loudness budgets pass; loop points valid and seam-tested; no cue is the sole carrier of information (section 8); rapid events bounded (section 4); autoplay-denied, mute, missing-file and venue cases specified and unit-tested (sections 7, 9, 10).

## 14. Open items for the audio owner

- Listening sign-off at venue level (sets `approved_by`).
- Optional: give the three Float ticks rising pitches (would add two small files; the single-file approach was chosen so the visual countdown stays the only clock).
- Optional: a distinct public-screen "round complete, no Bingo" cue (E23); currently silent by design, copy carries it.

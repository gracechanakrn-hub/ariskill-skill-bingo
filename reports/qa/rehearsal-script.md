# Event rehearsal script (workflow 17.3, requirement 18.2)

Run `run-20260922-113339`. Run the full script on the actual venue equipment with the production-like network. Tick each item, note the observer, time and any deviation. Any unchecked critical item = no-go (17.4).

Preparation: production-like deploy with real secrets (`BINGO_ADMIN_TOKEN`, `BINGO_STAGE_TOKEN`, `BINGO_JOIN_SECRET`, `BINGO_SESSION_SECRET`, no `BINGO_RNG_SEED`), `ops/runbook.md` at hand, seeded fixture available for the deterministic segment (staging instance with `BINGO_RNG_SEED=fixture-1`, see `tests/fixtures/seeded-round.json`).

## Joining

- [ ] Rate limit on the venue network (EO-03): 10 phones join within 60 s; `BINGO_SESSION_RATE_PER_MIN` and `BINGO_TRUST_PROXY` recorded per `ops/release-checklist.md`.

- [ ] Scan the public QR from at least three phone classes (lower-end Android, older iPhone, current iPhone) and one in-app browser; all reach `/play` with a valid token.
- [ ] Expired link (old QR) shows E2 and rescanning works.
- [ ] Platform and Role start empty; discovery is blocked with E16 until both are chosen.

## Boards and lock

- [ ] Complete a 25-skill board on a phone (duplicate rejected E4, 26th rejected); finalize shows READY and a 5 x 5 board.
- [ ] Edit after READY returns to DRAFT and re-finalize re-randomizes.
- [ ] Lock boundary: one phone saves at 00:02 (accepted), one at 00:00 (E8); the countdown reaches 00:00 and the round locks but does not start.
- [ ] Late / incomplete board: one phone with 20 skills at lock receives the E5 deferred message; a phone joining after lock saves its draft, sees the E8 notice (board DEFERRED, reason late) and finds the draft in the next round once registration opens.
- [ ] Admin readiness shows pool size >= 5 and boards that can win; start with pool < 5 is refused (E20) on a staging round.

## Seeded draw sequence (staging with `BINGO_RNG_SEED=fixture-1`)

- [ ] Replay the fixture: draw order matches `expected.draws`, no Bingo before draw 5, winner on draw 28, co-winners fixture-001 + fixture-002 (`node --test tests/e2e/seeded-round.test.js` passes on the same build).
- [ ] Both co-winners are shown on public, stage and admin; the non-consented one appears as `Soul #NNNN` and the same label is shown on that player's phone (`participant.publicLabel`) so the MC can verify the winner (EO-02).

## Admin resilience

- [ ] Duplicate Next Skill click (double-click and two admin tabs): exactly one draw, the other shows E10 and refreshes.
- [ ] Admin refresh mid-round restores Mission Control from the snapshot.
- [ ] Wi-Fi loss on the admin device during pending draw: retry with the same key returns the same draw.
- [ ] Public display refresh (F5) mid-round comes back with the correct state and no replayed celebration.

## Audio / renderer / motion

- [ ] Audio muted and autoplay denied on the public device: game continues silently; unlock by tap works; captions visible.
- [ ] Primary renderer failure (WebGL disabled): Canvas 2D fallback keeps the Galaxy and info panel; static fallback when Canvas fails.
- [ ] Reduced-motion mode on a phone and on the public device: reduced variants, no flashes.

## Souls and Float

- [ ] Every finished board receives a Soul; winners carry the star badge; Soul config has no rank traits.
- [ ] Float from a phone: one entrance on the public Galaxy; double-tap / replayed request returns the original (no second entrance).
- [ ] Non-consented Soul enters without a label.

## Round end and recovery

- [ ] Cancellation with reason: players see E15, boards deferred, public shows the cancelled notice, next round reassigns drafts.
- [ ] Exhausted pool on a small staging round: EXHAUSTED notice, Souls still granted.
- [ ] Reconnect / waiting-state recovery: phone in airplane mode for 2 minutes during play, then back: correct board state, no duplicate celebration, snapshot refetch when far behind.
- [ ] Next-round recovery: result window closes automatically (10-15 s), next round opens, previous winners shown on public.
- [ ] Cancel a DRAFT next round while a round is playing (staging): public and stage keep showing the playing round (DEF-02 fixed; regression covered by `tests/e2e/public-stage-views.test.js`).

## Stage and narration

- [ ] Stage dashboard is read-only, never shows the join link, shows insights with cohort suppression explained.
- [ ] Winner-name policy narrated as displayed (consented names only).
- [ ] Aggregate insight explanation script agreed with the presenter.

## Operations

- [ ] Backup/restore of `data/bingo.sqlite` rehearsed; rollback per `ops/rollback.md`; contact tree on paper.
- [ ] Spare display device with cached assets swapped in within 2 minutes.

Observers: __________________ Date: __________ Decision (go / no-go): __________

## Added after critique round 1 (EO-03, EO-02)

- [ ] Venue join-rate check: 10 phones scan and join within 60 s on the venue network; none receives a 429. Record `BINGO_SESSION_RATE_PER_MIN` and `BINGO_TRUST_PROXY` values used.
- [ ] Winner verification drill: a non-consented winner shows the MC the "Shown on the public screen as Soul #NNNN" line on their phone; MC confirms it matches the stage/admin label.
- [ ] Stage WINNER window: co-winner names and the recent-draws list remain visible for the whole result window (VM-01 regression check).

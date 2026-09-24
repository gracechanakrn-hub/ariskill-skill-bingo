# AriSkill Skill Bingo - Product and Technical Requirements

**Status:** Build-ready v1 specification  
**Decision state:** Passes 1-3 locked by the product owner (`labibi`); later design and implementation details are recommended v1 defaults unless explicitly marked open.  
**Product form:** Responsive, synchronized web experience with four interfaces sharing one authoritative game state.

## 1. Product Summary

AriSkill Skill Bingo turns employee-selected skills into a live event game and a shared visual artifact. Each employee actively selects 25 unique skills, the service randomizes those skills into a 5 x 5 board, and an event administrator triggers random draws from eligible Core and Critical Skills. Matches are applied automatically. From draw five onward, the service checks all active boards; everyone who completes a valid line on the same winning draw is a co-winner. After the round, every participant receives an Arise Soul based on their selections and may launch it into the persistent public Arise Galaxy.

The experience has four coordinated interfaces:

1. **Employee mobile:** join, identify Platform and Role, select all 25 skills, play, see results and Role Skill Matrix insight, reveal a Soul, and launch it.
2. **Admin portal:** configure and operate rounds, monitor readiness, trigger server-randomized draws, handle cancellation, and inspect event analytics.
3. **Public event screen:** keep the Arise Galaxy alive while showing Waiting, Playing, and Winner information.
4. **Stage dashboard:** give the presenter a distance-readable view of round status, participation, winners, and the aggregate skill insights named in the approved concept.

## 2. Goals and Non-Goals

### 2.1 Goals

- Make skill discovery playful while preserving honest employee self-selection.
- Create a fair, synchronized live Bingo round that does not rely on manual cell marking.
- Connect the event back to AriSkill through Role Skill Matrix comparison without treating the game as capability evidence.
- Build a cumulative event spectacle through the Arise Galaxy and Ready to Float interaction.
- Give event operators clear, safe controls and recovery paths.
- Generate useful aggregate skill intelligence without exposing personal skill gaps publicly.

### 2.2 Non-goals for v1

- No native iOS or Android application; mobile is responsive web.
- No employee manual marking of matched cells.
- No admin choice of the next skill; the admin only triggers a server-side random draw.
- No joining an active round after its lock time.
- No skill assessment, verification, ranking, or performance-management use.
- No competitive ranking based on Role Skill Matrix alignment.
- No automatic profile update in the AriSkill system of record.
- No profile-derived Platform/Role prefill and no bulk or one-tap acceptance of 25 suggested skills; the employee makes each selection.
- No employee development recommendations beyond the post-round comparison summary.
- No separate event-analyst role or analytics export.
- No admin-only public-screen blackout/freeze control; cancellation and reconnect behavior use the normal round states.
- No global keyboard shortcuts; v1 uses standard, focused keyboard interactions only.
- No photorealistic or gameplay-critical 3D physics.

## 3. Personas and Permissions

| Persona | Primary job | Access |
|---|---|---|
| Employee / player | Create a board, follow the round, reveal and launch a Soul | Own participant, board, result, and Soul only |
| Event admin / MC | Operate a round safely and pace the live experience | Authorized event and round controls; aggregate counts; winner display names |
| Stage presenter | Explain what is happening and narrate insights | Read-only live stage dashboard |
| Public audience | Watch the Galaxy and round | Anonymous, privacy-safe public projection |

## 4. Canonical Experience Flow

### 4.1 Employee mobile

`Scan event QR -> Join session -> Select Platform -> Select Role -> Select 25 unique skills -> Board randomized and saved -> Countdown -> Board locks -> Automatic matching -> Result -> Soul reveal -> Matrix insight -> Ready to Float -> Soul joins Galaxy`

Optimizations:

- Skill discovery is divided into **Recommended for Your Role**, **Popular at Arise**, and **Search All Skills**.
- Employees explicitly select Platform and Role, then actively choose every skill. Profile data does not prefill either field, and there is no one-tap option to accept 25 suggested skills.
- Tapping a skill fills the next selection slot; the server shuffles board positions at completion.
- Show persistent progress such as `17 / 25 skills selected`, selected chips, undo/remove, and search.
- Allow skill edits until the round locks. Re-randomize only after an explicit board change and save.
- If no round is open, retain the draft and show the next scheduled round when available.
- Mobile should remain understandable with sound off and under unstable event Wi-Fi.

### 4.2 Admin round control

`Create round -> Set registration lock time -> Open registration -> Monitor joined/completed -> Countdown reaches 00:00 and locks -> Admin starts manually -> Trigger Next Skill -> Server draws -> Automatic match/Bingo evaluation -> Results window -> Prepare next round`

The countdown reaching `00:00` closes registration and moves the round to `LOCKED`; it does not start play or draw a skill. The admin then starts the round manually, normally within the recommended 60-second operating window. Before `00:00`, the separate `Start Now` action requires confirmation and atomically locks eligible boards before entering `PLAYING`. The admin's `Next Skill` action requests a draw; it never contains a skill identifier. Manual pacing is the only v1 draw mode.

### 4.3 Public event screen

- **Left 65%:** persistent, ambient Arise Galaxy in every public state.
- **Right 35%:** event information mapped to three simple states:
  - Waiting: next round, synchronized countdown, QR code, previous winners.
  - Playing: draw number, skill type/name, matched count, pacing message.
  - Winner: co-winner names and round number for 10-15 seconds, then Waiting.
- If the primary Galaxy renderer cannot run, switch to a visually consistent 2D particle/Soul fallback without blocking the game.

### 4.4 Stage dashboard

The stage dashboard is read-only and optimized for distance and narration. It shows:

- round status;
- synchronized countdown or current draw;
- joined, completed, active, and matched counts;
- winner list and result timing;
- privacy-safe aggregate insights: top selected skills, Core/Critical density, Platform/Role engagement, Role Skill Matrix alignment, and skills beyond the current matrix.

It must not duplicate the public spectacle or display individual gaps.

## 5. Functional Requirements by Interface

### 5.1 Employee mobile

| ID | Requirement |
|---|---|
| M-01 | Resolve the event from a signed QR/deep link and display event and round status. |
| M-02 | Require the employee to explicitly select Platform and Role before skill selection; do not prefill either value from a profile. |
| M-03 | Load skill recommendations, popular skills, and searchable Skill Master results. |
| M-04 | Permit exactly 25 unique, active skill selections; duplicate taps do not change state. |
| M-05 | Save drafts incrementally and reconcile local unsaved changes after reconnection. |
| M-06 | Ask the server to create a randomized 5 x 5 board after the 25th selection. |
| M-07 | Permit editing until the server lock time and clearly show the synchronized countdown. |
| M-08 | Render accepted draw events and automatically mark all matching cells. |
| M-09 | Show that Bingo evaluation is locked for draws 1-4 and active from draw 5. |
| M-10 | Show winner/non-winner result without implying employee capability. |
| M-11 | Reveal a Soul derived from selected-skill categories using cosmetic, non-ranking rules. |
| M-12 | Show Role Skill Matrix match count and beyond-matrix count privately. |
| M-13 | Use a one-use Float token to synchronize the mobile launch with a new public Soul entrance. |

### 5.2 Admin portal

| ID | Requirement |
|---|---|
| A-01 | Create, schedule, open, lock, manually start, cancel, and close a round subject to the state machine; reaching `00:00` locks but never starts the round, while confirmed `Start Now` explicitly locks and starts early. |
| A-02 | Show joined, completed, incomplete, active, draw, match, and connection counts. |
| A-03 | Validate that the draw pool contains at least five skills and report whether any active board has a mathematically possible winning line. |
| A-04 | Trigger a random draw through an idempotent command with visible pending/success/failure state. |
| A-05 | Prevent duplicate or stale commands by command ID and expected state/version. |
| A-06 | Show all co-winners generated by the accepted winning draw. |
| A-07 | Require a reason for cancellation and propagate a clear message to clients. |
| A-08 | Keep Mission Control separate from aggregate Insights. |
| A-09 | Write an audit entry for every control action, accepted/rejected command, draw, and state transition. |

### 5.3 Public event screen

| ID | Requirement |
|---|---|
| P-01 | Render the Galaxy continuously across Waiting, Playing, and Winner states. |
| P-02 | Display an event-scoped QR code and next-round countdown while registration is open. |
| P-03 | Display only server-accepted draws and aggregate matched counts. |
| P-04 | Display all same-draw co-winners using approved display names. |
| P-05 | Animate a valid one-use Float event once, then settle the Soul into the Galaxy. |
| P-06 | Recover from disconnection using the last confirmed snapshot, a reconnect indicator, and state resynchronization. |
| P-07 | Provide a 2D fallback and a static reduced-effects mode. |

### 5.4 Stage dashboard

| ID | Requirement |
|---|---|
| S-01 | Present the approved round and aggregate insight information in a live, large-format view. |
| S-02 | Show synchronized round status, participation, and current draw/matches. |
| S-03 | Present winner and aggregate insight views without personal skill details. |

## 6. Business Rules

Each rule includes its failure behavior or states why it cannot fail independently at runtime.

| ID | Rule | Failure handling / non-failing reason |
|---|---|---|
| BR-01 | A participant explicitly selects Platform and Role before building a board. | Missing selection blocks skill selection and uses E16; profile values are never silently substituted. |
| BR-02 | A board contains exactly 25 unique skills, all actively chosen by the employee. | Duplicate input uses E4; fewer than 25 at lock uses E5; finalization rejects any other count. |
| BR-03 | Skills may be discovered through role recommendations, popularity, or Skill Master search. | If discovery data cannot load, use E17, preserve the draft, and retry; no synthetic skills are inserted. |
| BR-04 | The server, not the client, randomizes selected skills into the 5 x 5 board. | Finalization failure uses E18 and preserves the 25 selections; client-supplied positions are ignored. |
| BR-05 | A participant may edit until the authoritative lock time; `00:00` locks but never starts play, while confirmed admin `Start Now` may lock and start early. | A save accepted after lock is rejected without mutation and uses E8; an unconfirmed early-start request has no effect. |
| BR-06 | At lock, a complete board enters the round; an incomplete board is saved for the next eligible round. | This is a total decision over 0-25 selections: complete becomes `LOCKED_ACTIVE`; every incomplete board becomes `DEFERRED` and uses E5. |
| BR-07 | Locking all eligible boards is atomic from the round's point of view. | If the lock transaction fails, no board changes state; the elapsed `lock_at` still rejects further player edits, and the admin uses E19 to retry or cancel. |
| BR-08 | The draw pool is the unique set of active **Core or Critical** Skills present on at least one locked board. | Start is blocked if the pool has fewer than five skills; the admin uses E20 and may reschedule or cancel. |
| BR-09 | A skill may be drawn at most once per round. | Durable-store uniqueness and idempotency reject a duplicate; clients retain the last accepted draw and the admin receives E10 for a stale command. |
| BR-10 | An unbiased server-side random selection chooses from the remaining eligible pool. | If selection or persistence fails, the command accepts no draw, emits no event, and uses E21 so the admin can retry. |
| BR-11 | Client taps never mark cells; accepted draw events determine matches. | Unauthorized local changes have no server effect and are replaced by the next authoritative snapshot. |
| BR-12 | Bingo evaluation starts on draw five. | This is deterministic from the accepted draw number; draws 1-4 cannot invoke winner persistence and are covered by automated boundary tests. |
| BR-13 | Valid lines are the five rows, five columns, and two corner-to-corner diagonals. | The fixed 12-mask set has no runtime choice; any evaluator error aborts the draw transaction under E21. |
| BR-14 | All participants completing at least one line from the same winning draw are co-winners. | Evaluation occurs across all active boards in one transaction; any partial computation aborts the draw under E21. |
| BR-15 | The winning draw atomically closes further drawing and fixes the winner set. | A concurrent or later draw is rejected as stale under E10; a transaction failure publishes neither draw nor winners under E21. |
| BR-16 | Every completed participant receives a Soul, whether they win or lose. | Soul creation is idempotently retried; the employee sees E22 until creation succeeds. |
| BR-17 | A Bingo Star is cosmetic. Matrix alignment must not change Soul quality, size, strength, brightness, or perceived status. | This is an asset/schema invariant checked before release; an invalid cosmetic mapping is rejected and falls back to the neutral Soul treatment. |
| BR-18 | Public and stage views receive only privacy-safe projections of the authoritative state. | A projection failing its allowlist/redaction contract is not served; log and alert the incident while retaining the last safe snapshot. |
| BR-19 | All timers derive from server time and include server/client clock-offset correction. | Loss of usable synchronization uses E7; the client shows syncing and does not infer a local lock/start transition. |
| BR-20 | Round control requires authorization, audit logging, idempotency, and optimistic state/version checks. | Unauthorized control uses E9; duplicate/stale control uses E10; no rejected command mutates the round. |

## 7. State Models

### 7.1 Authoritative round state machine

| State | Entry | Allowed commands | Exit |
|---|---|---|---|
| `DRAFT` | Round created | update schedule/config, open, cancel | `REGISTRATION_OPEN`, `CANCELLED` |
| `REGISTRATION_OPEN` | Registration opened | reschedule, lock-now, confirmed start-now, cancel | `LOCKED`, `PLAYING`, `CANCELLED` |
| `LOCKED` | Lock time reached or lock-now accepted | start, cancel | `PLAYING`, `CANCELLED` |
| `PLAYING` | Start accepted from `LOCKED`, or confirmed start-now accepted from `REGISTRATION_OPEN` | draw-next, cancel | `WINNER`, `EXHAUSTED`, `CANCELLED` |
| `WINNER` | Accepted draw creates one or more winners | none; server closes after the configured result window | `CLOSED` |
| `EXHAUSTED` | Pool empty without a winner | close, cancel with reason | `CLOSED`, `CANCELLED` |
| `CLOSED` | Results finalized | none; create another round separately | terminal |
| `CANCELLED` | Authorized cancellation | none; drafts may be reassigned | terminal |

The transition transaction for `draw-next` must: verify `PLAYING` and version, choose one remaining skill, persist the draw, compute matches, evaluate all boards if draw number >= 5, persist the complete co-winner set, increment the round version, and emit events only after commit.

### 7.2 Board state

| State | Meaning |
|---|---|
| `DRAFT` | 0-24 unique selections or editable completed selection |
| `READY` | 25 selections, randomized grid saved, registration still open |
| `LOCKED_ACTIVE` | Complete at round lock and included in draw/evaluation |
| `DEFERRED` | Incomplete or arrived after lock; preserved for a future round |
| `FINISHED` | Active round ended; immutable game record |

### 7.3 Public presentation mapping

| Round state | Public state | Stage focus |
|---|---|---|
| `DRAFT`, `REGISTRATION_OPEN`, `LOCKED`, `CLOSED` | Waiting | schedule/readiness/insights |
| `PLAYING` | Playing | draws and counts |
| `WINNER` | Winner | co-winners and result timing |
| `EXHAUSTED` | Waiting with round-complete notice | no-winner outcome and next round |
| `CANCELLED` | Waiting with cancellation notice | reason and next action |

## 8. UI, Copy, and Interaction Specification

### 8.1 Provisional design-system decisions

The existing AriSkill design system was not available for inspection. The following are **provisional** and must be mapped to verified brand tokens/components before visual sign-off:

- all interface names, section labels, button labels, and copy in this document are working names pending content/design-system review; they do not create new product scope;
- deep-space neutral background; luminous accent colors assigned consistently to Core and Critical Skills;
- geometric sans-serif typography with tabular numerals for countdowns;
- 8 px spacing rhythm, 44 x 44 px minimum touch targets, and high-contrast focus rings;
- rounded skill chips, flat operational admin surfaces, and cinematic public-display surfaces;
- semantic colors never used as the only status signal;
- public/stage typography sized and tested for the actual venue viewing distance.

### 8.2 Key copy

| Situation | Copy |
|---|---|
| Board complete | `Your Skill Bingo is ready!` |
| Waiting | `Your board will lock when the countdown reaches 00:00.` |
| Deferred | `Registration for this round is closed. Your board is saved for the next round.` |
| Draws 1-4 | `Bingo unlocks next draw` |
| Result | `Bingo detected` / `Round complete` |
| Soul action | `Your Soul is ready to join Arise.` / `READY TO FLOAT` |
| Reconnect | `Reconnecting to the Skill Galaxy...` |

### 8.3 Exception and recovery copy

| ID | Trigger | User-facing copy | Recovery / behavior |
|---|---|---|---|
| E1 | No active/upcoming round | `The next Skill Bingo hasn't been scheduled yet.` | Keep the draft; refresh automatically while the page remains open, or return later |
| E2 | QR/session expired | `This event link has expired. Scan the event QR code again.` | Reject token; rescan |
| E3 | Platform/Role load failed | `We couldn't load your role options.` | Retry; retain session |
| E4 | Duplicate skill | `You already added this skill.` | No state change |
| E5 | Fewer than 25 at lock | `Registration for this round is closed. Your board is saved for the next round.` | Mark `DEFERRED` |
| E6 | Save failed | `Your latest skill wasn't saved. Try again.` | Keep local draft; retry/reconcile |
| E7 | Clock correction | `Syncing with the event...` | Replace local time with server time |
| E8 | Late arrival | `This round is already in progress. Your board will join the next round.` | Assign next eligible round |
| E9 | Unauthorized admin | `You don't have permission to control this event.` | Reject and audit |
| E10 | Stale admin command | `The round changed before this action completed. Mission Control has been refreshed.` | Refresh snapshot |
| E11 | Pool exhausted | `No eligible skills remain. End or cancel this round.` | Disable draw |
| E12 | Public connection lost | `Reconnecting to the Skill Galaxy...` | Retain last confirmed frame |
| E13 | Float failed | `Your Soul is ready, but couldn't launch yet.` | Retry same unconsumed token |
| E14 | Audio unavailable | `Sound is unavailable on this device.` | Continue visually |
| E15 | Round cancelled | `This round was cancelled. Your board is saved for the next round.` | Unlock/reassign eligible drafts |
| E16 | Platform or Role missing | `Choose your Platform and Role to start building your board.` | Keep skill selection unavailable until both are explicitly selected |
| E17 | Skill discovery unavailable | `We couldn't load the Skill Master. Your selections are safe.` | Preserve the draft and retry loading |
| E18 | Board finalization failed | `We couldn't build your board yet. Your 25 skills are saved.` | Retry server randomization; do not accept client positions |
| E19 | Round lock failed | `The round couldn't finish locking. Player edits are closed.` | Keep the prior version, reject edits after `lock_at`, and let the admin retry or cancel |
| E20 | Round not ready to start | `This round needs at least five eligible skills before it can start.` | Keep the round locked; reschedule or cancel |
| E21 | Draw transaction failed | `The next skill wasn't drawn. Try again.` | Commit and publish nothing; retry with the same idempotency key |
| E22 | Soul creation delayed | `Your Soul is still forming. We'll keep trying.` | Retry idempotently and keep the result view available |
| E23 | Pool exhausted without a winner | `Round complete. No Bingo this time.` | Close the round and show the next-round Waiting state |

## 9. Art Direction, Scene, and Character

### 9.1 Theme

The event is a warm, optimistic skill cosmos: individual selections form a distinct Soul, and many Souls create one Arise Galaxy. The visual hierarchy should favor belonging and discovery over competition. Avoid combat, rarity tiers, leaderboards, or visual language that implies some roles are more valuable.

### 9.2 Public Galaxy scene

- Use layered depth: slow star field, soft nebula volumes/gradients, orbital paths, Souls, and a restrained foreground glow.
- Keep the right-side information panel readable; visual effects must not cross its safe zone.
- Camera motion is slow and bounded. No uncontrolled spin, rapid parallax, or camera shake.
- New Souls enter from a stage-configured edge, follow a short arc, briefly pulse, then join a stable orbit.
- Crowd density uses level of detail, instancing/batching where available, and aggregate clusters at high counts.
- Provide renderer quality levels plus a technology-neutral 2D fallback. The public display remains functional if the primary Galaxy renderer fails.

### 9.3 Arise Soul character system

- A Soul is an abstract, friendly, inclusive figure or luminous companion, not a literal assessment avatar.
- A stable seed derived from the Soul record selects cosmetic traits so the same Soul renders consistently.
- Selected-skill categories may influence constellation points, orbiting glyphs, or accent distribution, but not perceived strength or rank.
- Platform/Role must not determine body shape, size, status, skin tone, gender expression, or quality.
- The Bingo Star is a small, optional round badge with an accessible text equivalent.
- Asset package for each character component: source file, optimized runtime model in a format selected after the existing web stack is verified, textures, material definition, LOD/fallback sprite, thumbnail, license/provenance, bounds/pivot, geometry/texture budget, and checksum.

## 10. Sound Design

Sound supports pacing and feedback but never carries required information.

| Cue | Purpose | Constraints |
|---|---|---|
| Ambient Galaxy bed | Calm continuity | Seamless loop, low spectral density, venue-safe level |
| Registration ready | Confirm completed board | Short, warm, non-alarming |
| Draw reveal | Focus attention | Distinct lead-in and reveal; no speech dependency |
| Cell match | Personal feedback | Very short, rate-limited to avoid clutter |
| Draw 5 unlock | Signal rule change | Paired with visible copy |
| Bingo | Celebrate result | One sting; duck ambient bed; avoid painful peaks |
| Soul reveal | Emotional transition | Gentle rising motif |
| Float countdown/launch | Synchronize phone and screen | Visual countdown remains authoritative |
| Error/reconnect | Optional feedback | Subtle; never resemble success cue |

Requirements:

- Master mute and volume controls for admin/public/stage; employee audio starts muted until user interaction if required by browser policy.
- Normalize and peak-limit files; document loop points and target loudness during audio integration.
- Provide captions/text/visual equivalents for every meaningful cue.
- Preload time-critical cues and degrade silently if an asset fails.
- Secure usage rights and record source/license metadata.

## 11. Motion and Micro-animation

| Interaction | Motion |
|---|---|
| Add/remove skill | 120-180 ms scale/fade with stable layout |
| Board completion | Short ordered glow across the grid, <= 800 ms |
| Board lock | Border seal and lock label, <= 400 ms |
| Draw arrival | Skill card reveal followed by matching-cell highlights |
| Match | 200-350 ms glow/pulse; final state remains visible |
| Bingo line | Trace the completed line once; do not loop |
| Winner view | Restrained celebratory burst; readable within 1 second |
| Soul reveal | 1.5-2.5 second staged reveal, skippable after first view |
| Float | `3 -> 2 -> 1 -> FLOAT`, launch acknowledgment, public entrance |

Motion rules:

- State changes do not wait for animation completion.
- Replayed/resynchronized events set the correct final visual state without replaying old celebration.
- Respect `prefers-reduced-motion`: replace travel, parallax, bursts, and orbit motion with fades/static composition.
- Avoid flashing above accessibility thresholds and test for photosensitive risk.
- Use server event timestamps for coordinated cues; animation may interpolate locally but cannot invent game state.

## 12. Privacy, Safety, and Accessibility

### 12.1 Privacy and data handling

- Collect only identity/session, Platform, Role, selected skills, board positions, round result, and Soul cosmetics required for the experience.
- Publish approved display name or anonymized alias only with event policy/consent; otherwise show anonymized winner labels.
- Never show individual Role Matrix gaps on public or stage interfaces.
- Separate personally identifiable records from aggregate analytics where practical.
- Define retention before launch: recommended default is raw event/player records for 90 days, audit/security logs per company policy, and anonymized aggregates thereafter.
- Provide an authorized deletion/correction process and document whether the Soul persists after event close.
- Use selected skills only for stated event and approved analytics purposes.

### 12.2 Accessibility baseline

- Target WCAG 2.2 AA for employee, admin, and stage web interfaces.
- Full keyboard operation and visible focus for admin and employee flows.
- Logical headings, labels, live-region announcements for accepted draws/results, and no focus theft from realtime updates.
- Minimum 44 x 44 px touch targets; contrast compliant text and controls.
- Do not rely on color, sound, motion, or spatial position alone.
- Support zoom/reflow on mobile, reduced motion, mute, and high-contrast modes.
- Test public/stage legibility at venue resolution, brightness, and viewing distance.

## 13. Technical Architecture

### 13.1 Logical components

```text
Employee Web   Admin Web   Public Display   Stage Dashboard
      \           |             |                 /
       \---------- API + Realtime Gateway --------/
                         |
              Authoritative Game Service
                /        |         \
         Durable State  Reliable   Asset Delivery
             Store      Events        Store
                |                    |
        Analytics Projection     3D/audio assets
```

The Game Service owns all game mutations, time, eligibility, random draws, match evaluation, winners, and Float token consumption. Clients are projections and command senders, never authorities.

### 13.2 Technology selection constraints

The implementation stack is intentionally undecided. Select client, server, persistence, realtime delivery, renderer, and asset formats only after the existing AriSkill stack, deployment environment, security controls, venue hardware, and operating ownership are verified. Required capabilities are authoritative transactional game state, reconnectable realtime projections, responsive web clients, a performant Galaxy renderer with a 2D fallback, and deterministic asset/build validation. The attached 3D lecture informs production workflow only; none of its engine or file-format examples is prescribed.

### 13.3 Core entities / data model

| Entity | Required fields / notes |
|---|---|
| `Event` | id, name, timezone, venue config, public-display policy, status |
| `Round` | id, event_id, number, schedule, lock_at, state, version, draw_pool_seed/reference, result_window, cancellation_reason |
| `Participant` | id, event_id, employee_ref/pseudonym, approved_display_name, Platform, Role, consent flags |
| `Skill` | id, canonical name, status, taxonomy, Core/Critical flags |
| `RoleSkillMap` | role_id, level if used, skill_id, effective dates |
| `Board` | id, round_id, participant_id, state, version, randomized_at, locked_at |
| `BoardCell` | board_id, position 0-24, skill_id; unique position and unique board/skill |
| `Draw` | id, round_id, number, skill_id, drawn_at, command_id; unique round/number and round/skill |
| `BoardMatch` | board_id, draw_id, cell position, matched_at; derivable but persisted/auditable if useful |
| `Winner` | round_id, participant_id, winning_draw_id, line masks; unique round/participant |
| `Soul` | id, participant_id, event_id, deterministic cosmetic seed/config, created_at, public status |
| `FloatToken` | token hash, soul_id, expires_at, consumed_at, consuming command id |
| `AuditLog` | actor, action, target, expected/actual version, outcome, timestamp, correlation id |

The chosen durable store must enforce uniqueness and accepted state invariants; application checks alone are insufficient for duplicate draws, board cells, and winner records.

## 14. API and Realtime Contract

Operation and event names are provisional; behavior is normative.

### 14.1 Commands and queries

Operation names are logical and transport-neutral; the implementation team maps them to the verified AriSkill API conventions.

| Logical operation | Purpose |
|---|---|
| `event.snapshot` | Public-safe event/round snapshot and server time |
| `event.session.create` | Exchange a signed join token for a scoped session |
| `skill.discovery.query` | Return recommended, popular, and searched skills |
| `board.selections.save` | Idempotently save selected skill IDs with board version |
| `board.finalize` | Validate 25 unique skills and create server-randomized positions |
| `round.registration.open` | Open registration |
| `round.lock` | Atomically decide active/deferred boards |
| `round.start` | Fix the eligible pool and enter Playing |
| `round.draw.next` | Trigger a server-randomized transactional draw |
| `round.cancel` | Cancel with reason |
| `round.admin.snapshot` | Return the authorized operational projection |
| `round.stage.snapshot` | Return the authorized read-only stage projection |
| `soul.float` | Consume a one-use token and publish an entrance event |

Every mutating operation accepts an idempotency token; round mutations also accept `expectedVersion`. Results include a correlation ID, resulting version, and server time.

### 14.2 Realtime envelope and events

```json
{
  "eventId": "evt_...",
  "roundId": "rnd_...",
  "sequence": 42,
  "type": "draw.accepted",
  "occurredAt": "2026-09-22T03:30:05.120Z",
  "roundVersion": 9,
  "payload": {}
}
```

This JSON is an illustrative logical envelope, not a prescribed wire format; names are finalized with the verified platform contract conventions.

Required types:

- `round.registration_opened`, `round.locked`, `round.started`, `round.cancelled`, `round.closed`
- `board.saved`, `board.ready`, `board.deferred`
- `draw.accepted`, `draw.match_counts_updated`
- `bingo.detected`, `result.published`
- `soul.created`, `soul.float_accepted`
- `system.snapshot_required`

Clients track sequence numbers, ignore duplicates, request a fresh snapshot on a gap, and apply only projections permitted for their role. Realtime messages are hints backed by queryable state; reconnect correctness must not depend on receiving every message.

## 15. Reliability, Security, Observability, and Performance

### 15.1 Idempotency and concurrency

- Store idempotency key, actor, request hash, result, and expiry for each mutation.
- Reusing a key with a different request is rejected.
- Round version mismatch returns a conflict and fresh snapshot metadata.
- Draw selection and winner computation run in one transaction or equivalent serializable critical section.
- Emit realtime events through an outbox/after-commit mechanism.
- Float token consumption is atomic; repeats return the original accepted result and never create a second entrance.

### 15.2 Security

- Enterprise authentication for employees/admins where available; event-scoped signed guest flow only if explicitly approved.
- Role-based authorization with separate admin and presenter scopes.
- Short-lived, audience-bound QR/join and Float tokens; store token hashes.
- TLS in transit, approved encryption at rest, CSRF protection where relevant, secure cookies, strict origin policy, input validation, rate limits, and dependency/secret scanning.
- No sensitive data in public events, URLs, analytics labels, or client logs.
- Admin actions require recent authentication according to company policy.
- Threat-model QR sharing, unauthorized round control, event enumeration, replayed Float actions, event-message spoofing, and projection data leakage.

### 15.3 Observability

- Structured logs with event/round/correlation IDs and redacted actor references.
- Metrics: active connections, reconnect rate, command latency/error, draw latency, snapshot age, event fan-out lag, mismatch/gap rate, renderer frame rate, asset failures, and Float success.
- Traces from admin command through durable-state commit and realtime delivery.
- Operator dashboard and alerts for stale public/stage clients, high command error rate, elevated fan-out lag, and durable-store saturation.
- Audit report must reconstruct every round transition and draw order.

### 15.4 Performance and resilience targets

Recommended v1 targets, to be validated against venue capacity:

- API p95 <= 500 ms for normal queries/saves under agreed load.
- Accepted `draw-next` command to client event p95 <= 1 second on the venue network.
- Public/stage snapshot freshness <= 2 seconds during play.
- Countdown drift after correction <= 250 ms between healthy clients.
- Public renderer target 60 fps, minimum acceptable 30 fps at expected Soul count; degrade level-of-detail automatically.
- Initial mobile interactive load <= 3 seconds on the test venue network after QR navigation.
- Reconnection with state reconciliation <= 5 seconds when connectivity returns.
- No duplicate draw, winner, or public Soul entrance under retries, reconnects, or two simultaneous admin clicks.

Capacity test at the expected attendance plus 50% headroom. Preload static/3D/audio assets through a CDN or venue-local cache where deployment allows.

## 16. Analytics

Approved aggregate metrics:

- joined, completed, active, and deferred participation rates;
- Platform and Role engagement;
- top selected skills;
- Core and Critical selection density;
- Role Skill Matrix alignment rate;
- skills beyond the current Role Matrix;
- distribution by Platform/Role only above an approved minimum cohort size.

Metric definitions, denominators, effective Skill Matrix version, and suppression thresholds must be documented. Analytics are not part of the authoritative draw path and cannot delay gameplay.

## 17. Acceptance Criteria

1. **Selection:** Given an eligible employee, when they choose 25 unique skills, then the service saves exactly those 25, creates one randomized 5 x 5 board, and shows `READY`.
2. **No prefill or auto-fill:** Given employee profile data or role recommendations, when the journey begins, then Platform and Role remain unselected and no action can accept all recommended skills without individual employee selection.
3. **Lock:** Given completed and incomplete boards at lock, when lock succeeds, then completed boards become `LOCKED_ACTIVE` and incomplete boards become `DEFERRED` atomically.
4. **Eligibility:** Given active boards, when the round starts, then every draw-pool skill is Core or Critical and appears on at least one active board.
5. **Unique draw:** Given retries or concurrent Next Skill requests, then each accepted draw number and skill is unique and clients converge on the same order.
6. **Minimum draw:** Given a complete line on draw four, no Bingo is declared; when draw five or later completes a line, evaluation occurs.
7. **Co-winners:** Given multiple boards complete a valid line on one draw, all and only those participants are persisted and displayed as co-winners.
8. **Server authority:** Given a manipulated client, it cannot mark a cell, select a draw, alter time, or declare a winner.
9. **Late entry:** Given registration is locked, a new/incomplete board cannot join the active round and is preserved for a later round.
10. **Reconnect:** Given a missed realtime event, when the client detects a sequence gap, it reloads a snapshot and displays the correct final state without replaying stale celebration.
11. **Float:** Given a valid Float token, one mobile action creates exactly one public entrance; retries return the original result.
12. **Privacy:** Public and stage payloads contain no individual skill selection or Matrix gap.
13. **Accessibility:** Critical flows pass keyboard, screen-reader, contrast, zoom/reflow, reduced-motion, and mute checks at the agreed AA baseline.
14. **Fallback:** If the primary Galaxy renderer or an optional audio asset fails, the game and public information panel continue in fallback/silent mode.
15. **Audit:** An authorized reviewer can reconstruct state transitions, actor actions, draws, winners, and cancellations for a round.

## 18. Test Strategy

### 18.1 Automated

- Unit tests for pool eligibility, 12 Bingo line masks, draw-five threshold, co-winner calculation, Soul seed stability, copy/state mappings, and permission rules.
- Property-based tests: no duplicate skills/draws; any declared winner owns a valid line; same input events produce the same projection.
- State-machine tests for every valid and invalid transition.
- Durable-store concurrency tests for duplicate commands, simultaneous draws, lock races, winner atomicity, and Float replay.
- Contract tests for API schemas, projection redaction, realtime envelope/versioning, and reconnect snapshots.
- UI tests for the four canonical journeys and all exceptions.
- Asset-manifest validation for names, hashes, formats, budgets, fallbacks, and licenses.
- Security tests for authorization boundaries, token replay, injection, rate limiting, and public-data leakage.
- Load/soak tests for expected attendance plus headroom, reconnect storms, and the full public Soul count.

### 18.2 Manual and event rehearsal

- Device/browser matrix including lower-end employee phones and the exact public/stage hardware.
- Screen-reader and keyboard walkthrough; reduced-motion and muted-audio rehearsal.
- Projector readability at venue distance and lighting.
- Full dress rehearsal using production-like network topology, MC timing, sound system, duplicate clicks, Wi-Fi loss, display refresh, cancellation, and rollback.
- Run at least one seeded deterministic round whose expected draw order and co-winners are precomputed.
- Verify fallback renderer, cached assets, spare display device, operator runbook, and contact tree.

## 19. Conflicts and Resolutions

| Conflict | Resolution |
|---|---|
| Countdown reaches 00:00 vs admin manually starts | `00:00` closes registration and moves to `LOCKED`; admin starts within a recommended 60-second window. Before zero, confirmed `Start Now` atomically locks eligible boards and enters `PLAYING`. Neither path draws a skill automatically. |
| Draw only player-selected eligible skills may produce no viable game | Block start if fewer than five eligible skills; warn if no active board has a possible line. Product may reschedule/cancel, not silently expand the pool. |
| Public display and stage dashboard appear redundant | Public view prioritizes spectacle; stage dashboard prioritizes large, narration-friendly round and aggregate insight information. |
| Mobile launch must appear once publicly | Use a one-use server-issued Float token and atomic consumption. |
| 25 selections create friction | Keep active self-selection for methodological integrity; optimize discovery, save drafts, and test completion time. Do not add a 25-skill auto-accept option. |
| 3D lecture suggests a game engine | Use its asset/pipeline/QC lessons only. The required synchronized multi-client product remains web-based; engine choice is open. |

## 20. Assumptions

- AriSkill can provide an active Skill Master, Core/Critical classification, Platform/Role taxonomy, and versioned Role Skill Matrix mapping.
- The event has authenticated or otherwise approved employee identity, reliable display hardware, and an operator network.
- Display-name and public-participation policy will be approved before launch.
- One event may contain multiple sequential rounds; a participant enters at most one active board per round.
- English copy is the initial baseline; localization requirements are not yet supplied.
- Venue operations provide an MC, admin device, public screen, stage dashboard screen, and audio operator.

## 21. Open Questions and Recommended Defaults

`Blocks` names the decision or gate that cannot close without an answer; work outside that boundary may continue using the recommended default.

| Question | Recommended default | Blocks |
|---|---|---|
| Expected concurrent players / Souls? | Size and test for expected attendance + 50%; confirm before architecture sign-off. | Capacity plan, performance budgets, and load-test acceptance. |
| Employee authentication method? | Existing company SSO; signed event session only if SSO cannot meet event latency. | Session/API security design and security gate. |
| Public winner name policy? | Explicit event consent and approved display name; otherwise pseudonym. | Public winner projection, consent copy, and privacy gate. |
| Round start grace window? | 60 seconds after lock, then operator warning; no automatic start. | Admin timing copy, acceptance tests, and operator runbook. |
| Winner display duration? | 12 seconds, configurable within 10-15 seconds. | Public Winner-state timing and venue rehearsal. |
| Draw pacing? | Manual Next Skill; UI may suggest 5-8 seconds but never auto-fires. | Admin interaction copy and MC rehearsal script. |
| What happens if no board can win? | Warn before start and require reschedule/cancel decision. | Start-readiness behavior, exception copy, and mechanic sign-off. |
| Raw data retention? | 90 days unless company policy requires less; anonymize aggregates thereafter. | Data lifecycle implementation and privacy approval. |
| Soul persistence after event? | Retain only with approved purpose/consent; otherwise remove with raw participant data. | Soul lifecycle, deletion behavior, and privacy approval. |
| Matrix version? | Snapshot the effective version at board finalization and include it in private insight calculations. | Insight calculation contract and analytics acceptance. |
| Localization? | English v1 with externalized strings; confirm Thai/bilingual need before UI lock. | Final copy, layout validation, and content sign-off. |
| Existing brand/design system? | Product/design team supplies tokens and components before visual QA; provisional decisions above are not final. | Visual QA and final UI sign-off, not mechanics development. |

## 22. Readiness Checklist

### Product and data

- [ ] Skill Master, Core/Critical flags, Platform/Role data, and Matrix version validated.
- [ ] Capacity, retention, consent, winner-name, and Soul-persistence decisions approved.
- [ ] Copy, localization, fallback, cancellation, and no-winner behavior signed off.

### Design and assets

- [ ] Verified AriSkill brand/design tokens replace provisional values.
- [ ] All four responsive interfaces approved at target device/display sizes.
- [ ] 3D/2D/audio asset manifest passes budget, format, license, and fallback checks.
- [ ] Reduced-motion, mute, contrast, keyboard, and screen-reader reviews pass.

### Engineering and security

- [ ] State machine, API schemas, projection redaction, and data constraints reviewed.
- [ ] Idempotency, concurrency, reconnect, rollback, and audit tests pass.
- [ ] Threat model, privacy review, dependency/secret scan, and penetration checks complete.
- [ ] Load, soak, and venue-network tests meet targets at capacity + 50%.
- [ ] Monitoring, alerts, dashboards, backups, and incident owners are active.

### Event operations

- [ ] Production-like dress rehearsal completed with seeded expected winners.
- [ ] MC/admin runbook, cancellation steps, support contacts, and rollback plan printed/offline.
- [ ] Exact projector/display, admin device, stage device, venue audio, and backup hardware tested.
- [ ] Release owner gives go/no-go approval and confirms next-round recovery procedure.

## 23. Sources

- **AriSkill Skill Bingo - Revised Game Plan** (`pasted-text.txt` supplied by the user): primary source for product intent, interfaces, flows, and game rules.
- **Lecture_12_3d_Games.pdf** (supplied by the user): used only for production-process ideas - specialist asset artifacts, Concept -> Mechanics -> Art -> Sound -> Assembly sequencing, deterministic assembly, and hard quality-control checks. Its Godot-specific implementation is not a product requirement.

## 24. Pass 10 Critique Log

| Severity | Finding | Resolution applied |
|---|---|---|
| Must-fix | A separate Event Analyst persona and stage export appeared after the locked scope. | Removed the persona, export requirement, and post-event export behavior; aggregate Insights remain in the admin/stage interfaces already requested. |
| Must-fix | Emergency blackout/freeze controls were an unsupported admin capability. | Removed the control and rehearsal/readiness references; cancellation and reconnect states remain the supported recovery paths. |
| Must-fix | `Capture or retrieve` allowed profile-based Platform/Role prefill, conflicting with active employee selection. | Made both selections explicit, prohibited profile prefill and bulk 25-skill acceptance, and added acceptance coverage. |
| Must-fix | Countdown language could still be read as automatic start. | Defined `00:00` as registration lock only; play begins only after a manual admin start, with a recommended 60-second window. |
| Must-fix | Business rules did not consistently specify failure behavior. | Recast BR-01 through BR-20 with an exception or a clear non-failing invariant for every rule and added E16-E23. |
| Must-fix | Open questions lacked an explicit blocking boundary. | Added a `Blocks` field to every open question while preserving a recommended default. |
| Should-fix | The document named an implementation stack before the existing AriSkill environment was verified. | Replaced named technologies and preferred runtime formats with capability constraints and an explicit post-verification selection gate. |
| Should-fix | Stage-dashboard scope included presenter cues, action history, connection diagnostics, view switching, and export not present in the approved requirement. | Narrowed Stage to read-only round status, participation, winners, and approved aggregate skill insights. |
| Should-fix | Some working UI names and tokens could be mistaken for approved design-system decisions. | Marked all interface names, labels, copy, components, and tokens provisional until brand/content review. |
| Noted | No global keyboard shortcuts were specified; normal keyboard accessibility is still required. | Preserved standard focused keyboard operation and explicitly kept global shortcuts out of v1. |

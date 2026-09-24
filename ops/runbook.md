# AriSkill Skill Bingo - Event Operations Runbook

Audience: event admin / MC, stage presenter, support engineer. Provisional v1 (run `run-20260922-113339`). Print or keep offline before the event.

## 0. Roles and devices

| Role | Device | URL | Credential |
|---|---|---|---|
| Admin / MC | laptop, wired if possible | `https://<host>/admin` | `BINGO_ADMIN_TOKEN` (never share on screen) |
| Stage presenter | laptop on stage display | `https://<host>/stage` | `BINGO_STAGE_TOKEN` (read-only) |
| Public screen | venue PC on projector, 1920x1080, Chromium | `https://<host>/public?event=evt_demo` | none |
| Employees | own phones | QR on public screen -> `/play?t=...` | signed join token in QR |
| Support | laptop | server logs, `/admin` Audit tab | admin token |

## 1. Before doors open (T-60 min)

1. Confirm the deployed build ID matches `ops/release-checklist.md` sign-off (`build/build-info.json`).
2. Start the service with production env (see `services/game-service/README.md`); confirm `/api/v1/time` answers.
3. Open the public screen; confirm the Galaxy renders (WebGL). If it shows "2D mode", that is acceptable; if static, check GPU/browser flags.
4. Open the stage dashboard; confirm it shows the same round state as the admin portal.
5. Create the round: Mission Control -> Create round -> title, lock time (registration closes), result window 12 s.
6. Open registration. Confirm the QR appears on the public screen and a test phone can join and select skills.
7. Sound: unmute the public screen via the on-screen control (browser needs one click); confirm ambient bed plays through venue audio at a comfortable level.

## 2. Registration window

- Watch joined / completed / incomplete counts. Remind the room of the countdown; boards lock at `00:00`.
- Incomplete boards at lock are saved for the next round (players see E5). Do not extend the countdown after announcing it unless necessary: use Reschedule (allowed only while registration is open).
- If most players are still incomplete near zero: Reschedule to a later lock time.

## 3. Lock and start

- At `00:00` the round moves to `LOCKED`. Nothing starts automatically.
- Check the readiness panel: pool size (must be >= 5) and "boards that can win". If none can win, reschedule/cancel (E20 / OD-07).
- Click **Start round**. Recommended within 60 s of lock; after that the portal shows an overdue warning (still safe).
- `Start now` (while registration is open) locks immediately and starts; it asks for confirmation. Use only when the MC explicitly wants to begin early.

## 4. Play

- Click **Next Skill** at MC pace (5-8 s suggested). The button shows pending until the server confirms. If it shows "refreshed" (E10), the round changed under you: read the panel and click again if appropriate. Never double-click; a duplicate is rejected safely.
- Draws 1-4: Bingo cannot happen (rule). From draw 5 the stage shows "Bingo is live".
- Winner: the round moves to `WINNER` automatically; public screen shows co-winners for 12 s then returns to Waiting. Souls are created for every active player.
- Verifying a winner who did not consent to a public name: they appear as `Soul #NNNN` on the public, stage, and admin screens. The player's phone shows the same label on their result screen ("Shown on the public screen as ..."). Ask the player to show that line; do not ask for their name on stage.
- No winner and pool exhausted: state `EXHAUSTED` -> click **Close round**.

## 5. Souls and Float

- Players reveal their Soul and press READY TO FLOAT; their Soul enters the Galaxy once. A retry is safe (returns the original result).
- Encourage staggered floats; the Galaxy handles bursts by clustering.

## 6. Incidents

| Symptom | Action |
|---|---|
| Public screen shows "Reconnecting" | Wait 10 s; it resumes from snapshot. If persistent: refresh the page (state is restored). |
| Admin shows E10 repeatedly | Refresh Mission Control; another admin session may be operating. |
| Next Skill returns E21 | Click again (same action is retried idempotently). If it persists, cancel the round with a reason and start a new one. |
| Suspect gameplay integrity | Stop issuing commands, keep the audit trail, cancel transparently with reason, open an incident record, start a new round. Never edit winners. |
| Audio dead | Continue; every cue has visible copy. Check browser mute and venue mixer. |
| Renderer crash on public screen | Reload; the app falls back to 2D automatically; game continues. |
| Server restart needed | Restart the process; SQLite state persists; clients reconnect and resync. |
| Wi-Fi outage for players | Boards are saved; players reconnect and see the final state. Lock timing is server-side. |

Escalation: support engineer -> product owner. Keep the contact tree printed (fill in before the event).

## 7. After the round / event

- Review Insights in the admin portal (aggregate only). No export exists in v1.
- Verify retention job status in logs; archive `reports/` and the audit export for the release record.

## 8. Deployment note (rate limiting behind NAT)

See also the deployment conditions in `ops/release-checklist.md`.

If phones reach the server through a single venue NAT or a cloud load balancer, set `BINGO_SESSION_RATE_PER_MIN` high enough for the crowd (for example 300) and set `BINGO_TRUST_PROXY=1` only when a trusted reverse proxy sets `X-Forwarded-For`. On a venue LAN with direct client IPs, the defaults are fine.

## 9. Developer AI keys are not part of the event

The `.env` file holding `GEMINI_API_KEY` and `OPENAI_API_KEY` is a design-time convenience for `tools/ai/*` only (decision D-26). The game service never reads it, no key ever reaches a browser, and no event-day step needs one. Do not copy `.env` to the venue machine or into any deployment image; `.env.example` is the only file that belongs in the repo. If a key is ever shared or pasted somewhere shared, rotate it at the provider and replace it locally.

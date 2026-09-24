# Glossary

| Term | Meaning |
|---|---|
| Event | One live occasion (venue, date) that contains one or more sequential Rounds and one persistent Arise Galaxy. |
| Round | One Bingo game: registration, lock, play, result. Owns a version number incremented on every accepted mutation. |
| Participant | An employee who joined the event through the signed QR link. Owns at most one board per round. |
| Platform | The organizational grouping the employee explicitly selects (mapped from the workbook "Job Family"). |
| Role | The job role the employee explicitly selects (workbook "Job Role"). |
| Skill Master | The canonical list of 218 active skills with domain, cluster, kind, and Core/Critical flags. |
| Core Skill | A skill typed "Core Skill" for at least one role in the Role Skill Matrix. |
| Critical Skill | A skill typed "Critical Skill" for at least one role. |
| Draw pool | The unique set of Core-or-Critical skills present on at least one `LOCKED_ACTIVE` board. |
| Board | A participant's 25 unique selected skills; when finalized, a server-randomized 5 x 5 grid. |
| Draw | One server-random selection from the remaining draw pool, numbered from 1. |
| Match | A board cell whose skill has been drawn. Computed only by the server from accepted draws. |
| Line | One of 12 winning patterns: 5 rows, 5 columns, 2 diagonals. |
| Bingo | A board with at least one complete line, evaluated only from draw 5. |
| Co-winners | All participants whose boards complete a line on the same winning draw. |
| Arise Soul | The cosmetic, non-ranking companion every completed participant receives, rendered from a deterministic seed. |
| Bingo Star | A small optional cosmetic badge on a winner's Soul with an accessible text label. |
| Float / Ready to Float | The one-use action that launches a Soul from the phone into the public Galaxy. |
| Arise Galaxy | The persistent public scene where launched Souls orbit. |
| Projection | An audience-specific, redacted view of the authoritative state (public, stage, admin, participant). |
| Snapshot | A queryable projection at a sequence number; the recovery source after any realtime gap. |
| Mission Control | The admin operating surface for one round (separate from Insights). |
| Insights | Aggregate, privacy-safe analytics shown in the admin portal and stage dashboard. |

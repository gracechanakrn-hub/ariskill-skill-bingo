# Deploying to Hostinger (event.ogtraplord.com)

Live since 2026-09-28 on a Hostinger **Business Web Hosting** plan, as its own website `event.ogtraplord.com`
(folder `/home/u576211051/domains/event.ogtraplord.com/public_html`), separate from `ogtraplord.com` and `pay.ogtraplord.com`.

## Package
Only the runtime folders ship (about 14 MB, 7 MB zipped): `apps packages assets tokens contracts services`, without `test/`
folders, plus `hostinger-start.cjs` and a minimal `package.json` (no dependencies, `start`, and a no-op `build` script).

```sh
git archive HEAD apps packages assets tokens contracts services | tar -x -C pkg
find pkg -path '*/test/*' -delete
cp hostinger-start.cjs pkg/
# pkg/package.json: {"type":"module","main":"services/game-service/src/server.js",
#   "scripts":{"start":"node services/game-service/src/server.js","build":"node -e \"console.log('no build step')\""}}
(cd pkg && zip -qr ../bingo-event.zip .)
```

## Why hostinger-start.cjs
Hostinger runs Node apps through LiteSpeed (`lsnode.js`), which loads the entry file with `require()`. The server is an ES
module graph with top-level await, which `require()` refuses (`ERR_REQUIRE_ASYNC_MODULE`). `hostinger-start.cjs` starts
it with a dynamic `import()` instead.

## Node.js settings (hPanel > Websites > event.ogtraplord.com > Node.js)
Node **24**, app type **Other**, root `.`, build script `build`, entry file **`hostinger-start.cjs`**, package manager npm,
source: the uploaded `bingo-event.zip`. A deploy overwrites `public_html`; the database lives outside it.

## Environment variables
`BINGO_ENV=production`, `BINGO_ADMIN_TOKEN`, `BINGO_STAGE_TOKEN`, `BINGO_JOIN_SECRET`, `BINGO_SESSION_SECRET` (random,
kept outside the repo), `BINGO_PUBLIC_BASE_URL=https://event.ogtraplord.com`,
`BINGO_DB_PATH=/home/u576211051/domains/event.ogtraplord.com/bingo-data/event.sqlite` (outside `public_html`, so a
redeploy keeps the data), `BINGO_SESSION_RATE_PER_MIN=300`, `BINGO_EVENT_NAME=AriSkill Skill Bingo`.
After go-live, add `BINGO_ALLOW_RESET=off` to lock test mode (D-56). Replacing the variables restarts the app.

## Verified on 2026-09-28
All four screens return 200 over HTTPS; the practice token is refused (401) and the real admin token accepted; join links
use `https://event.ogtraplord.com`; server-sent events reach clients through LiteSpeed immediately (round.created /
round.deleted seen on the public stream within a second).

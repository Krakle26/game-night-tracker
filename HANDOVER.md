# Handover: Game Night Tracker

Supersedes the original `HANDOVER_1.md`. See "Corrections" below — that document
described work as finished that had not been started.

Repo: https://github.com/Krakle26/game-night-tracker

## Where this stands

Built and committed locally; **not yet pushed and not yet deployed**.

- `public/index.html` — the artifact frontend, ported off `window.storage` onto
  `fetch('/api/games')` for the shared list and `localStorage` for the name.
- `functions/api/games.js` — written from scratch. GET returns the list, POST
  upserts one game by id (so one route covers both adding and moving).
- KV namespace `GAMES_KV` created (`2193f8138c3941d88f0eece68f48c363`) and bound
  in `wrangler.toml`.
- Deploy path chosen: **wrangler CLI**, not the dashboard's Git integration.

## Still to do

1. Paste a RAWG key into `public/index.html` — search is dead until then, though
   adding games by hand works. See the README.
2. `npm run deploy`.
3. `git push` to the GitHub repo above (still empty).
4. End-to-end check: add a game, open the URL on a second device, confirm it syncs.

## Corrections to HANDOVER_1

That document said three files existed locally — `index.html`, `README.md`, and
`functions/api/games.js` — and that the remaining work was to push them. None of
those files existed. What was actually on disk were three exports of the
**artifact** version in `~/Downloads`, all still calling `window.storage`:

| File | Modified | What it was |
|---|---|---|
| `game-night-tracker.html` | 26 Aug 21:21 | base, with a real RAWG key pasted in |
| `game-night-tracker_1.html` | 26 Aug 21:27 | + `fetchGames()` refactor, 20s polling |
| `game-night-tracker_2.html` | 26 Aug 21:30 | + `?name=` URL hack |

`_2.html` was the newest and was used as the source. The Cloudflare rebuild had
never been written.

The key found in the oldest export was deliberately **not** reused — it had been
sitting in a plaintext download, so a fresh one is being generated instead.

## Design decisions

Carried over from HANDOVER_1 and still standing: RAWG over IGDB (no Twitch OAuth
app needed, and the Twitch console's secret generation was broken); Cloudflare
Pages over a Claude artifact (real cross-device sync, working `localStorage`, and
parity with the other self-hosted projects); polling over push; no accounts.

Two things changed in the rebuild:

- **One KV key for the whole catalog**, not one key per game. The per-game layout
  costs a `list` plus N `get`s per poll, which would have run into six figures of
  reads a day and straight off the free tier — the original cost note assumed the
  writes were the binding limit, but under that layout it was the reads. The
  tradeoff is last-write-wins on simultaneous adds. Detail in the README.
- **The `?name=` URL hack is gone.** It existed only to work around artifact
  storage not remembering anonymous viewers. On a real hosted page plain
  `localStorage` does the job, so the name no longer rides in the URL.

## Cost

Still expected to be £0/month. With the single-key layout, four people polling
every 20s across an evening is a few thousand KV reads a day against a 100K
allowance. Writes only happen when someone adds or moves a game, far under the
1,000/day free-tier cap.

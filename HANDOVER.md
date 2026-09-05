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
- A fresh RAWG key is in `public/index.html`; search verified working against the
  live API (results, cover art, year and platform all landing in KV).
- The project folder is `DocumentsGame Night Tracker`. The Cloudflare project
  name, npm package name and repo slug all stay `game-night-tracker`, since the
  Pages name sets the `.pages.dev` subdomain.

## Still to do

1. `npm run deploy`.
2. `git push` to the GitHub repo above (still empty).
3. End-to-end check: add a game, open the URL on a second device, confirm it syncs.

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

## Delete

Added after the first deploy. `DELETE /api/games?id=…` drops a game for
everyone; the `×` on each ticket stub opens a confirm dialog naming the game
first, since a mis-tap on a phone would otherwise silently destroy something a
friend added. The removal is optimistic and rolls back with an error if the
write fails, so the list never claims something is gone when it is not.

There is deliberately no restriction on who may delete what. Names are
self-declared with no accounts behind them, so enforcing ownership would be
theatre rather than a control.

## The pass code

Added after the delete work, once the repo went public and made the
`.pages.dev` URL discoverable from it. `functions/api/_middleware.js` gates
every `/api` route against `APP_TOKEN`, comparing hashes so the check runs in
constant time and cannot leak the code's prefix through response timing.

The static page stays public. Gating the HTML would achieve nothing when the
data routes can be called directly, and the page holds nothing secret.

The gate folds into the first-run screen that already existed for names, so
setup is still one screen. A 401 anywhere clears the stored code and reopens it.

This does **not** protect the RAWG key, which still ships in the page and is
still in this repo's history.

## The Neon Grid redesign

The backstage/setlist identity was replaced wholesale. Directions were explored
on a design canvas (arcade cabinet, phosphor terminal, synthwave) and Neon Grid
was chosen, then ported into `public/index.html`.

Class names were kept identical throughout, so the port is almost entirely the
stylesheet: the JS touched only in `tagEl` (pills now tint from a `--tagc`
property rather than taking a solid background), the empty state (a drawn
gamepad), and three modal headings. `.perf` — the ticket-stub perforation —
is retained in the markup but hidden, since nothing else depends on it.

The on-stage card is the one genuinely new piece of layout: `.stub.now` grows
its padding, cover and title, and hangs a "NOW PLAYING" pill off its top edge
through `::before`.

## Home-screen icons

Added after the retheme. A synthwave sun over the grid horizon — shapes only,
no text, so it rasterises predictably and still reads at 40px.

The iOS path is the fiddly one and is documented in the README: iOS reads only
`apple-touch-icon`, ignores the manifest, and composites transparency onto
black, so that one PNG comes from a square, flattened source rather than the
rounded one.

## Game detail sheet

Tapping a row opens it. Row taps and the action buttons share the row, so the
handler ignores anything inside `.act-btn` — otherwise moving or deleting a
game would also open its details.

RAWG detail is fetched per game by `sourceId` and cached in a `Map` for the
session, so reopening is free. The sheet renders from stored data immediately
and fills in the rest asynchronously; if the fetch fails it says so and keeps
the local data on screen.

The note UI landed here rather than in the add flow, because this is where you
are already looking at one game.

## Row width at phone size

Titles were being truncated badly — the on-stage card showed "Bi…" for
"Big Walk" — because the cards were designed on artboards wider than a phone.
A 375px screen leaves about 311px inside a row, and each control takes 52px
with its gap.

Three changes: the on-stage card's buttons moved to their own row; ordinary
titles may wrap to two lines; and delete came off the row entirely, which is
what actually bought the space. Titles went from 132px to 184px, and nothing in
the three lists clips now.

The lesson for future work here: check a layout at 375px before calling it
done. Artboard width is not phone width.

## Editing a game

Added once it became clear delete-and-re-add was the only way to fix a typo
or the wrong platform — which loses `addedBy`/`addedAt` and drops the game
to the bottom of its list via the `updatedAt` sort. The edit modal reuses the
existing upsert-by-id POST route, so no backend change was needed.

Scoped to title and platform only, not cover/year/`sourceId`. Those come
from RAWG at add time; a wrong one usually means the wrong game was picked,
and re-adding via search is more honest than hand-editing metadata out of
sync with its source.

## Platform filter

A chip row (`ALL` plus one per platform) above the tabs, narrowing whichever
list is open. Each chip tints from the same `--tagc` colour a game's row tag
already uses, so a platform's colour means the same thing everywhere — `ALL`
borrows the tabs' gradient instead, since it reads as the reset state rather
than a platform.

## Search across every list

Search used to only match the open tab, so finding something already marked
Played It meant guessing which tab to try first. A query now searches all
three lists and shows a banner saying so; each result picks up a status
label since inside a single tab that was already implied. Combines with the
platform filter; clearing the box returns to normal tab-scoped browsing.

## Manual queue order

On Deck's order was purely "whatever was touched most recently" — no way to
say "play this one next" without it already being the newest addition.
Added a per-game `order` field and Move up/down buttons in the detail sheet,
not the row, for the same reason Delete lives there (see "Row width at phone
size" above).

Deliberately doesn't touch `updatedAt` on a reorder — it's a position
change, not a content change, and stamping it would make a game's "Xm ago"
label lie and would reshuffle its place in the other two lists for no
reason. Games from before this feature fall back to their existing
`updatedAt`-based order, so nothing visibly reshuffles until someone
actually taps a button.

## One game on stage

With only three people in the group, confirmed that On Stage should mean
one thing — the single game everyone's playing right now, even when that
spans multiple platforms via cross-play — rather than a slot that could hold
two different games for two subgroups. Promoting a second game now demotes
whatever was already on stage back to On Deck, stamped with a normal
status-change `updatedAt` since it's a real transition, unlike a queue
reorder.

Best-effort, not server-enforced: two people promoting different games in
the same instant could still both land as playing, the same tradeoff already
accepted for simultaneous edits elsewhere in this app.

## Daily catalog backups

A single KV key with no history had no way back if a write went wrong. Every
write that changes the catalog now snapshots the pre-write state into
`catalog:backup:<today's date>` if today doesn't have one yet, and prunes
snapshots older than 30 days on that same write — standing in for a
scheduled job, since Pages Functions have no cron of their own. Restoring is
a manual `wrangler kv key get`/`put`, documented in the README; a recovery
this rare doesn't earn a UI or its own auth.

## Pass-code lockout

Ten wrong codes from the same IP in five minutes now locks that IP out for
the rest of the window, tracked in KV under an `authfail:` prefix with a TTL
so it self-cleans. The pass code is a 192-bit random token, so this was
never about stopping a crackable brute force — only about not letting a
script hammer the endpoint at network speed for free. A success clears the
count immediately, so a few mistyped attempts followed by the right code
never trips it.

## Cost

Still expected to be £0/month. With the single-key layout, four people polling
every 20s across an evening is a few thousand KV reads a day against a 100K
allowance. Writes only happen when someone adds or moves a game, far under the
1,000/day free-tier cap. The daily backup snapshot and the lockout counter add
at most a few extra reads and writes per session — still nowhere near the caps.

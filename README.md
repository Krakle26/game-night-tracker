# Game Night Tracker

A shared, mobile-friendly set list for a weekly game night group (PC/PS5/Xbox/Switch).
Three lists — **On Deck** (up next), **On Stage** (playing now), **Played It** (done) —
with games added by search (RAWG) or by hand, kept in sync across everyone's phones.

## Layout

```
public/index.html         entire frontend, no build step
functions/api/_middleware.js  gates every /api route on the shared pass code
functions/api/games.js        GET the shared list, POST a game (add or move),
                              DELETE one by id
wrangler.toml             Pages config + the GAMES_KV binding
```

## The pass code

Every `/api` route is gated on a single shared code. There are no accounts —
there is nothing per-person to authenticate, only "are you one of us".

Generate one, then set it in both places:

```bash
npm run token                 # prints a code
npm run secret:put            # paste it in for production
```

For local development put the same value in `.dev.vars` as `APP_TOKEN=…`
(copy `.dev.vars.example`). That file is gitignored and must stay that way.

Everyone enters the code once per device on first visit, alongside their name.
It is kept in `localStorage`; a rotated or mistyped code returns a 401, which
clears the stored copy and sends them back to the gate rather than leaving them
staring at an empty list.

Rotating the code means running `npm run secret:put` again and telling
everyone the new one — there is no other way back in.

## Running it locally

```bash
npm install
npm run dev
```

`wrangler pages dev` serves `public/` and the Function together on
http://localhost:8788, against an emulated KV store under `.wrangler/`. Nothing
you add while testing touches the real shared list.

## Deploying

```bash
npm run deploy
```

The KV namespace already exists and is bound in `wrangler.toml` — it was created
once with `npm run kv:create`. The binding must stay named `GAMES_KV`, which is
what `functions/api/games.js` reads as `env.GAMES_KV`.

## The RAWG key

Search is powered by [RAWG](https://rawg.io/apidocs). A key is already set near
the top of the `<script>` in `public/index.html`:

```js
const RAWG_API_KEY = "...";
```

Replacing it is a one-line edit. With the placeholder back in, search reports an
error and adding by hand still works.

The key ships in the page and is visible to anyone who opens it — accepted for a
small private group. Moving the call server-side into a Function, with the key as
a Cloudflare secret, is the fix if that ever stops being acceptable.

## How the data is stored

The whole catalog lives under **one KV key** (`catalog`) holding a JSON array,
not one key per game.

This matters for cost. A key-per-game layout costs a `list` plus one `get` per
game on every poll; four people polling every 20s across an evening, against a
list of thirty games, runs to hundreds of thousands of reads a day — well past
the free tier's 100K. One key is one read per poll, a few thousand a day.

The tradeoff is that every write rewrites the whole array, so two people adding a
game in the same instant can lose one of the two. For a weekly game night that
window is not worth a Durable Object.

`POST /api/games` returns the merged list, so saving doubles as a sync, and so
does `DELETE /api/games?id=…`. Deleting something already gone returns 200
rather than 404 — on a shared list two people removing the same game at once is
a normal outcome, not an error either should see.

## Sync

Polling every 20s, plus an immediate poll whenever the tab becomes visible again.
Polling pauses while the tab is hidden. Real-time push would mean a Durable
Object; it has not been needed.

## Identity

No accounts. Each person types a name once and it is kept in `localStorage` on
their own device under `game-night:my-name`. It is never sent anywhere except as
the `addedBy`/`updatedBy` label on a game they touch.

## Design system

"Backstage / gig setlist" — dark, paper-and-tape:

- Near-black charcoal background (`#16161A`), paper panels (`#1F1F24`),
  gaffer-tape yellow accent (`#E8B923`), hot-pink "on stage now" (`#FF4D6D`).
  Platform tags carry their own colours: PC cyan, PS5 indigo, Xbox green,
  Switch red, Other orange.
- 'Bebas Neue' for headers and titles, 'Work Sans' for body, 'JetBrains Mono'
  for metadata (added-by, timestamps, tags).
- Each game is a "ticket stub" row: a dashed perforated divider between the info
  and the buttons, and a cover thumbnail or a coloured letter tile.
- The masthead has torn-paper/tape-corner styling.

## Known gaps

- **No notes UI.** The data model carries a `note` field with no way to set it.
- **One code for everyone.** Anyone holding it can add, move and delete. There is
  no per-person identity behind the names, so ownership rules would be theatre.
  Rotating the code is the only revocation.

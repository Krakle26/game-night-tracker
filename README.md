# Game Night Tracker

A shared, mobile-friendly set list for a weekly game night group (PC/PS5/Xbox/Switch).
Three lists — **On Deck** (up next), **On Stage** (playing now), **Played It** (done) —
with games added by search (RAWG) or by hand, kept in sync across everyone's phones.

## Layout

```
public/index.html         entire frontend, no build step
public/manifest.json          home-screen install metadata
public/icons/                 app icons (see "Adding it to a phone")
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

Ten wrong codes from the same IP within five minutes locks that IP out for the
rest of the window (`429`, every request rejected — correct codes included —
until it passes), tracked in KV under an `authfail:` prefix with a TTL so it
self-cleans. The code is a 192-bit random token, so this isn't closing a
crackable brute force; it stops a script from hammering the endpoint at
network speed for free. A success clears the count immediately, so a few
mistyped attempts followed by the right code never trips it.

## Adding it to a phone

Open the site and use "Add to Home Screen". It then launches without browser
chrome (`display: standalone`), on the deep indigo the rest of the app uses.

The icon is a synthwave sun over the grid horizon, drawn as SVG and rasterised
to PNG with `sharp`:

```
icon.svg                 rounded, for the manifest's "any" purpose
icon-square.svg          full bleed — the source for the iOS icon only
icon-maskable.svg        full bleed, sun inside the safe circle
apple-touch-icon.png     180px, flattened, no alpha
icon-192.png, icon-512.png, icon-maskable-512.png
```

Three things about this that are easy to get wrong:

- **iOS ignores the manifest's icons.** It reads `<link rel="apple-touch-icon">`
  and nothing else, so the PNG is not optional.
- **iOS ignores transparency**, compositing it onto black. The Apple icon is
  therefore generated from the square source and flattened — a rounded source
  would show dark wedges outside iOS's own rounding.
- **Maskable is cropped** to whatever shape the launcher wants. The sun sits
  inside the middle 80%; the grid deliberately bleeds off every edge, because
  artwork scaled entirely inward just floats in a box.

To regenerate after editing an SVG, rasterise with `sharp` at `density: 512`.

## Running it locally

```bash
npm install
npm run dev
```

`wrangler pages dev` serves `public/` and the Function together on
http://localhost:8788, against an emulated KV store under `.wrangler/`. Nothing
you add while testing touches the real shared list.

## Working on it from another machine

Everything needed is committed except two things, both deliberately: the pass
code and Cloudflare credentials.

```bash
git clone https://github.com/Krakle26/game-night-tracker.git
cd game-night-tracker
npm install
cp .dev.vars.example .dev.vars     # then put the group's pass code in it
npm run dev
```

Without `.dev.vars` the app loads but every `/api` call returns 500, because
the middleware refuses to run with no `APP_TOKEN` set. That is the failure to
expect if you skip this step.

Local dev runs against an **emulated** KV store under `.wrangler/`, so nothing
you do while developing touches the real shared list. The pass code in
`.dev.vars` therefore does not have to match production — but using the same
one saves you re-entering a different code in the browser.

### Deploying from somewhere without a browser

`npm run deploy` normally uses an OAuth token wrangler stored when you logged
in through a browser. A headless environment cannot do that, so create an API
token instead (Cloudflare dashboard → My Profile → API Tokens → Create Token)
with these account permissions:

- **Cloudflare Pages: Edit** — to deploy
- **Workers KV Storage: Edit** — to read or change the namespace

Then set it in the environment before deploying:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy
```

The account id is on the right-hand side of the Cloudflare dashboard overview.
Neither value belongs in the repo.

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

## Browsing the list

Two ways to cut down three lists that get long over a season.

**Platform filter** — a chip row (`ALL` plus one per platform) above the tabs
narrows whichever list is open to games on that platform. Each chip tints
from the same colour a game's row tag already uses, so a platform's colour
means the same thing everywhere it shows up. `ALL` borrows the tabs'
gradient instead, since it reads as the reset state rather than a platform.
Tab counts stay unfiltered — they're a total per status, same as they've
always ignored the search box.

**Search** looks across all three lists at once, not just the open tab —
typing while on On Deck can still find something already marked Played It.
A banner says so ("tabs are ignored while you're searching") since a tab
silently doing nothing while you type would be more confusing than saying
it outright. Each result picks up a small status label (On Deck / On Stage /
Played It) while searching, since inside a single tab that's already implied
by which list you're looking at. Clearing the box returns to normal
tab-scoped browsing. The two combine — filter to a platform, then search
within it.

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

## Backups

A single KV key with no history has no way back if a write goes wrong — a
fat-fingered delete, a bug, a corrupted value. Every write that actually
changes the catalog first checks for a snapshot under `catalog:backup:<today's
date>` and, if today doesn't have one yet, writes the pre-write catalog there
before making the change. One a day, not one a write — with several writes an
evening that would just burn quota for no benefit over one known-good copy
from before today started. Backups older than 30 days are pruned on the same
write that takes the next one, standing in for a scheduled job, since Pages
Functions have no cron of their own.

Restoring is manual — this happens rarely enough that it doesn't earn its own
UI or auth:

```bash
# See what's available
wrangler kv key list --binding=GAMES_KV --remote --prefix="catalog:backup:"

# Pull a day's snapshot down, then push it back as the live catalog
wrangler kv key get "catalog:backup:2026-09-04" --binding=GAMES_KV --remote > backup.json
wrangler kv key put catalog --binding=GAMES_KV --remote --path=backup.json
```

## Game detail

Tapping a row opens a sheet: the group's own data first, then whatever RAWG
knows — score, average playtime, every platform it is on, genres and a
description — fetched by `sourceId` and cached in memory for the session.

Two things it deliberately does not do. It never blocks: the sheet opens on
what is already stored and fills the rest in when it arrives, so a slow or
unreachable RAWG costs nothing. And it never pretends: a game added by hand has
no `sourceId`, so it says so rather than showing an empty space.

"Playable on" is the part worth keeping. The row shows the single platform
whoever added it picked; the sheet shows every platform the game is actually
on, which is usually what decides whether the group can play it at all.

The note lives here too — one field, saved as an ordinary upsert, so it syncs
like any other change.

Tapping the pencil icon opens an edit modal for the title and platform
only — the two things someone actually gets wrong (a typo, or the console
they meant to add it for). Cover, year and `sourceId` stay fixed once a game
is added: those came from RAWG at add time, and a wrong one usually means
the wrong game was picked, so re-adding via search is the more honest fix
than hand-editing metadata out of sync with where it came from.

## Queue order

On Deck is the one list where a game's position actually matters — it's the
answer to "what do we play next". On Stage and Played It are read as
history and stay sorted by recency, same as always.

Reordering happens from the detail sheet — "▲ Play sooner" / "▼ Play later"
— not the row, for the same reason Delete lives there: a row carries one
action, and a phone-width title has no room to spare for a second (see
"A row carries one action" under Design system).

Backed by a per-game `order` field, populated when a game is added (new
games land at the front, the same place they've always appeared) and
otherwise left alone — reordering just swaps two `order` values, nothing
else. It deliberately doesn't touch `updatedAt`: a reorder is a position
change, not a content change, and stamping it would make a game's "Xm ago"
label lie about when it was actually last touched. Games added before this
feature existed fall back to their `updatedAt`, reproducing exactly the
order they already had, so nothing visibly reshuffles until someone taps a
button.

## One game on stage

With a group this size, On Stage means one thing: the game everyone's
playing right now, however many platforms that spans via cross-play — not a
slot per person. Promoting a second game there demotes whatever was already
on stage back to On Deck, rather than leaving two now-playing cards stacked
on top of each other. The demoted game gets a normal `updatedAt` stamp,
unlike a queue reorder, since this is a real status change.

This is best-effort, not enforced server-side: two people promoting
different games in the same instant could still both land as playing until
someone touches one of them again — the same tradeoff the rest of this app
already accepts for simultaneous edits.

## Sync

Polling every 20s, plus an immediate poll whenever the tab becomes visible again.
Polling pauses while the tab is hidden. Real-time push would mean a Durable
Object; it has not been needed.

## Identity

No accounts. Each person types a name once and it is kept in `localStorage` on
their own device under `game-night:my-name`. It is never sent anywhere except as
the `addedBy`/`updatedBy` label on a game they touch.

## Design system

"Neon Grid" — synthwave arcade. Replaced the original backstage/setlist theme
(gaffer tape, torn paper, ticket stubs) in full.

- Deep indigo ground shading `#2B0F4D` to `#0B0520`, magenta `#FF3CAC`,
  violet `#7B2FF7`, cyan `#21D4FD`. Platform tags keep their own colours —
  PC cyan, PS5 indigo, Xbox green, Switch red, Other orange — because everyone
  already reads them at a glance.
- **The colours mean things.** The magenta-to-violet gradient (`--grad`) marks
  anything actionable: the selected tab, primary buttons, the FAB, the on-stage
  card. Cyan marks anything informational: focused fields, the forward arrow.
  Keep that split when adding UI.
- 'Orbitron' (800) for display type, 'Rajdhani' for everything else. Rajdhani
  runs small, so body copy sits at 15-17px rather than the 13px you would use
  with a normal UI face.
- Rounded cards and pill shapes throughout; every control is at least 44px.
- A grid horizon is painted on `body::after`, fixed to the bottom of the
  viewport behind the content.
- **On stage** is the one game being played and gets a card of its own: gradient
  fill, magenta border and glow, a larger cover, a bigger title, and a
  "NOW PLAYING" pill hung off the top edge via `.stub.now::before`. Its
  controls sit on their own row — beside the title they left about 90px for it.
- **A row carries one action.** Move forward, or move back on a played game.
  Delete is in the detail sheet only. Every extra control costs roughly 52px of
  title, which at phone width is the difference between reading a game's name
  and reading two letters of it.
- Tag pills tint themselves from a `--tagc` custom property set inline by
  `tagEl`, via `color-mix` — so a platform colour only has to be stated once.

## Known gaps

- **One code for everyone.** Anyone holding it can add, move and delete. There is
  no per-person identity behind the names, so ownership rules would be theatre.
  Rotating the code is the only revocation.

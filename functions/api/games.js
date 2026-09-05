/**
 * The shared set list, for everyone on the link.
 *
 * The whole catalog lives under ONE KV key rather than one key per game. The
 * per-game layout the artifact used would cost a list + N gets on every poll;
 * with a handful of friends polling every 20s that runs into six figures of
 * reads a day and off the back of the free tier. One key means one read per
 * poll, which keeps this comfortably free.
 *
 * The tradeoff is that a write rewrites the whole list, so two people adding a
 * game in the same instant can lose one of the two. For a weekly game night
 * that window is not worth a Durable Object.
 */

const KEY = 'catalog';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // The list changes behind the browser's back, so a cached copy is
      // always the wrong answer.
      'Cache-Control': 'no-store',
    },
  });
}

async function readCatalog(env) {
  const raw = await env.GAMES_KV.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt value should not take the app down; an empty list still
    // renders, and the next write repairs the key.
    return [];
  }
}

const BACKUP_PREFIX = 'catalog:backup:';
const BACKUP_RETENTION_DAYS = 30;

/**
 * Keeps one snapshot of the catalog per UTC day, taken just before that day's
 * first write. A single KV key with no history otherwise has no way back if
 * a write goes wrong — a fat-fingered delete, a bug, a corrupted value.
 *
 * Deliberately one snapshot a day, not one per write: with several writes an
 * evening, anything finer would burn through the free tier's write quota for
 * no real benefit over a single known-good copy from before today started.
 * Restoring is a manual `wrangler kv key put` from the backup key — see the
 * README — since a recovery this rare doesn't earn its own UI or auth.
 */
async function snapshotBeforeWrite(env, catalogBeforeWrite) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  const key = BACKUP_PREFIX + today;
  const already = await env.GAMES_KV.get(key);
  if (already) return;

  await env.GAMES_KV.put(key, JSON.stringify(catalogBeforeWrite));

  // Pruning here, on the one write a day that takes a snapshot, stands in
  // for a scheduled job — Pages Functions have no cron of their own to prune
  // on. The extra list + deletes cost nothing worth worrying about at this
  // frequency.
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const { keys } = await env.GAMES_KV.list({ prefix: BACKUP_PREFIX });
  for (const k of keys) {
    const day = k.name.slice(BACKUP_PREFIX.length);
    const t = Date.parse(day);
    if (!Number.isNaN(t) && t < cutoff) {
      await env.GAMES_KV.delete(k.name);
    }
  }
}

const STATUSES = new Set(['up_next', 'playing', 'played']);
const PLATFORMS = new Set(['PC', 'PS5', 'Xbox', 'Switch', 'Other']);
// The client's own uid() only ever produces this shape (a leading letter,
// then base36 characters); this is deliberately a little looser than that
// exact output so a future change to id generation doesn't need a matching
// change here, while still ruling out anything that could break out of an
// HTML attribute.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The client renders id, year and platform straight into HTML — id and
 * platform as literal text/attribute values, year as text next to a title —
 * same as coverUrl renders into an <img src>. They're escaped on that side
 * too, but anyone holding the shared pass code can POST directly to this
 * route, so every field that ends up in the DOM unescaped-by-default gets a
 * format check here as well, not just wherever a render site remembers to
 * call escapeHtml.
 */
function invalidGame(game) {
  if (typeof game !== 'object' || game === null) return 'Body must be a game object';
  if (typeof game.id !== 'string' || !ID_PATTERN.test(game.id)) {
    return 'id must be a short alphanumeric string';
  }
  if (typeof game.title !== 'string' || game.title.trim() === '') return 'title must be a non-empty string';
  if (!STATUSES.has(game.status)) return 'status must be up_next, playing or played';
  if (!PLATFORMS.has(game.platform)) return 'platform must be PC, PS5, Xbox, Switch or Other';
  if (game.coverUrl != null && !/^https:\/\//i.test(game.coverUrl)) {
    return 'coverUrl must be a full https URL or null';
  }
  if (game.year != null && !(Number.isInteger(game.year) && game.year > 1900 && game.year < 3000)) {
    return 'year must be a plausible integer or null';
  }
  return null;
}

export async function onRequestGet({ env }) {
  if (!env.GAMES_KV) {
    return json({ error: 'Server misconfigured: GAMES_KV is not bound' }, 500);
  }
  return json({ games: await readCatalog(env) });
}

/**
 * Remove a game for everyone. The id rides in the query string rather than a
 * body, since a DELETE body is unevenly supported by intermediaries.
 *
 * Deleting something already gone returns 200, not 404 — same replay-safe
 * contract as POST. Two people deleting the same game at once is a normal
 * outcome on a shared list, not an error either of them should see.
 */
export async function onRequestDelete({ request, env }) {
  if (!env.GAMES_KV) {
    return json({ error: 'Server misconfigured: GAMES_KV is not bound' }, 500);
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return json({ error: 'id query parameter is required' }, 400);
  }

  const games = await readCatalog(env);
  const kept = games.filter((g) => g.id !== id);

  // Skip the write when nothing changed, so a duplicate delete does not burn
  // one of the free tier's 1,000 daily writes.
  if (kept.length !== games.length) {
    await snapshotBeforeWrite(env, games);
    await env.GAMES_KV.put(KEY, JSON.stringify(kept));
  }

  return json({ games: kept, deleted: kept.length !== games.length });
}

/**
 * Upsert by id, so this one route covers both adding a game and moving one
 * between lists. Replaying the same POST lands on the same result, which is
 * what makes the client's retry-on-failure safe.
 */
export async function onRequestPost({ request, env }) {
  if (!env.GAMES_KV) {
    return json({ error: 'Server misconfigured: GAMES_KV is not bound' }, 500);
  }

  let game;
  try {
    game = await request.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const problem = invalidGame(game);
  if (problem) return json({ error: problem }, 400);

  const games = await readCatalog(env);
  await snapshotBeforeWrite(env, games.slice());

  const at = games.findIndex((g) => g.id === game.id);
  if (at === -1) games.push(game);
  else games[at] = game;

  games.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  await env.GAMES_KV.put(KEY, JSON.stringify(games));

  return json({ games });
}

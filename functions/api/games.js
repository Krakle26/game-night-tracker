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

const STATUSES = new Set(['up_next', 'playing', 'played']);

function invalidGame(game) {
  if (typeof game !== 'object' || game === null) return 'Body must be a game object';
  if (typeof game.id !== 'string' || game.id === '') return 'id must be a non-empty string';
  if (typeof game.title !== 'string' || game.title.trim() === '') return 'title must be a non-empty string';
  if (!STATUSES.has(game.status)) return 'status must be up_next, playing or played';
  return null;
}

export async function onRequestGet({ env }) {
  if (!env.GAMES_KV) {
    return json({ error: 'Server misconfigured: GAMES_KV is not bound' }, 500);
  }
  return json({ games: await readCatalog(env) });
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
  const at = games.findIndex((g) => g.id === game.id);
  if (at === -1) games.push(game);
  else games[at] = game;

  games.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  await env.GAMES_KV.put(KEY, JSON.stringify(games));

  return json({ games });
}

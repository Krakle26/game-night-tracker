/**
 * Guards every /api route. Gating the HTML instead would be pointless — the
 * page is static and public, and anyone could call the data routes directly.
 *
 * One shared code for the whole group, which suits an app with no accounts:
 * there is nothing per-person to authenticate, only "are you one of us".
 */

const FAIL_PREFIX = 'authfail:';
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;
const MIN_TTL_SECONDS = 60; // Cloudflare KV won't accept an expirationTtl below this.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Hashing both sides first guarantees equal length, so the comparison below
 * runs in constant time whatever the input. A plain === would bail on the first
 * differing byte and leak the code's prefix through response timing.
 */
async function constantTimeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/**
 * The pass code is a 192-bit random token (see `npm run token`), so brute
 * force is already computationally infeasible whether or not this exists —
 * it isn't closing a realistic crack-the-code attack. What it closes is a
 * script being able to hammer this endpoint at network speed indefinitely
 * for free; ten guesses per five minutes per IP looks like someone mistyping
 * a code, not someone automating guesses.
 *
 * State lives under an authfail: prefix in the same KV namespace the catalog
 * already uses — standing up a second binding for a few bytes of counter
 * data isn't worth it. Unlike the catalog backups, every key here is meant
 * to expire, so KV's own per-key TTL does the cleanup with no prune step.
 */
async function tooManyFailures(env, ip) {
  const raw = await env.GAMES_KV.get(FAIL_PREFIX + ip);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  const fresh = record && Date.now() - record.windowStart <= WINDOW_MS;
  return fresh && record.count >= MAX_ATTEMPTS ? record : null;
}

async function recordFailure(env, ip) {
  const key = FAIL_PREFIX + ip;
  const now = Date.now();
  const raw = await env.GAMES_KV.get(key);
  let record = null;
  try {
    record = raw ? JSON.parse(raw) : null;
  } catch {
    record = null;
  }
  if (!record || now - record.windowStart > WINDOW_MS) {
    record = { count: 0, windowStart: now };
  }
  record.count += 1;

  const remainingMs = WINDOW_MS - (now - record.windowStart);
  const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.ceil(remainingMs / 1000));
  await env.GAMES_KV.put(key, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

export async function onRequest({ request, env, next }) {
  if (!env.APP_TOKEN) {
    return json({ error: 'Server misconfigured: APP_TOKEN is not set' }, 500);
  }

  // Cloudflare sets this at the edge from the real connection, not from
  // anything the client sent — unlike X-Forwarded-For, it can't be spoofed
  // by whoever's making the request.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Lockout state piggybacks on the catalog's KV binding (see above). If
  // that binding is ever missing, every /api route is already about to 500
  // on its own — so auth fails open here rather than this file reaching for
  // a binding it doesn't own.
  if (env.GAMES_KV && (await tooManyFailures(env, ip))) {
    return json({ error: 'Too many attempts — wait a few minutes and try again.' }, 429);
  }

  const sent = request.headers.get('X-App-Token') ?? '';
  if (!(await constantTimeEqual(sent, env.APP_TOKEN))) {
    if (env.GAMES_KV) await recordFailure(env, ip);
    return json({ error: 'Unauthorized' }, 401);
  }

  if (env.GAMES_KV) await env.GAMES_KV.delete(FAIL_PREFIX + ip);
  return next();
}

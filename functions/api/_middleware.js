/**
 * Guards every /api route. Gating the HTML instead would be pointless — the
 * page is static and public, and anyone could call the data routes directly.
 *
 * One shared code for the whole group, which suits an app with no accounts:
 * there is nothing per-person to authenticate, only "are you one of us".
 */

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

export async function onRequest({ request, env, next }) {
  if (!env.APP_TOKEN) {
    return json({ error: 'Server misconfigured: APP_TOKEN is not set' }, 500);
  }

  const sent = request.headers.get('X-App-Token') ?? '';
  if (!(await constantTimeEqual(sent, env.APP_TOKEN))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  return next();
}

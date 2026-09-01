import {
  SESSION_TTL_SECONDS,
  json,
  normalizePhone,
  phoneHmac,
  randomToken,
  sessionCookie,
  sha256Hex,
  validateTurnstile,
  withDatabase
} from '../../_shared.js';

const LOGIN_FAILED = '手机号或人机验证无效。';

export const onRequestPost = withDatabase(async ({ request, env }) => {
  if (typeof env.PHONE_PEPPER !== 'string' || new TextEncoder().encode(env.PHONE_PEPPER).byteLength < 32
      || typeof env.TURNSTILE_SECRET !== 'string' || !env.TURNSTILE_SECRET) {
    return json({ error: '登录服务尚未配置完成。' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const phone = normalizePhone(body?.phone);
  const token = typeof body?.turnstile_token === 'string' ? body.turnstile_token : '';
  const address = request.headers.get('CF-Connecting-IP') || '';
  const fetcher = typeof env.TURNSTILE_FETCH === 'function' ? env.TURNSTILE_FETCH : fetch;
  const turnstileValid = address
    ? await validateTurnstile(token, address, env.TURNSTILE_SECRET, fetcher)
    : false;
  const digest = await phoneHmac(phone || '10000000000', env.PHONE_PEPPER);
  const user = await env.DB.prepare(`
    SELECT id, phone_last4, note
    FROM users
    WHERE phone_hmac = ?1 AND enabled = 1
  `).bind(digest).first();
  if (!phone || !turnstileValid || !user) return json({ error: LOGIN_FAILED }, 401);

  const session = randomToken();
  const sessionHash = await sha256Hex(session);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(createdAt.toISOString()),
    env.DB.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4)
    `).bind(sessionHash, user.id, createdAt.toISOString(), expiresAt.toISOString())
  ]);
  return json({ user: { id: user.id, phone_last4: user.phone_last4, note: user.note } }, 200, {
    'Set-Cookie': sessionCookie(session)
  });
});

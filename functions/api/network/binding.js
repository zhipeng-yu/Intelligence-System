import { json, sessionToken, sha256Hex, withUser } from '../../_shared.js';

export async function expireBindings(env, now = new Date().toISOString()) {
  await env.DB.prepare(`UPDATE network_bindings SET status = 'invalid', challenge_json = NULL,
    public_key = NULL, owner_session_hash = NULL, expires_at = NULL
    WHERE status IN ('queued','waiting') AND NOT EXISTS (SELECT 1 FROM sessions
      WHERE token_hash = network_bindings.owner_session_hash AND user_id = network_bindings.user_id AND expires_at > ?1)
  `).bind(now).run();
  await env.DB.prepare(`UPDATE network_bindings SET status = 'expired', challenge_json = NULL,
    public_key = NULL, owner_session_hash = NULL, expires_at = NULL
    WHERE status = 'waiting' AND expires_at <= ?1`).bind(now).run();
  await env.DB.prepare(`UPDATE network_bindings SET lease_request_id = NULL,
    lease_token_hash = NULL, lease_expires_at = NULL,
    status = CASE WHEN status IN ('queued','waiting') AND request_id = lease_request_id THEN 'expired' ELSE status END,
    challenge_json = NULL WHERE lease_expires_at <= ?1`).bind(now).run();
}

export async function bindingReady(env, userId) {
  return Boolean(await env.DB.prepare(`SELECT user_id FROM network_bindings
    WHERE user_id = ?1 AND status = 'ready' AND lease_token_hash IS NULL`).bind(userId).first());
}

export const onRequestGet = withUser(async ({ request, env, user }) => {
  await expireBindings(env);
  const row = await env.DB.prepare(`SELECT status, request_id, owner_session_hash,
    challenge_json, expires_at FROM network_bindings WHERE user_id = ?1`).bind(user.id).first();
  const owner = row?.owner_session_hash === await sha256Hex(sessionToken(request));
  return json({ binding: { status: row?.status || 'unbound', request_id: row?.request_id || null,
    expires_at: row?.expires_at || null,
    challenge: owner && row.status === 'waiting' && row.challenge_json ? JSON.parse(row.challenge_json) : null } });
});

export const onRequestPost = withUser(async ({ request, env, user }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  if (!['bind', 'unbind'].includes(body?.action)) return json({ error: '绑定操作无效。' }, 400);
  let publicKey = null;
  if (body.action === 'bind') {
    try {
      if (typeof body.public_key !== 'string' || body.public_key.length > 1000) throw new Error();
      const bytes = Uint8Array.from(atob(body.public_key), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('spki', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      if (key.algorithm.modulusLength !== 2048) throw new Error();
      publicKey = body.public_key;
    } catch { return json({ error: '请重新打开绑定窗口。' }, 400); }
  }
  if (body.action === 'bind' && (await env.DB.prepare('SELECT halted FROM network_worker_control WHERE id = 1').first())?.halted) {
    return json({ error: '工作器已因安全验证停机，请联系管理员人工恢复。' }, 409);
  }
  await expireBindings(env);
  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const status = body.action === 'bind' ? 'queued' : 'unbinding';
  const result = await env.DB.prepare(`INSERT INTO network_bindings
    (user_id, profile_id, request_id, status, created_at, owner_session_hash, public_key)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
    WHERE NOT EXISTS (SELECT 1 FROM watched_accounts WHERE user_id = ?1 AND status = 'running')
      AND NOT EXISTS (SELECT 1 FROM network_search_jobs WHERE user_id = ?1 AND status = 'running')
    ON CONFLICT(user_id) DO UPDATE SET request_id = excluded.request_id, status = excluded.status,
      created_at = excluded.created_at, owner_session_hash = excluded.owner_session_hash,
      public_key = excluded.public_key, challenge_json = NULL, expires_at = NULL
    WHERE network_bindings.created_at <= ?8
  `).bind(user.id, crypto.randomUUID(), requestId, status, now,
    await sha256Hex(sessionToken(request)), publicKey, new Date(Date.now() - 10000).toISOString()).run();
  if (!result.meta.changes) return json({ error: '请等待当前运行中的核验或检索结束；绑定操作间隔至少 10 秒。' }, 409);
  return json({ binding: { status, request_id: requestId, expires_at: null, challenge: null } }, 202);
});

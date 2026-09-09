import { isWorker, json, sha256Hex, withDatabase } from '../../../_shared.js';

const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));

export const onRequestPost = withDatabase(async ({ request, env }) => {
  if (!await isWorker(request, env)) return json({ error: '工作器凭据无效。' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  if (typeof body?.claim_token !== 'string' || body.claim_token.length > 100) return json({ error: '租约无效。' }, 409);
  const hash = await sha256Hex(body.claim_token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT binding.*, user.enabled,
    EXISTS (SELECT 1 FROM sessions WHERE token_hash = binding.owner_session_hash AND user_id = binding.user_id AND expires_at > ?3) AS owner_active
    FROM network_bindings AS binding
    JOIN users AS user ON user.id = binding.user_id
    WHERE binding.profile_id = ?1 AND binding.lease_token_hash = ?2 AND binding.lease_expires_at > ?3
  `).bind(body.profile_id, hash, now).first();
  if (!row) return json({ error: '租约已失效。' }, 409);
  const current = row.enabled === 1 && (row.status === 'unbinding' || row.owner_active === 1) && row.request_id === row.lease_request_id
    && ['queued','waiting','unbinding'].includes(row.status);
  if (body.status === 'blocked') await env.DB.prepare(`UPDATE network_worker_control
    SET halted = 1, halt_reason = 'security_blocked', updated_at = ?1 WHERE id = 1`).bind(now).run();
  if (body.heartbeat === true) return json({ current });
  if (!current) {
    await env.DB.prepare(`UPDATE network_bindings SET lease_token_hash = NULL,
      lease_request_id = NULL, lease_expires_at = NULL,
      status = CASE WHEN request_id = ?3 AND status IN ('queued','waiting') THEN 'invalid' ELSE status END,
      challenge_json = NULL
      WHERE profile_id = ?1 AND lease_token_hash = ?2
    `).bind(body.profile_id, hash, row.lease_request_id).run();
    return json({ current: false });
  }
  if (body.status === 'waiting') {
    if (row.status !== 'queued' || !row.public_key || typeof body.png !== 'string' || body.png.length > 65000) {
      return json({ error: '二维码无效。' }, 400);
    }
    let png;
    try { png = bytes(body.png); } catch { return json({ error: '二维码无效。' }, 400); }
    if (png.length < 8 || ![137,80,78,71,13,10,26,10].every((value, i) => png[i] === value)) {
      return json({ error: '二维码无效。' }, 400);
    }
    // Only the requesting browser holds the private key, in memory. Database
    // backups cannot recover the QR image after that key is discarded.
    const publicKey = await crypto.subtle.importKey('spki', bytes(row.public_key),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const challenge = {
      iv: base64(iv),
      key: base64(await crypto.subtle.encrypt('RSA-OAEP', publicKey, await crypto.subtle.exportKey('raw', key))),
      data: base64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, png))
    };
    const expires = new Date(Math.min(Date.now() + 120000, Date.parse(row.lease_expires_at) - 10000)).toISOString();
    const updated = await env.DB.prepare(`UPDATE network_bindings SET status = 'waiting',
      challenge_json = ?1, expires_at = ?2 WHERE profile_id = ?3 AND lease_token_hash = ?4
      AND request_id = ?5 AND status = 'queued'
      AND EXISTS (SELECT 1 FROM users WHERE id = network_bindings.user_id AND enabled = 1)
    `).bind(JSON.stringify(challenge), expires, row.profile_id, hash, row.request_id).run();
    return json({ current: Boolean(updated.meta.changes), expires_at: expires });
  }
  if (!['ready','expired','invalid','blocked','unbound'].includes(body.status)
      || (body.status === 'unbound') !== (row.status === 'unbinding')) return json({ error: '绑定状态无效。' }, 400);
  const updated = await env.DB.prepare(`UPDATE network_bindings SET status = ?1,
    challenge_json = NULL, public_key = NULL, owner_session_hash = NULL, expires_at = NULL,
    lease_token_hash = NULL, lease_request_id = NULL, lease_expires_at = NULL
    WHERE profile_id = ?2 AND lease_token_hash = ?3 AND request_id = ?4
    AND EXISTS (SELECT 1 FROM users WHERE id = network_bindings.user_id AND enabled = 1)
  `).bind(body.status, row.profile_id, hash, row.request_id).run();
  return json({ current: Boolean(updated.meta.changes), status: body.status });
});

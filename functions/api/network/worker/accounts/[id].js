import { isWorker, json, sameSecret, sha256Hex, withDatabase } from '../../../../_shared.js';
import { ACCOUNT_ERRORS, accountId } from '../../_shared.js';

export const onRequestPost = withDatabase(async ({ request, env, params }) => {
  if (!await isWorker(request, env)) return json({ error: '工作器凭据无效。' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const token = typeof body?.claim_token === 'string' ? body.claim_token : '';
  if (!token || token.length > 100) return json({ error: '账号核验租约无效。' }, 409);
  const row = await env.DB.prepare(`
    SELECT id, user_id, red_id, status, claim_token_hash, lease_expires_at, result_payload_hash
    FROM watched_accounts WHERE id = ?1
  `).bind(params.id).first();
  if (!row?.claim_token_hash || !await sameSecret(await sha256Hex(token), row.claim_token_hash)) {
    return json({ error: '账号核验租约无效。' }, 409);
  }
  const status = body?.status;
  const account = accountId(body?.account_id);
  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : '';
  const code = body?.error_code;
  if (status === 'ready' ? (!account || body.red_id !== row.red_id || nickname.length > 100 || code != null)
    : (!['failed', 'blocked'].includes(status) || !Object.hasOwn(ACCOUNT_ERRORS, code)
      || ['duplicate', 'lease_expired'].includes(code) || (status === 'blocked') !== (code === 'security_blocked')
      || body?.account_id != null || body?.nickname != null)) {
    return json({ error: '账号核验回传无效。' }, 400);
  }
  const payload = status === 'ready' ? { status, account_id: account, red_id: row.red_id, nickname }
    : { status, error_code: code };
  const hash = await sha256Hex(JSON.stringify(payload));
  if (row.result_payload_hash === hash) return json({ id: row.id, status: row.status, idempotent: true });
  const now = new Date().toISOString();
  if (row.status !== 'running' || !row.lease_expires_at || row.lease_expires_at <= now) {
    return json({ error: '账号核验租约已失效。' }, 409);
  }
  // Duplicate stable IDs become an explicit failure, without changing the existing row.
  const duplicate = status === 'ready' && await env.DB.prepare(`
    SELECT id FROM watched_accounts WHERE user_id = ?1 AND account_id = ?2 AND id <> ?3
  `).bind(row.user_id, account, row.id).first();
  const finalStatus = duplicate ? 'failed' : status;
  const statements = [];
  if (status === 'blocked') statements.push(env.DB.prepare(`
    UPDATE network_worker_control SET halted = 1, halt_reason = 'security_blocked', updated_at = ?1
    WHERE id = 1 AND EXISTS (
      SELECT 1 FROM watched_accounts WHERE id = ?2 AND status = 'running'
        AND claim_token_hash = ?3 AND lease_expires_at > ?1
    )
  `).bind(now, row.id, row.claim_token_hash));
  statements.push(env.DB.prepare(`
    UPDATE watched_accounts SET status = ?1, account_id = ?2, nickname = ?3,
      error_code = ?4, result_payload_hash = ?5, lease_expires_at = NULL
    WHERE id = ?6 AND status = 'running' AND claim_token_hash = ?7 AND lease_expires_at > ?8
  `).bind(finalStatus, finalStatus === 'ready' ? account : null, finalStatus === 'ready' ? nickname : '',
    duplicate ? 'duplicate' : code || null, hash, row.id, row.claim_token_hash, now));
  const updates = await env.DB.batch(statements);
  if (!updates.at(-1).meta.changes) return json({ error: '账号核验租约已失效。' }, 409);
  return json({ id: row.id, status: finalStatus, idempotent: false });
});

import { isWorker, json, sameSecret, sha256Hex, withDatabase } from '../../../../_shared.js';
import { ENDED_STATUSES, validatedWorkerPayload } from '../../_shared.js';

async function materialize(env, job, payload) {
  const statements = [];
  for (const result of payload.results) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO network_search_results (
        id, job_id, account_id, account_name, published_at, title, url, summary
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(
      await sha256Hex(`${job.id}\u0000${result.url}`), job.id, result.account_id,
      result.account_name, result.published_at, result.title, result.url, result.summary
    ));
  }
  statements.push(env.DB.prepare(`
    DELETE FROM network_search_jobs
    WHERE user_id = ?1 AND status IN ('completed', 'partial', 'blocked', 'failed')
      AND id NOT IN (
        SELECT id FROM network_search_jobs
        WHERE user_id = ?1 AND status IN ('completed', 'partial', 'blocked', 'failed')
        ORDER BY created_at DESC, id DESC LIMIT 10
      )
  `).bind(job.user_id));
  await env.DB.batch(statements);
}

export const onRequestPost = withDatabase(async ({ request, env, params }) => {
  if (!await isWorker(request, env)) return json({ error: '工作器凭据无效。' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const claimToken = typeof body?.claim_token === 'string' ? body.claim_token : '';
  if (!claimToken || claimToken.length > 100) return json({ error: '任务租约无效。' }, 409);
  const job = await env.DB.prepare(`
    SELECT id, user_id, accounts_json, window_start_at, created_at, status,
      lease_expires_at, claim_token_hash, result_payload_hash, detail_budget
    FROM network_search_jobs WHERE id = ?1
  `).bind(params.id).first();
  if (!job || !job.claim_token_hash
      || !await sameSecret(await sha256Hex(claimToken), job.claim_token_hash)) {
    return json({ error: '任务租约无效。' }, 409);
  }
  const payload = validatedWorkerPayload(body, job);
  if (!payload) return json({ error: '工作器回传内容无效。' }, 400);
  const serialized = JSON.stringify(payload);
  const payloadHash = await sha256Hex(serialized);
  if (ENDED_STATUSES.has(job.status)) {
    if (job.result_payload_hash !== payloadHash) return json({ error: '任务已经结束。' }, 409);
    if (job.status === 'blocked') await env.DB.prepare(`
      UPDATE network_worker_control
      SET halted = 1, halt_reason = 'security_blocked', updated_at = ?1
      WHERE id = 1
    `).bind(new Date().toISOString()).run();
    await materialize(env, job, payload);
    return json({ id: job.id, status: job.status, idempotent: true });
  }
  if (job.status !== 'running' || !job.lease_expires_at || job.lease_expires_at <= new Date().toISOString()) {
    return json({ error: '任务租约已过期。' }, 409);
  }
  const completedAt = new Date().toISOString();
  const updateStatement = env.DB.prepare(`
    UPDATE network_search_jobs
    SET status = ?1, completed_at = ?2, error_detail = ?3, failures_json = ?4,
        result_payload_hash = ?5, result_payload_json = ?6, lease_expires_at = NULL,
        homepage_candidates = ?7, eligible_candidates = ?8, detail_opens = ?9,
        keyword_checks = ?10, matched_results = ?11, termination_reason = ?12,
        counts_complete = 1
    WHERE id = ?13 AND status = 'running' AND claim_token_hash = ?14
      AND lease_expires_at > ?2 AND result_payload_hash IS NULL
  `).bind(
    payload.status, completedAt, payload.error_detail, JSON.stringify(payload.failures),
    payloadHash, serialized, payload.homepage_candidates, payload.eligible_candidates,
    payload.detail_opens, payload.keyword_checks, payload.matched_results,
    payload.termination_reason, job.id, job.claim_token_hash
  );
  let update;
  if (payload.status === 'blocked') {
    const [, jobUpdate] = await env.DB.batch([
      env.DB.prepare(`
        UPDATE network_worker_control
        SET halted = 1, halt_reason = 'security_blocked', updated_at = ?1
        WHERE id = 1 AND EXISTS (
          SELECT 1 FROM network_search_jobs
          WHERE id = ?2 AND status = 'running' AND claim_token_hash = ?3
            AND lease_expires_at > ?1 AND result_payload_hash IS NULL
        )
      `).bind(completedAt, job.id, job.claim_token_hash),
      updateStatement
    ]);
    update = jobUpdate;
  } else {
    update = await updateStatement.run();
  }
  if (!update.meta.changes) return json({ error: '任务租约已失效。' }, 409);
  await materialize(env, job, payload);
  return json({ id: job.id, status: payload.status, idempotent: false });
});

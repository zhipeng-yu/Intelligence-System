import { isWorker, json, randomToken, sha256Hex, withDatabase } from '../../../_shared.js';
import { parseArray } from '../_shared.js';

export const onRequestPost = withDatabase(async ({ request, env }) => {
  if (!await isWorker(request, env)) return json({ error: '工作器凭据无效。' }, 401);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const claimToken = randomToken();
  const claimHash = await sha256Hex(claimToken);
  const job = await env.DB.prepare(`
    UPDATE network_search_jobs
    SET status = 'running', claimed_at = ?1, lease_expires_at = ?2,
        claim_token_hash = ?3, attempt_count = attempt_count + 1
    WHERE id = (
      SELECT id FROM network_search_jobs
      WHERE status = 'queued'
         OR (status = 'running' AND lease_expires_at <= ?1)
      ORDER BY created_at, id
      LIMIT 1
    )
      AND (status = 'queued' OR (status = 'running' AND lease_expires_at <= ?1))
    RETURNING id, keywords_json, accounts_json, days, window_start_at, created_at, attempt_count
  `).bind(now.toISOString(), leaseExpiresAt, claimHash).first();
  if (!job) return json({ job: null });
  return json({ job: {
    id: job.id,
    claim_token: claimToken,
    keywords: parseArray(job.keywords_json),
    accounts: parseArray(job.accounts_json),
    days: job.days,
    window_start_at: job.window_start_at,
    created_at: job.created_at,
    attempt_count: job.attempt_count,
    lease_expires_at: leaseExpiresAt
  } });
});

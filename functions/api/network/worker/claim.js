import { isWorker, json, randomToken, sha256Hex, withDatabase } from '../../../_shared.js';
import { DETAIL_DAILY_LIMIT, parseArray, shanghaiDate } from '../_shared.js';

export const onRequestPost = withDatabase(async ({ request, env }) => {
  if (!await isWorker(request, env)) return json({ error: '工作器凭据无效。' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const now = new Date();
  const nowIso = now.toISOString();
  if (body?.resume === true) {
    await env.DB.prepare(`
      UPDATE network_worker_control
      SET halted = 0, halt_reason = NULL, updated_at = ?1
      WHERE id = 1
    `).bind(nowIso).run();
    return json({ resumed: true, job: null });
  }
  await env.DB.prepare(`
    UPDATE network_search_jobs
    SET status = 'failed', completed_at = ?1, lease_expires_at = NULL,
        error_detail = '任务租约过期，实际统计未完整上报。',
        termination_reason = 'lease_expired', counts_complete = 0
    WHERE status = 'running' AND lease_expires_at <= ?1
  `).bind(nowIso).run();
  const control = await env.DB.prepare(`
    SELECT halted FROM network_worker_control WHERE id = 1
  `).first();
  if (control?.halted) return json({ job: null, halted: true });

  const budgetDate = shanghaiDate(now);
  const leaseExpiresAt = new Date(now.getTime() + 50 * 60 * 1000).toISOString();
  const claimToken = randomToken();
  const claimHash = await sha256Hex(claimToken);
  const job = await env.DB.prepare(`
    UPDATE network_search_jobs
    SET status = 'running', claimed_at = ?1, lease_expires_at = ?2,
        claim_token_hash = ?3, attempt_count = attempt_count + 1,
        detail_budget = json_array_length(accounts_json) * 20, budget_date = ?4,
        homepage_candidates = 0, eligible_candidates = 0, detail_opens = 0,
        keyword_checks = 0, matched_results = 0, termination_reason = NULL,
        counts_complete = 0
    WHERE id = (
      SELECT queued.id FROM network_search_jobs AS queued
      WHERE queued.status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM network_search_jobs WHERE status = 'running')
        AND EXISTS (SELECT 1 FROM network_worker_control WHERE id = 1 AND halted = 0)
        AND COALESCE((
          SELECT SUM(CASE WHEN counts_complete = 1 THEN detail_opens ELSE detail_budget END)
          FROM network_search_jobs WHERE budget_date = ?4
        ), 0) + json_array_length(queued.accounts_json) * 20 <= ${DETAIL_DAILY_LIMIT}
      ORDER BY queued.created_at, queued.id
      LIMIT 1
    )
      AND status = 'queued'
      AND NOT EXISTS (SELECT 1 FROM network_search_jobs WHERE status = 'running')
      AND EXISTS (SELECT 1 FROM network_worker_control WHERE id = 1 AND halted = 0)
      AND COALESCE((
        SELECT SUM(CASE WHEN counts_complete = 1 THEN detail_opens ELSE detail_budget END)
        FROM network_search_jobs WHERE budget_date = ?4
      ), 0) + json_array_length(accounts_json) * 20 <= ${DETAIL_DAILY_LIMIT}
    RETURNING id, keywords_json, accounts_json, days, window_start_at, created_at,
      attempt_count, detail_budget, budget_date
  `).bind(nowIso, leaseExpiresAt, claimHash, budgetDate).first();
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
    detail_budget: job.detail_budget,
    budget_date: job.budget_date,
    lease_expires_at: leaseExpiresAt
  } });
});

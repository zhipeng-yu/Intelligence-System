import { isWorker, json, randomToken, sha256Hex, withDatabase } from '../../../_shared.js';
import { expireBindings } from '../binding.js';
import { DETAIL_DAILY_LIMIT, parseArray, shanghaiDate } from '../_shared.js';

export const onRequestPost = withDatabase(async ({ request, env }) => {
  if (!await isWorker(request, env)) return json({ error: '工作器凭据无效。' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  if (body?.user_sessions !== true) return json({ error: '工作器需要升级为用户隔离版本。' }, 409);
  await expireBindings(env);
  const now = new Date();
  const nowIso = now.toISOString();
  if (body?.resume === true) {
    const restored = await env.DB.prepare(`UPDATE network_bindings SET status = CASE WHEN status IN ('blocked','invalid') THEN 'ready' ELSE status END
      WHERE profile_id = ?1 AND lease_token_hash IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = network_bindings.user_id AND enabled = 1)
    `).bind(body.profile_id || '').run();
    if (!restored.meta.changes) return json({ error: '请指定需人工恢复的已绑定用户。' }, 409);
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
  await env.DB.prepare(`
    UPDATE watched_accounts SET status = 'failed', error_code = 'lease_expired', lease_expires_at = NULL
    WHERE status = 'running' AND lease_expires_at <= ?1
  `).bind(nowIso).run();
  const control = await env.DB.prepare(`
    SELECT halted FROM network_worker_control WHERE id = 1
  `).first();
  if (control?.halted) return json({ job: null, halted: true });

  const bindingToken = randomToken();
  const bindingHash = await sha256Hex(bindingToken);
  const bindingLease = new Date(now.getTime() + 180000).toISOString();
  const binding = await env.DB.prepare(`UPDATE network_bindings
    SET lease_request_id = request_id, lease_token_hash = ?1, lease_expires_at = ?2
    WHERE user_id = (SELECT user_id FROM network_bindings
      WHERE status IN ('queued','unbinding') AND lease_token_hash IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = network_bindings.user_id AND enabled = 1)
      ORDER BY created_at, user_id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM network_bindings WHERE lease_token_hash IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM network_search_jobs WHERE status = 'running')
      AND NOT EXISTS (SELECT 1 FROM watched_accounts WHERE status = 'running')
      AND EXISTS (SELECT 1 FROM network_worker_control WHERE id = 1 AND halted = 0)
    RETURNING user_id, profile_id, request_id, status
  `).bind(bindingHash, bindingLease).first();
  if (binding) return json({ job: { ...binding, kind: 'binding', claim_token: bindingToken,
    lease_expires_at: bindingLease } });
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
        AND EXISTS (SELECT 1 FROM users WHERE id = queued.user_id AND enabled = 1)
        AND EXISTS (SELECT 1 FROM network_bindings WHERE user_id = queued.user_id AND status = 'ready')
        AND NOT EXISTS (SELECT 1 FROM network_search_jobs WHERE status = 'running')
        AND NOT EXISTS (SELECT 1 FROM watched_accounts WHERE status = 'running')
        AND NOT EXISTS (SELECT 1 FROM network_bindings WHERE lease_token_hash IS NOT NULL)
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
      AND NOT EXISTS (SELECT 1 FROM watched_accounts WHERE status = 'running')
        AND NOT EXISTS (SELECT 1 FROM network_bindings WHERE lease_token_hash IS NOT NULL)
      AND EXISTS (SELECT 1 FROM network_worker_control WHERE id = 1 AND halted = 0)
      AND COALESCE((
        SELECT SUM(CASE WHEN counts_complete = 1 THEN detail_opens ELSE detail_budget END)
        FROM network_search_jobs WHERE budget_date = ?4
      ), 0) + json_array_length(accounts_json) * 20 <= ${DETAIL_DAILY_LIMIT}
    RETURNING id, user_id, keywords_json, accounts_json, days, window_start_at, created_at,
      attempt_count, detail_budget, budget_date
  `).bind(nowIso, leaseExpiresAt, claimHash, budgetDate).first();
  if (!job) {
    const account = await env.DB.prepare(`
      UPDATE watched_accounts
      SET status = 'running', lease_expires_at = ?1, claim_token_hash = ?2
      WHERE id = (
        SELECT id FROM watched_accounts WHERE status = 'queued'
          AND EXISTS (SELECT 1 FROM users WHERE id = watched_accounts.user_id AND enabled = 1)
          AND EXISTS (SELECT 1 FROM network_bindings WHERE user_id = watched_accounts.user_id AND status = 'ready')
        ORDER BY created_at, id LIMIT 1
      ) AND status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM watched_accounts WHERE status = 'running')
        AND NOT EXISTS (SELECT 1 FROM network_bindings WHERE lease_token_hash IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM network_search_jobs WHERE status = 'running')
        AND EXISTS (SELECT 1 FROM network_worker_control WHERE id = 1 AND halted = 0)
      RETURNING id, user_id, red_id
    `).bind(leaseExpiresAt, claimHash).first();
    const profile = account ? await env.DB.prepare('SELECT profile_id FROM network_bindings WHERE user_id = ?1').bind(account.user_id).first() : null;
    return json({ job: account ? {
      ...account, profile_id: profile.profile_id, kind: 'account_resolution', claim_token: claimToken, lease_expires_at: leaseExpiresAt
    } : null });
  }
  const profile = await env.DB.prepare('SELECT profile_id FROM network_bindings WHERE user_id = ?1').bind(job.user_id).first();
  return json({ job: {
    id: job.id, user_id: job.user_id, profile_id: profile.profile_id,
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

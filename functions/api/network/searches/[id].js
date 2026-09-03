import { json, withUser } from '../../../_shared.js';
import { ENDED_STATUSES, parseArray, shanghaiDate } from '../_shared.js';

export const onRequestGet = withUser(async ({ env, user, params }) => {
  const job = await env.DB.prepare(`
    SELECT id, keywords_json, accounts_json, days, window_start_at, created_at,
      status, completed_at, error_detail, failures_json, detail_budget,
      homepage_candidates, eligible_candidates, detail_opens, keyword_checks,
      matched_results, termination_reason, counts_complete, budget_date
    FROM network_search_jobs
    WHERE id = ?1 AND user_id = ?2
  `).bind(params.id, user.id).first();
  if (!job) return json({ error: '检索任务不存在。' }, 404);
  const { results } = await env.DB.prepare(`
    SELECT id, job_id, account_id, account_name, published_at, title, url, summary
    FROM network_search_results
    WHERE job_id = ?1
    ORDER BY published_at DESC, id
  `).bind(job.id).all();
  return json({ search: {
    id: job.id,
    keywords: parseArray(job.keywords_json),
    accounts: parseArray(job.accounts_json),
    days: job.days,
    window_start_at: job.window_start_at,
    created_at: job.created_at,
    status: job.status,
    completed_at: job.completed_at,
    error_detail: job.error_detail,
    failures: parseArray(job.failures_json),
    detail_budget: job.detail_budget,
    homepage_candidates: job.homepage_candidates,
    eligible_candidates: job.eligible_candidates,
    detail_opens: job.detail_opens,
    keyword_checks: job.keyword_checks,
    matched_results: job.matched_results,
    termination_reason: job.termination_reason,
    counts_complete: Boolean(job.counts_complete),
    budget_date: job.budget_date,
    results: results || []
  } });
});

export const onRequestDelete = withUser(async ({ env, user, params }) => {
  const job = await env.DB.prepare(`
    SELECT status, budget_date, detail_budget
    FROM network_search_jobs WHERE id = ?1 AND user_id = ?2
  `).bind(params.id, user.id).first();
  if (!job) return json({ error: '检索任务不存在。' }, 404);
  if (!ENDED_STATUSES.has(job.status)) return json({ error: '只能删除已经结束的检索任务。' }, 409);
  if (job.budget_date === shanghaiDate() && Number(job.detail_budget || 0) > 0) {
    return json({ error: '为保留今日访问预算，该任务可在明日删除。' }, 409);
  }
  await env.DB.prepare(`
    DELETE FROM network_search_jobs WHERE id = ?1 AND user_id = ?2
  `).bind(params.id, user.id).run();
  return json({ id: params.id, deleted: true });
});

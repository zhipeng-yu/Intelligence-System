import { json, withUser } from '../../../_shared.js';
import {
  DETAIL_DAILY_LIMIT, normalizedKeywords, parseArray, shanghaiDate, shanghaiDayBounds
} from '../_shared.js';

const JOB_COLUMNS = `
  id, keywords_json, accounts_json, days, window_start_at, created_at,
  status, completed_at, error_detail, failures_json, detail_budget,
  homepage_candidates, eligible_candidates, detail_opens, keyword_checks,
  matched_results, termination_reason, counts_complete, budget_date
`;

function publicJob(row) {
  return {
    id: row.id,
    keywords: parseArray(row.keywords_json),
    accounts: parseArray(row.accounts_json),
    days: row.days,
    window_start_at: row.window_start_at,
    created_at: row.created_at,
    status: row.status,
    completed_at: row.completed_at,
    error_detail: row.error_detail,
    failures: parseArray(row.failures_json),
    detail_budget: row.detail_budget,
    homepage_candidates: row.homepage_candidates,
    eligible_candidates: row.eligible_candidates,
    detail_opens: row.detail_opens,
    keyword_checks: row.keyword_checks,
    matched_results: row.matched_results,
    termination_reason: row.termination_reason,
    counts_complete: Boolean(row.counts_complete),
    budget_date: row.budget_date,
    results: []
  };
}

export const onRequestGet = withUser(async ({ env, user }) => {
  const today = shanghaiDate();
  const [{ results: jobs }, { results }, budgetRow] = await Promise.all([
    env.DB.prepare(`
      SELECT ${JOB_COLUMNS}
      FROM network_search_jobs
      WHERE user_id = ?1
        AND (
          status IN ('queued', 'running')
          OR id IN (
            SELECT id FROM network_search_jobs
            WHERE user_id = ?1 AND status IN ('completed', 'partial', 'blocked', 'failed')
            ORDER BY created_at DESC, id DESC LIMIT 10
          )
        )
      ORDER BY created_at DESC, id DESC
    `).bind(user.id).all(),
    env.DB.prepare(`
      SELECT result.id, result.job_id, result.account_id, result.account_name,
        result.published_at, result.title, result.url, result.summary
      FROM network_search_results AS result
      JOIN network_search_jobs AS job ON job.id = result.job_id
      WHERE job.user_id = ?1
      ORDER BY result.published_at DESC, result.id
    `).bind(user.id).all(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN counts_complete = 1 THEN detail_opens ELSE 0 END), 0) AS actual,
        COALESCE(SUM(CASE WHEN counts_complete = 0 THEN detail_budget ELSE 0 END), 0) AS reserved,
        MAX(CASE WHEN counts_complete = 0 AND detail_budget > 0 THEN 1 ELSE 0 END) AS incomplete
      FROM network_search_jobs
      WHERE budget_date = ?1
    `).bind(today).first()
  ]);
  const values = (jobs || []).map(publicJob);
  const byId = new Map(values.map(job => [job.id, job]));
  for (const result of results || []) byId.get(result.job_id)?.results.push(result);
  const actual = Number(budgetRow?.actual || 0);
  const reserved = Number(budgetRow?.reserved || 0);
  return json({
    searches: values,
    budget: {
      date: today,
      limit: DETAIL_DAILY_LIMIT,
      actual,
      reserved,
      remaining: Math.max(0, DETAIL_DAILY_LIMIT - actual - reserved),
      incomplete: Boolean(budgetRow?.incomplete)
    }
  });
});

export const onRequestPost = withUser(async ({ request, env, user }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const keywords = normalizedKeywords(body?.keywords);
  const days = Number(body?.days);
  if (!keywords || ![1, 3, 7].includes(days)) return json({ error: '关键词或日期范围无效。' }, 400);
  const { results: accountRows } = await env.DB.prepare(`
    SELECT account_id FROM watched_accounts WHERE user_id = ?1 ORDER BY created_at, id
  `).bind(user.id).all();
  const accounts = (accountRows || []).map(row => row.account_id);
  if (!accounts.length) return json({ error: '请先添加至少一个关注账号。' }, 400);

  const createdAt = new Date();
  const windowStart = new Date(createdAt.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const { start, end } = shanghaiDayBounds(createdAt);
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(`
    INSERT INTO network_search_jobs (
      id, user_id, keywords_json, accounts_json, days, window_start_at, created_at, status
    )
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued'
    WHERE (
      SELECT COUNT(*) FROM network_search_jobs
      WHERE user_id = ?2 AND created_at >= ?8 AND created_at < ?9
    ) < 3
      AND (
        SELECT COUNT(*) FROM network_search_jobs
        WHERE created_at >= ?8 AND created_at < ?9
      ) < 20
      AND NOT EXISTS (
        SELECT 1 FROM network_search_jobs
        WHERE user_id = ?2 AND status IN ('queued', 'running')
      )
  `).bind(
    id, user.id, JSON.stringify(keywords), JSON.stringify(accounts), days,
    windowStart, createdAt.toISOString(), start, end
  ).run();
  if (!result.meta.changes) {
    const limits = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM network_search_jobs
         WHERE user_id = ?1 AND status IN ('queued', 'running')) AS active,
        (SELECT COUNT(*) FROM network_search_jobs
         WHERE user_id = ?1 AND created_at >= ?2 AND created_at < ?3) AS user_today,
        (SELECT COUNT(*) FROM network_search_jobs
         WHERE created_at >= ?2 AND created_at < ?3) AS site_today
    `).bind(user.id, start, end).first();
    const message = limits?.active ? '每位用户同时只能有一个排队中或运行中的任务。'
      : Number(limits?.user_today || 0) >= 3 ? '每位用户每天最多提交 3 次检索。'
        : '全站每天最多提交 20 次检索。';
    return json({ error: message }, 429);
  }
  return json({ search: {
    id, keywords, accounts, days, window_start_at: windowStart,
    created_at: createdAt.toISOString(), status: 'queued', completed_at: null,
    error_detail: null, failures: [], detail_budget: 0, homepage_candidates: 0,
    eligible_candidates: 0, detail_opens: 0, keyword_checks: 0, matched_results: 0,
    termination_reason: null, counts_complete: false, budget_date: null, results: []
  } }, 201);
});

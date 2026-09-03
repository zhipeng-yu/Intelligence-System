export const ACCOUNT_ID_PATTERN = /^[0-9a-f]{24}$/;
export const ENDED_STATUSES = new Set(['completed', 'partial', 'blocked', 'failed']);
export const DETAIL_DAILY_LIMIT = 180;
export const TERMINATION_REASONS = new Set([
  'results_cap', 'detail_budget_exhausted', 'runtime_cutoff',
  'security_blocked', 'candidates_exhausted', 'worker_failed'
]);

export function accountId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return ACCOUNT_ID_PATTERN.test(normalized) ? normalized : '';
}

export function normalizedKeywords(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const keywords = value.map(item => typeof item === 'string'
    ? item.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
    : '');
  if (keywords.some(item => !item || item.length > 40) || new Set(keywords).size !== keywords.length) return null;
  return keywords;
}

export function shanghaiDayBounds(now = new Date()) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return {
    start: new Date(startLocal - 8 * 60 * 60 * 1000).toISOString(),
    end: new Date(startLocal + 16 * 60 * 60 * 1000).toISOString()
  };
}

export function shanghaiDate(now = new Date()) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function parseArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function publicNoteUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com'
        || url.username || url.password || url.search || url.hash
        || !/^\/explore\/[0-9a-f]{24}$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

export function validatedWorkerPayload(body, job) {
  const status = body?.status;
  if (!['completed', 'partial', 'blocked', 'failed'].includes(status)) return null;
  const results = Array.isArray(body?.results) ? body.results : null;
  const failures = Array.isArray(body?.failures) ? body.failures : null;
  const errorDetail = body?.error_detail == null ? null
    : (typeof body.error_detail === 'string' ? body.error_detail.trim() : '');
  if (!results || results.length > 30 || !failures || (errorDetail !== null && (!errorDetail || errorDetail.length > 500))) {
    return null;
  }
  const metrics = {
    homepage_candidates: body?.homepage_candidates,
    eligible_candidates: body?.eligible_candidates,
    detail_opens: body?.detail_opens,
    keyword_checks: body?.keyword_checks,
    matched_results: body?.matched_results
  };
  if (Object.values(metrics).some(value => !Number.isInteger(value) || value < 0)
      || metrics.homepage_candidates > 60
      || metrics.eligible_candidates > metrics.homepage_candidates
      || metrics.detail_opens > metrics.eligible_candidates
      || metrics.keyword_checks > metrics.detail_opens
      || metrics.matched_results > metrics.keyword_checks
      || metrics.matched_results > 30
      || metrics.homepage_candidates > Number(job.detail_budget || 0)) return null;
  const terminationReason = typeof body?.termination_reason === 'string' ? body.termination_reason : '';
  const reasonsByStatus = {
    completed: new Set(['results_cap', 'candidates_exhausted']),
    partial: new Set(['results_cap', 'detail_budget_exhausted', 'runtime_cutoff', 'candidates_exhausted']),
    blocked: new Set(['security_blocked']),
    failed: new Set(['worker_failed'])
  };
  if (!TERMINATION_REASONS.has(terminationReason) || !reasonsByStatus[status].has(terminationReason)) return null;
  const accounts = new Set(parseArray(job.accounts_json));
  const seenUrls = new Set();
  const cleanResults = [];
  for (const item of results) {
    const account = accountId(item?.account_id);
    const name = typeof item?.account_name === 'string' ? item.account_name.trim() : '';
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const summary = typeof item?.summary === 'string' ? item.summary.trim() : '';
    const url = publicNoteUrl(item?.url);
    const published = new Date(item?.published_at);
    if (!accounts.has(account) || !name || name.length > 100 || !title || title.length > 200
        || summary.length < 100 || summary.length > 200 || !url || seenUrls.has(url)
        || Number.isNaN(published.getTime())
        || published < new Date(job.window_start_at) || published > new Date(job.created_at)) return null;
    seenUrls.add(url);
    cleanResults.push({
      account_id: account,
      account_name: name,
      published_at: published.toISOString(),
      title,
      url,
      summary
    });
  }
  const cleanFailures = [];
  const failedAccounts = new Set();
  for (const failure of failures) {
    const account = accountId(failure?.account_id);
    const reason = typeof failure?.reason === 'string' ? failure.reason.trim() : '';
    if (!accounts.has(account) || failedAccounts.has(account) || !reason || reason.length > 200) return null;
    failedAccounts.add(account);
    cleanFailures.push({ account_id: account, reason });
  }
  if (status === 'completed' && cleanFailures.length) return null;
  if (status === 'partial' && !cleanFailures.length
      && !['detail_budget_exhausted', 'runtime_cutoff'].includes(terminationReason)) return null;
  if ((status === 'blocked' || status === 'failed') && !errorDetail) return null;
  if (metrics.matched_results !== cleanResults.length) return null;
  cleanResults.sort((left, right) => right.published_at.localeCompare(left.published_at) || left.url.localeCompare(right.url));
  return {
    status, results: cleanResults.slice(0, 30), failures: cleanFailures, error_detail: errorDetail,
    termination_reason: terminationReason, ...metrics
  };
}

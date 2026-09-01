import { json, withUser } from '../../../_shared.js';
import { accountId } from '../_shared.js';

export const onRequestGet = withUser(async ({ env, user }) => {
  const { results } = await env.DB.prepare(`
    SELECT id, account_id, created_at
    FROM watched_accounts
    WHERE user_id = ?1
    ORDER BY created_at, id
  `).bind(user.id).all();
  return json({ accounts: results || [] });
});

export const onRequestPost = withUser(async ({ request, env, user }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const account = accountId(body?.account_id);
  if (!account) return json({ error: '只接受 24 位标准小红书账号 ID。' }, 400);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    const result = await env.DB.prepare(`
      INSERT INTO watched_accounts (id, user_id, account_id, created_at)
      SELECT ?1, ?2, ?3, ?4
      WHERE (SELECT COUNT(*) FROM watched_accounts WHERE user_id = ?2) < 3
        AND NOT EXISTS (
          SELECT 1 FROM watched_accounts WHERE user_id = ?2 AND account_id = ?3
        )
    `).bind(id, user.id, account, createdAt).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare(`
        SELECT COUNT(*) AS count,
          EXISTS (SELECT 1 FROM watched_accounts WHERE user_id = ?1 AND account_id = ?2) AS duplicate
        FROM watched_accounts WHERE user_id = ?1
      `).bind(user.id, account).first();
      return json({ error: existing?.duplicate ? '该账号已关注。' : '每位用户最多关注 3 个账号。' }, 409);
    }
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error))) return json({ error: '该账号已关注。' }, 409);
    throw error;
  }
  return json({ account: { id, account_id: account, created_at: createdAt } }, 201);
});

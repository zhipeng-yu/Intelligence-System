import { json, withUser } from '../../../_shared.js';
import { ACCOUNT_ERRORS, redId } from '../_shared.js';

export const onRequestGet = withUser(async ({ env, user }) => {
  const { results } = await env.DB.prepare(`
    SELECT id, account_id, red_id, nickname, status, error_code, created_at
    FROM watched_accounts WHERE user_id = ?1 ORDER BY created_at, id
  `).bind(user.id).all();
  return json({ accounts: (results || []).map(row => ({
    ...row, error_detail: ACCOUNT_ERRORS[row.error_code] || null
  })) });
});

export const onRequestPost = withUser(async ({ request, env, user }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const number = redId(body?.red_id);
  if (!number) return json({ error: '请填写主页显示的小红书号（字母、数字、下划线或短横线，最多 64 位），不要填写昵称或链接。' }, 400);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO watched_accounts (id, user_id, red_id, created_at, status)
      VALUES (?1, ?2, ?3, ?4, 'queued')
    `).bind(id, user.id, number, createdAt).run();
  } catch (error) {
    const message = String(error);
    if (/account_slots_full/.test(message)) return json({ error: '每位用户最多保存 3 个账号（含待核验和失败申请）。' }, 409);
    if (/account_work_active/.test(message)) return json({ error: '请等待当前账号核验或检索结束后再添加。' }, 409);
    if (/account_daily_limit/.test(message)) return json({ error: '今日账号核验申请已达上限：每人 3 次，全站 20 次。' }, 429);
    if (/UNIQUE/.test(message)) return json({ error: '该小红书号已在账号列表中。' }, 409);
    throw error;
  }
  return json({ account: { id, red_id: number, nickname: '', status: 'queued', created_at: createdAt } }, 202);
});

import { json, withUser } from '../../../_shared.js';

export const onRequestDelete = withUser(async ({ env, user, params }) => {
  const account = await env.DB.prepare(`
    SELECT status FROM watched_accounts WHERE id = ?1 AND user_id = ?2
  `).bind(params.id, user.id).first();
  if (!account) return json({ error: '关注账号不存在。' }, 404);
  if (account.status === 'running') return json({ error: '账号正在核验，请结束后再删除。' }, 409);
  const result = await env.DB.prepare(`
    DELETE FROM watched_accounts WHERE id = ?1 AND user_id = ?2 AND status <> 'running'
  `).bind(params.id, user.id).run();
  if (!result.meta.changes) return json({ error: '账号状态已变化，请刷新后重试。' }, 409);
  return json({ id: params.id, deleted: true });
});

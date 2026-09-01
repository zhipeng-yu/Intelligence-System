import { json, withUser } from '../../../_shared.js';

export const onRequestDelete = withUser(async ({ env, user, params }) => {
  const result = await env.DB.prepare(`
    DELETE FROM watched_accounts WHERE id = ?1 AND user_id = ?2
  `).bind(params.id, user.id).run();
  if (!result.meta.changes) return json({ error: '关注账号不存在。' }, 404);
  return json({ id: params.id, deleted: true });
});

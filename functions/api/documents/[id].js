import { json, withAuth } from '../../_shared.js';

export const onRequestDelete = withAuth(async ({ env, params }) => {
  const deletedAt = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE documents
    SET deleted_at = ?1
    WHERE id = ?2 AND deleted_at IS NULL
  `).bind(deletedAt, params.id).run();

  if (!result.meta.changes) return json({ error: '资料不存在。' }, 404);
  return json({ id: params.id, deleted_at: deletedAt });
});

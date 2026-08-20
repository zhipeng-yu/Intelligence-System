import { json, STATUSES, withAuth } from '../../_shared.js';

export const onRequestPatch = withAuth(async ({ request, env, params }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '状态请求格式无效。' }, 400);
  }

  if (!body || !STATUSES.includes(body.status)) {
    return json({ error: '状态只能是“待确认”或“已确认”。' }, 400);
  }

  const result = await env.DB.prepare(`
    UPDATE documents
    SET status = ?1
    WHERE id = ?2 AND deleted_at IS NULL
  `).bind(body.status, params.id).run();

  if (!result.meta.changes) return json({ error: '资料不存在。' }, 404);
  return json({ id: params.id, status: body.status });
});

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

import { PROFILE_STATUSES, json, withAuth } from '../../_shared.js';

export const onRequestPatch = withAuth(async ({ request, env, params }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '候选状态请求格式无效。' }, 400);
  }
  if (!body || !PROFILE_STATUSES.includes(body.status)) {
    return json({ error: '候选状态无效。' }, 400);
  }

  const candidate = await env.DB.prepare(`
    SELECT value.id, document.status AS document_status
    FROM profile_values AS value
    JOIN documents AS document
      ON document.id = value.document_id AND document.deleted_at IS NULL
    WHERE value.id = ?1 AND value.deleted_at IS NULL
  `).bind(params.id).first();
  if (!candidate) return json({ error: '候选信息不存在或来源已删除。' }, 404);
  if (body.status === '已确认' && candidate.document_status !== '已确认') {
    return json({ error: '请先把来源资料设为“已确认”。' }, 409);
  }

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE profile_values
    SET status = ?1, updated_at = ?2
    WHERE id = ?3 AND deleted_at IS NULL
  `).bind(body.status, updatedAt, params.id).run();
  return json({ id: params.id, status: body.status, updated_at: updatedAt });
});

export const onRequestDelete = withAuth(async ({ env, params }) => {
  const deletedAt = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE profile_values
    SET deleted_at = ?1, updated_at = ?1
    WHERE id = ?2 AND deleted_at IS NULL
  `).bind(deletedAt, params.id).run();
  if (!result.meta.changes) return json({ error: '候选信息不存在。' }, 404);
  return json({ id: params.id, deleted_at: deletedAt });
});

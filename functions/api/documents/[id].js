import { MACHINE_XHS_SCOPE, json, withAdminUser } from '../../_shared.js';

export const onRequestDelete = withAdminUser(async ({ env, params }) => {
  const document = await env.DB.prepare(`
    SELECT id, object_key, undone_at,
      EXISTS (
        SELECT 1 FROM profile_history
        WHERE change_document_id = documents.id
      ) AS has_changes,
      EXISTS (
        SELECT 1 FROM profile_sections
        WHERE source_document_id = documents.id
      ) AS is_current_source
    FROM documents
    WHERE id = ?1 AND deleted_at IS NULL
      AND (scope IS NULL OR scope <> ?2)
  `).bind(params.id, MACHINE_XHS_SCOPE).first();
  if (!document) return json({ error: '资料不存在。' }, 404);
  if (document.is_current_source || (!document.undone_at && document.has_changes)) {
    return json({ error: '这份资料仍在有效画像中，请先按顺序撤销对应更新。' }, 409);
  }

  await env.BUCKET.delete(document.object_key);
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE profile_history
      SET source_document_id = NULL
      WHERE source_document_id = ?1
    `).bind(params.id),
    env.DB.prepare(`
      UPDATE profile_history
      SET change_document_id = NULL
      WHERE change_document_id = ?1
    `).bind(params.id),
    env.DB.prepare(`
      DELETE FROM documents
      WHERE id = ?1 AND deleted_at IS NULL
    `).bind(params.id)
  ]);
  if (!results[2].meta.changes) return json({ error: '资料不存在。' }, 404);
  return json({ id: params.id, deleted: true });
}, true);

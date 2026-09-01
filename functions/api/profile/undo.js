import { OTHER_PRODUCTS_SECTION_KEY, json, withAdminUser } from '../../_shared.js';

export const onRequestPost = withAdminUser(async ({ env }) => {
  const document = await env.DB.prepare(`
    SELECT document.id
    FROM documents AS document
    JOIN profile_history AS history ON history.change_document_id = document.id
    WHERE document.deleted_at IS NULL AND document.undone_at IS NULL
      AND history.section_key <> ?1
    GROUP BY document.id
    ORDER BY MAX(history.changed_at) DESC, document.uploaded_at DESC, document.id DESC
    LIMIT 1
  `).bind(OTHER_PRODUCTS_SECTION_KEY).first();
  if (!document) return json({ error: '没有可撤销的画像更新。' }, 409);

  const { results } = await env.DB.prepare(`
    SELECT section_key, content, source_document_id, previous_updated_at
    FROM profile_history
    WHERE change_document_id = ?1 AND section_key <> ?2
    ORDER BY section_key
  `).bind(document.id, OTHER_PRODUCTS_SECTION_KEY).all();
  if (!results?.length) return json({ error: '没有可撤销的画像更新。' }, 409);

  const undoneAt = new Date().toISOString();
  const statements = [env.DB.prepare(`
    UPDATE documents
    SET undone_at = ?1
    WHERE id = ?2 AND undone_at IS NULL
  `).bind(undoneAt, document.id)];
  for (const history of results) {
    statements.push(env.DB.prepare(`
      UPDATE profile_sections
      SET content = ?1, source_document_id = ?2, updated_at = ?3
      WHERE section_key = ?4
        AND EXISTS (
          SELECT 1 FROM documents
          WHERE id = ?5 AND undone_at = ?6
        )
    `).bind(
      history.content, history.source_document_id, history.previous_updated_at,
      history.section_key, document.id, undoneAt
    ));
  }
  const [claim] = await env.DB.batch(statements);
  if (!claim.meta.changes) return json({ error: '最近一次画像更新已经撤销。' }, 409);

  return json({
    id: document.id,
    undone_at: undoneAt,
    restored_sections: results.map(history => history.section_key)
  });
}, true);

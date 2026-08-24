import {
  MAX_SECTION_CONTENT,
  PROFILE_SECTION_BY_KEY,
  json,
  withAuth
} from '../../_shared.js';

export const onRequestPatch = withAuth(async ({ request, env, params }) => {
  if (!PROFILE_SECTION_BY_KEY.has(params.id)) return json({ error: '画像卡片不存在。' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '画像更新请求格式无效。' }, 400);
  }

  if (body?.unlock === true) {
    const result = await env.DB.prepare(`
      UPDATE profile_sections SET locked = 0 WHERE section_key = ?1
    `).bind(params.id).run();
    if (!result.meta.changes) return json({ error: '画像卡片不存在。' }, 404);
    return json({ section_key: params.id, locked: false });
  }

  if (typeof body?.content !== 'string') return json({ error: '请填写画像内容。' }, 400);
  const content = body.content.trim();
  if (content.length > MAX_SECTION_CONTENT) {
    return json({ error: `画像内容不能超过 ${MAX_SECTION_CONTENT} 个字。` }, 400);
  }

  const current = await env.DB.prepare(`
    SELECT section_key, content, source_document_id, updated_at
    FROM profile_sections
    WHERE section_key = ?1
  `).bind(params.id).first();
  if (!current) return json({ error: '画像卡片不存在。' }, 404);

  const updatedAt = new Date().toISOString();
  const statements = [];
  if (current.content) {
    statements.push(env.DB.prepare(`
      INSERT INTO profile_history (
        id, section_key, content, source_document_id, changed_at, changed_by
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'manual')
    `).bind(crypto.randomUUID(), params.id, current.content, current.source_document_id, updatedAt));
  }
  statements.push(env.DB.prepare(`
    UPDATE profile_sections
    SET content = ?1, updated_at = ?2, locked = 1
    WHERE section_key = ?3
  `).bind(content, updatedAt, params.id));
  await env.DB.batch(statements);

  return json({ section_key: params.id, content, updated_at: updatedAt, locked: true });
});

import { PROFILE_SECTIONS, isAdmin, json, withPublic } from '../../_shared.js';

export const onRequestGet = withPublic(async ({ request, env }) => {
  const [admin, { results }, { results: sourceRows }] = await Promise.all([
    isAdmin(request, env),
    env.DB.prepare(`
      SELECT section_key, content, updated_at
      FROM profile_sections
    `).all(),
    env.DB.prepare(`
      SELECT reference.section_key, document.id, document.original_name
      FROM (
        SELECT section_key, source_document_id AS document_id
        FROM profile_sections
        WHERE source_document_id IS NOT NULL
        UNION
        SELECT section_key, change_document_id AS document_id
        FROM profile_history
        WHERE change_document_id IS NOT NULL
      ) AS reference
      JOIN documents AS document ON document.id = reference.document_id
      WHERE document.deleted_at IS NULL AND document.undone_at IS NULL
      ORDER BY reference.section_key, document.uploaded_at, document.id
    `).all()
  ]);
  const byKey = new Map((results || []).map(section => [section.section_key, section]));
  const sourcesByKey = new Map();
  for (const source of sourceRows || []) {
    if (!sourcesByKey.has(source.section_key)) sourcesByKey.set(source.section_key, []);
    sourcesByKey.get(source.section_key).push({ id: source.id, original_name: source.original_name });
  }
  const sections = PROFILE_SECTIONS.map(definition => ({
    ...definition,
    content: byKey.get(definition.key)?.content || '',
    updated_at: byKey.get(definition.key)?.updated_at || null,
    sources: sourcesByKey.get(definition.key) || []
  }));
  const filled = sections.filter(section => section.content).length;
  const undo = admin ? await env.DB.prepare(`
    SELECT document.id
    FROM documents AS document
    JOIN profile_history AS history ON history.change_document_id = document.id
    WHERE document.deleted_at IS NULL AND document.undone_at IS NULL
    GROUP BY document.id
    ORDER BY MAX(history.changed_at) DESC, document.uploaded_at DESC, document.id DESC
    LIMIT 1
  `).first() : null;

  return json({
    profile: {
      filled,
      total: sections.length,
      percentage: Math.round(filled / sections.length * 100),
      sections
    },
    is_admin: admin,
    can_undo: Boolean(undo),
    turnstile_site_key: typeof env.TURNSTILE_SITE_KEY === 'string' ? env.TURNSTILE_SITE_KEY : ''
  });
});

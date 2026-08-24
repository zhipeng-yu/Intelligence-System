import { PROFILE_SECTIONS, isAdmin, json, withPublic } from '../../_shared.js';

export const onRequestGet = withPublic(async ({ request, env }) => {
  const { results } = await env.DB.prepare(`
    SELECT
      section.section_key, section.content, section.updated_at, section.locked,
      document.id AS source_document_id,
      document.original_name AS source_original_name
    FROM profile_sections AS section
    LEFT JOIN documents AS document ON document.id = section.source_document_id
  `).all();
  const byKey = new Map((results || []).map(section => [section.section_key, section]));
  const sections = PROFILE_SECTIONS.map(definition => ({
    ...definition,
    content: byKey.get(definition.key)?.content || '',
    updated_at: byKey.get(definition.key)?.updated_at || null,
    locked: Boolean(byKey.get(definition.key)?.locked),
    source_document_id: byKey.get(definition.key)?.source_document_id || null,
    source_original_name: byKey.get(definition.key)?.source_original_name || null
  }));
  const filled = sections.filter(section => section.content).length;

  return json({
    profile: {
      filled,
      total: sections.length,
      percentage: Math.round(filled / sections.length * 100),
      sections
    },
    is_admin: await isAdmin(request, env),
    turnstile_site_key: typeof env.TURNSTILE_SITE_KEY === 'string' ? env.TURNSTILE_SITE_KEY : ''
  });
});

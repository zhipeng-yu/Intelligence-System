import { attachmentDisposition, json, withAuth } from '../../../_shared.js';

export const onRequestGet = withAuth(async ({ env, params }) => {
  const document = await env.DB.prepare(`
    SELECT original_name, object_key, mime_type, size_bytes
    FROM documents
    WHERE id = ?1 AND deleted_at IS NULL
  `).bind(params.id).first();

  if (!document) return json({ error: '资料不存在。' }, 404);

  const object = await env.BUCKET.get(document.object_key);
  if (!object) return json({ error: '资料文件不存在，请联系维护人员。' }, 404);

  return new Response(object.body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': attachmentDisposition(document.original_name),
      'Content-Length': String(document.size_bytes),
      'Content-Type': document.mime_type,
      'X-Content-Type-Options': 'nosniff'
    }
  });
});

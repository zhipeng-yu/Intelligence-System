import { CATEGORIES, json, readUpload, withAuth } from '../../_shared.js';

const columns = `
  id, title, category, scope, status, uploaded_by, uploaded_at,
  original_name, mime_type, size_bytes
`;

export const onRequestGet = withAuth(async ({ env }) => {
  const { results } = await env.DB.prepare(`
    SELECT ${columns}
    FROM documents
    WHERE deleted_at IS NULL
    ORDER BY uploaded_at DESC
  `).all();
  return json({ documents: results || [], categories: CATEGORIES });
});

export const onRequestPost = withAuth(async ({ request, env }) => {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '上传请求格式无效。' }, 400);
  }

  const upload = await readUpload(form);
  if (upload.error) return json({ error: upload.error }, upload.status);

  const { title, category, scope, uploadedBy, file, originalName, mimeType } = upload.value;
  const id = crypto.randomUUID();
  const objectKey = `documents/${crypto.randomUUID()}`;
  const uploadedAt = new Date().toISOString();

  await env.BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: mimeType }
  });

  try {
    await env.DB.prepare(`
      INSERT INTO documents (
        id, title, category, scope, status, uploaded_by, uploaded_at,
        original_name, object_key, mime_type, size_bytes, deleted_at
      ) VALUES (?1, ?2, ?3, ?4, '待确认', ?5, ?6, ?7, ?8, ?9, ?10, NULL)
    `).bind(
      id, title, category, scope, uploadedBy, uploadedAt,
      originalName, objectKey, mimeType, file.size
    ).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }

  return json({ document: {
    id,
    title,
    category,
    scope,
    status: '待确认',
    uploaded_by: uploadedBy,
    uploaded_at: uploadedAt,
    original_name: originalName,
    mime_type: mimeType,
    size_bytes: file.size
  } }, 201);
});

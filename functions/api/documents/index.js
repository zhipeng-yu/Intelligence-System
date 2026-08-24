import {
  isAdmin,
  json,
  networkHash,
  readUpload,
  validateTurnstile,
  withPublic
} from '../../_shared.js';

const columns = `
  id, title, note, category, scope, ai_status, ai_error, analyzed_at,
  uploaded_at, original_name, mime_type, size_bytes
`;

export const onRequestGet = withPublic(async ({ request, env }) => {
  const { results } = await env.DB.prepare(`
    SELECT ${columns}
    FROM documents
    WHERE deleted_at IS NULL
    ORDER BY uploaded_at DESC
  `).all();
  return json({ documents: results || [], is_admin: await isAdmin(request, env) });
});

export const onRequestPost = withPublic(async ({ request, env }) => {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '上传请求格式无效。' }, 400);
  }

  const admin = await isAdmin(request, env);
  let addressHash = null;
  if (!admin) {
    const address = request.headers.get('CF-Connecting-IP') || '';
    if (!address) return json({ error: '无法验证上传来源，请稍后重试。' }, 400);
    if (typeof env.TURNSTILE_SECRET !== 'string' || !env.TURNSTILE_SECRET) {
      return json({ error: '上传验证尚未配置完成。' }, 503);
    }
    const token = form.get('cf-turnstile-response');
    const fetcher = typeof env.TURNSTILE_FETCH === 'function' ? env.TURNSTILE_FETCH : fetch;
    if (typeof token !== 'string' || !await validateTurnstile(token, address, env.TURNSTILE_SECRET, fetcher)) {
      return json({ error: '人机验证失败或已过期，请重试。' }, 400);
    }
    addressHash = await networkHash(address, env.ADMIN_KEY);
    if (!addressHash) return json({ error: '上传限流尚未配置完成。' }, 503);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rate = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents
      WHERE network_hash = ?1 AND uploaded_at >= ?2
    `).bind(addressHash, since).first();
    if (Number(rate?.count || 0) >= 5) {
      return json({ error: '同一网络每小时最多上传 5 份资料，请稍后再试。' }, 429);
    }
  }

  const upload = await readUpload(form);
  if (upload.error) return json({ error: upload.error }, upload.status);

  const { title, note, file, originalName, mimeType } = upload.value;
  const id = crypto.randomUUID();
  const objectKey = `documents/${crypto.randomUUID()}`;
  const uploadedAt = new Date().toISOString();

  await env.BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: mimeType }
  });

  try {
    await env.DB.prepare(`
      INSERT INTO documents (
        id, title, note, category, scope, ai_status, ai_error, analyzed_at,
        auto_analyzed, network_hash, uploaded_at, original_name, object_key,
        mime_type, size_bytes, deleted_at
      ) VALUES (?1, ?2, ?3, NULL, NULL, 'not_started', NULL, NULL, 0, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
    `).bind(
      id, title, note, addressHash, uploadedAt, originalName, objectKey, mimeType, file.size
    ).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }

  return json({ document: {
    id,
    title,
    note,
    category: null,
    scope: null,
    ai_status: 'not_started',
    ai_error: null,
    analyzed_at: null,
    uploaded_at: uploadedAt,
    original_name: originalName,
    mime_type: mimeType,
    size_bytes: file.size
  } }, 201);
});

import {
  PROFILE_FIELD_BY_KEY,
  calculateProfile,
  json,
  profileExpiresOn,
  validDate,
  withAuth
} from '../../_shared.js';

const profileQuery = `
  SELECT
    value.id, value.field_key, value.value, value.status, value.document_id,
    value.source_locator, value.observed_on, value.expires_on,
    value.created_at, value.updated_at,
    document.title AS document_title,
    document.original_name AS document_original_name,
    document.status AS document_status
  FROM profile_values AS value
  JOIN documents AS document
    ON document.id = value.document_id AND document.deleted_at IS NULL
  WHERE value.deleted_at IS NULL
  ORDER BY value.updated_at DESC
`;

function bodyText(body, name, maxLength) {
  const value = body?.[name];
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : '';
}

export const onRequestGet = withAuth(async ({ env }) => {
  const { results } = await env.DB.prepare(profileQuery).all();
  return json({ profile: calculateProfile(results || []) });
});

export const onRequestPost = withAuth(async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '候选信息请求格式无效。' }, 400);
  }

  const fieldKey = bodyText(body, 'field_key', 100);
  const value = bodyText(body, 'value', 2000);
  const documentId = bodyText(body, 'document_id', 100);
  const sourceLocator = bodyText(body, 'source_locator', 200);
  const observedOn = bodyText(body, 'observed_on', 10);
  if (!PROFILE_FIELD_BY_KEY.has(fieldKey)) return json({ error: '画像字段无效。' }, 400);
  if (!value) return json({ error: '请填写候选结论。' }, 400);
  if (!documentId || !sourceLocator) return json({ error: '请选择来源资料并填写来源定位。' }, 400);
  if (!validDate(observedOn)) return json({ error: '信息日期无效。' }, 400);

  const document = await env.DB.prepare(`
    SELECT id, title, original_name, status
    FROM documents
    WHERE id = ?1 AND deleted_at IS NULL
  `).bind(documentId).first();
  if (!document) return json({ error: '来源资料不存在。' }, 404);

  const duplicate = await env.DB.prepare(`
    SELECT id
    FROM profile_values
    WHERE field_key = ?1 AND value = ?2 AND document_id = ?3
      AND source_locator = ?4 AND observed_on = ?5 AND deleted_at IS NULL
  `).bind(fieldKey, value, documentId, sourceLocator, observedOn).first();
  if (duplicate) return json({ error: '相同候选信息已经存在。' }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresOn = profileExpiresOn(fieldKey, observedOn);
  if (!expiresOn) return json({ error: '无法计算字段有效期。' }, 400);
  await env.DB.prepare(`
    INSERT INTO profile_values (
      id, field_key, value, status, document_id, source_locator,
      observed_on, expires_on, created_at, updated_at, deleted_at
    ) VALUES (?1, ?2, ?3, '待确认', ?4, ?5, ?6, ?7, ?8, ?8, NULL)
  `).bind(id, fieldKey, value, documentId, sourceLocator, observedOn, expiresOn, now).run();

  return json({ candidate: {
    id,
    field_key: fieldKey,
    value,
    status: '待确认',
    document_id: documentId,
    document_title: document.title,
    document_original_name: document.original_name,
    document_status: document.status,
    source_locator: sourceLocator,
    observed_on: observedOn,
    expires_on: expiresOn,
    created_at: now,
    updated_at: now
  } }, 201);
});

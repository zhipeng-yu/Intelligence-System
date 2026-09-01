import { json, normalizePhone, phoneHmac, withAdminUser } from '../../../_shared.js';

function noteValue(value) {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  return note.length <= 100 ? note : null;
}

export const onRequestGet = withAdminUser(async ({ env }) => {
  const { results } = await env.DB.prepare(`
    SELECT id, phone_last4, note, enabled, created_at, updated_at
    FROM users
    ORDER BY created_at, id
  `).all();
  return json({ users: results || [] });
});

export const onRequestPost = withAdminUser(async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const phone = normalizePhone(body?.phone);
  const note = noteValue(body?.note ?? '');
  if (!phone || note === null) return json({ error: '手机号或备注格式无效。' }, 400);
  const digest = await phoneHmac(phone, env.PHONE_PEPPER);
  if (!digest) return json({ error: '登录服务尚未配置完成。' }, 503);
  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`
      INSERT INTO users (id, phone_hmac, phone_last4, note, enabled, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
    `).bind(id, digest, phone.slice(-4), note, timestamp).run();
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error))) return json({ error: '该手机号已在白名单中。' }, 409);
    throw error;
  }
  return json({ user: { id, phone_last4: phone.slice(-4), note, enabled: 1, created_at: timestamp, updated_at: timestamp } }, 201);
});

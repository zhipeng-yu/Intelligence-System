import { json, withAdminUser } from '../../../_shared.js';

export const onRequestPatch = withAdminUser(async ({ request, env, params }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const hasNote = Object.hasOwn(body || {}, 'note');
  const hasEnabled = Object.hasOwn(body || {}, 'enabled');
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if ((!hasNote && !hasEnabled) || (hasNote && note.length > 100)
      || (hasEnabled && typeof body.enabled !== 'boolean')) {
    return json({ error: '用户更新内容无效。' }, 400);
  }
  const current = await env.DB.prepare(`
    SELECT id, phone_last4, note, enabled, created_at
    FROM users WHERE id = ?1
  `).bind(params.id).first();
  if (!current) return json({ error: '用户不存在。' }, 404);
  const enabled = hasEnabled ? Number(body.enabled) : current.enabled;
  const updatedAt = new Date().toISOString();
  const statements = [env.DB.prepare(`
    UPDATE users SET note = ?1, enabled = ?2, updated_at = ?3 WHERE id = ?4
  `).bind(hasNote ? note : current.note, enabled, updatedAt, params.id)];
  if (!enabled) statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(params.id));
  await env.DB.batch(statements);
  return json({ user: {
    id: current.id,
    phone_last4: current.phone_last4,
    note: hasNote ? note : current.note,
    enabled,
    created_at: current.created_at,
    updated_at: updatedAt
  } });
});

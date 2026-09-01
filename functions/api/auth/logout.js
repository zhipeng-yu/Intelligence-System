import { clearSessionCookie, json, sessionToken, sha256Hex, withDatabase } from '../../_shared.js';

export const onRequestPost = withDatabase(async ({ request, env }) => {
  const token = sessionToken(request);
  if (token && token.length <= 100) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run();
  }
  return json({ logged_out: true }, 200, { 'Set-Cookie': clearSessionCookie() });
});

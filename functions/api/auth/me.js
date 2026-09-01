import { getUserSession, json, withDatabase } from '../../_shared.js';

export const onRequestGet = withDatabase(async ({ request, env }) => {
  const user = await getUserSession(request, env);
  return json({
    authenticated: Boolean(user),
    user: user ? { id: user.id, phone_last4: user.phone_last4, note: user.note } : null,
    turnstile_site_key: typeof env.TURNSTILE_SITE_KEY === 'string' ? env.TURNSTILE_SITE_KEY : ''
  });
});

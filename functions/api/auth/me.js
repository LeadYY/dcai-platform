import { getSessionUser, publicUser, json } from '../../lib/auth.js';

export async function onRequest(context) {
  try {
    const u = await getSessionUser(context.request, context.env);
    if (!u) return json({ user: null }, 401);
    return json({ user: { email: u.email, ...publicUser(u) } });
  } catch (e) {
    return json({ user: null }, 401);
  }
}

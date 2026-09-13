import { getSessionUser, publicUser, json } from '../lib/auth.js';

export async function onRequest(context) {
  try {
    const u = await getSessionUser(context.request, context.env);
    if (!u) return json({ ok: false, user: null }, 401);
    return json({ ok: true, user: publicUser(u) });
  } catch (e) {
    return json({ ok: false, user: null }, 401);
  }
}

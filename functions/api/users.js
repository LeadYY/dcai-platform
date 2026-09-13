import { getSessionUser, ensureSchema, json } from '../lib/auth.js';

export async function onRequest(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json([], 401);
    if (me.role !== 'admin') return json([], 403);
    const rows = await context.env.DB.prepare(
      `SELECT id, username, nick, phone, role, status, referrer, created_at AS createdAt
       FROM users ORDER BY id DESC`
    ).all();
    return json(rows.results || []);
  } catch (e) {
    return json([], 500);
  }
}

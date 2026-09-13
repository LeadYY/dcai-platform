import { getSessionUser, ensureSchema, json } from '../lib/auth.js';

export async function onRequest(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ ok: false, error: '请先登录' }, 401);
    const rows = await context.env.DB.prepare(
      'SELECT username, nick, created_at AS createdAt FROM users WHERE referrer = ? ORDER BY id DESC'
    ).bind(me.username).all();
    return json({ ok: true, total: (rows.results || []).length, list: rows.results || [] });
  } catch (e) {
    return json({ ok: false, error: '读取失败' }, 500);
  }
}

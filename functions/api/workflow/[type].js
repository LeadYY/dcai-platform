import { getSessionUser, ensureSchema, json } from '../../lib/auth.js';

export async function onRequest(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ ok: false, error: '请先登录' }, 401);

    const type = context.params.type;
    let total = 0, review = 0, done = 0;
    if (type === 'product') {
      const all = await context.env.DB.prepare('SELECT status FROM products').all();
      total = (all.results || []).length;
      review = (all.results || []).filter(r => /审|待|待审/.test(r.status || '')).length;
      done = (all.results || []).filter(r => /在售|上架|完成/.test(r.status || '')).length;
    } else if (type === 'content' || type === 'lead') {
      const all = await context.env.DB.prepare('SELECT status FROM enrollments').all();
      total = (all.results || []).length;
      done = (all.results || []).filter(r => /已缴费|已完成|完成/.test(r.status || '')).length;
      review = total - done;
    } else {
      const all = await context.env.DB.prepare('SELECT status FROM orders').all();
      total = (all.results || []).length;
      review = (all.results || []).filter(r => /待/.test(r.status || '')).length;
      done = (all.results || []).filter(r => /完成/.test(r.status || '')).length;
    }
    return json({ ok: true, stats: { total, review, done, inProgress: review } });
  } catch (e) {
    return json({ ok: false, error: '读取失败' }, 500);
  }
}

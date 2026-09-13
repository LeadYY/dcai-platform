import { getSessionUser, ensureSchema, json } from '../../lib/auth.js';

export async function onRequest(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ error: '请先登录' }, 401);

    const orders = (await context.env.DB.prepare('SELECT amount FROM orders').all()).results || [];
    const products = (await context.env.DB.prepare("SELECT status FROM products WHERE status = '在售'").all()).results || [];
    const students = (await context.env.DB.prepare('SELECT COUNT(*) AS n FROM enrollments').first());
    const users = (await context.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first());
    const gmv = orders.reduce((s, o) => s + Number(o.amount || 0), 0);

    return json({
      ok: true,
      kpi: {
        orders: orders.length,
        gmv: Math.round(gmv),
        products: products.length,
        students: students.n,
        users: users.n,
      },
    });
  } catch (e) {
    return json({ error: '读取失败' }, 500);
  }
}

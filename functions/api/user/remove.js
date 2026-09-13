import { getSessionUser, ensureSchema, json } from '../../lib/auth.js';

export async function onRequestPost(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ ok: false, error: '请先登录' }, 401);
    if (me.role !== 'admin') return json({ ok: false, error: '无权限' }, 403);

    const { username } = await context.request.json();
    if (!username) return json({ ok: false, error: '缺少用户名' }, 400);
    if (username === 'H' || username === me.username) {
      return json({ ok: false, error: '不能删除超级管理员或当前账号' }, 403);
    }
    await context.env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: '删除失败' }, 500);
  }
}

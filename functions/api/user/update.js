import { getSessionUser, ensureSchema, json } from '../../lib/auth.js';

export async function onRequestPost(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ ok: false, error: '请先登录' }, 401);
    if (me.role !== 'admin') return json({ ok: false, error: '无权限' }, 403);

    const { username, role, status } = await context.request.json();
    if (!username) return json({ ok: false, error: '缺少用户名' }, 400);
    if (username === 'H' && (role === 'user' || status === 'disabled')) {
      return json({ ok: false, error: '不能变更超级管理员 H 的角色/状态' }, 403);
    }
    if (role && !['user', 'merchant', 'admin'].includes(role)) {
      return json({ ok: false, error: '角色不合法' }, 400);
    }
    if (status && !['active', 'disabled'].includes(status)) {
      return json({ ok: false, error: '状态不合法' }, 400);
    }
    if (role) await context.env.DB.prepare('UPDATE users SET role = ? WHERE username = ?').bind(role, username).run();
    if (status) await context.env.DB.prepare('UPDATE users SET status = ? WHERE username = ?').bind(status, username).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: '更新失败' }, 500);
  }
}

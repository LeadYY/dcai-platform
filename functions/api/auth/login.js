import {
  ensureSchema, verifyPassword, createSession, publicUser,
  json, sessionCookie, rateLimit, clientIp,
} from '../../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);
    const { email, password } = await request.json();
    if (!email || !password) return json({ error: '邮箱和密码不能为空' }, 400);

    if (!rateLimit('alogin:' + clientIp(request), 8, 60000)) {
      return json({ error: '尝试过于频繁，请稍后再试' }, 429);
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user) return json({ error: '邮箱未注册' }, 401);
    if (user.status === 'disabled') return json({ error: '账号已被禁用' }, 403);

    const ok = await verifyPassword(user, String(password));
    if (!ok) return json({ error: '密码错误' }, 401);

    const token = await createSession(env, user.id);
    return json({ ok: true, email: user.email, user: publicUser(user) }, 200, {
      'Set-Cookie': sessionCookie(token),
    });
  } catch (e) {
    return json({ error: '登录失败，请稍后重试' }, 500);
  }
}

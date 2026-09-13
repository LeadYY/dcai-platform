import {
  ensureSchema, verifyPassword, createSession, publicUser,
  json, sessionCookie, rateLimit, clientIp,
} from '../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);
    const { account, password } = await request.json();
    if (!account || !password) return json({ ok: false, error: '账号和密码不能为空' }, 400);

    const rlKey = 'login:' + clientIp(request);
    if (!rateLimit(rlKey, 8, 60000)) {
      return json({ ok: false, error: '尝试过于频繁，请稍后再试' }, 429);
    }

    const acc = String(account).trim();
    const user = await env.DB.prepare(
      `SELECT * FROM users WHERE username = ? OR phone = ? OR email = ? LIMIT 1`
    ).bind(acc, acc, acc).first();

    if (!user) return json({ ok: false, error: '账号不存在或密码错误' }, 401);
    if (user.status === 'disabled') return json({ ok: false, error: '账号已被禁用，请联系管理员' }, 403);

    const ok = await verifyPassword(user, String(password));
    if (!ok) return json({ ok: false, error: '账号不存在或密码错误' }, 401);

    const token = await createSession(env, user.id);
    return json({ ok: true, token, user: publicUser(user) }, 200, {
      'Set-Cookie': sessionCookie(token),
    });
  } catch (e) {
    return json({ ok: false, error: '登录失败，请稍后重试' }, 500);
  }
}

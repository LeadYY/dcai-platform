import {
  ensureSchema, hashPassword, newSalt, createSession, publicUser,
  json, sessionCookie, rateLimit, clientIp,
} from '../../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);
    const { email, password } = await request.json();
    if (!email || !password) return json({ error: '邮箱和密码不能为空' }, 400);

    if (!rateLimit('areg:' + clientIp(request), 5, 3600000)) {
      return json({ error: '注册过于频繁，请稍后再试' }, 429);
    }

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) return json({ error: '该邮箱已注册' }, 409);

    const username = String(email).split('@')[0].slice(0, 20);
    let uniq = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    let uname = username, n = 1;
    while (uniq) { uname = username + (++n); uniq = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(uname).first(); }

    const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    const salt = newSalt();
    const pwHash = await hashPassword(String(password), salt);
    await env.DB.prepare(
      `INSERT INTO users (username, email, nick, password_hash, salt, role, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    ).bind(uname, email, uname, pwHash, salt, countRow.n === 0 ? 'admin' : 'user').run();

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const token = await createSession(env, user.id);
    return json({ ok: true, email: user.email, user: publicUser(user) }, 200, {
      'Set-Cookie': sessionCookie(token),
    });
  } catch (e) {
    return json({ error: '注册失败，请稍后重试' }, 500);
  }
}

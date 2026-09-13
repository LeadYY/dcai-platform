import {
  ensureSchema, hashPassword, newSalt, createSession, publicUser,
  json, sessionCookie, rateLimit, clientIp,
} from '../lib/auth.js';

const PHONE_RE = /^1\d{10}$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);
    const { nick, password, phone, code, referrer, role } = await request.json();

    if (!nick || !password || !phone) return json({ ok: false, error: '昵称、密码、手机号均为必填' }, 400);
    if (String(nick).length < 2 || String(nick).length > 20) return json({ ok: false, error: '昵称长度需为 2-20 个字符' }, 400);
    if (String(password).length < 6) return json({ ok: false, error: '密码至少 6 位' }, 400);
    if (!PHONE_RE.test(String(phone))) return json({ ok: false, error: '手机号格式不正确' }, 400);

    // 注册时自选角色白名单；任何人不能通过注册直接成为 admin（admin 由首个账号自动获得，或由现有 admin 后台提升）
    const allowedSelfRoles = ['user', 'merchant', 'partner'];
    const chosenRole = allowedSelfRoles.includes(role) ? role : 'user';

    const rlKey = 'reg:' + clientIp(request);
    if (!rateLimit(rlKey, 5, 3600000)) {
      return json({ ok: false, error: '注册过于频繁，请稍后再试' }, 429);
    }

    // 校验短信验证码（演示模式：服务端签发，5 分钟有效）
    const now = Math.floor(Date.now() / 1000);
    const sc = await env.DB.prepare('SELECT * FROM sms_codes WHERE phone = ?').bind(phone).first();
    if (!sc || sc.expires_at < now) return json({ ok: false, error: '验证码已失效，请重新获取' }, 400);
    if (sc.attempts >= 5) return json({ ok: false, error: '验证码错误次数过多，请重新获取' }, 400);
    if (sc.code !== String(code)) {
      await env.DB.prepare('UPDATE sms_codes SET attempts = attempts + 1 WHERE phone = ?').bind(phone).run();
      return json({ ok: false, error: '验证码错误' }, 400);
    }

    const phoneTaken = await env.DB.prepare('SELECT id FROM users WHERE phone = ?').bind(phone).first();
    if (phoneTaken) return json({ ok: false, error: '该手机号已注册' }, 409);

    // 用户名 = 昵称，查重
    let username = String(nick).trim();
    let userRow = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    let suffix = 1;
    while (userRow) {
      username = String(nick).trim() + (++suffix);
      if (username.length > 20) username = String(nick).trim().slice(0, 16) + '_' + suffix;
      userRow = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    }

    const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    const isFirst = countRow.n === 0;

    const salt = newSalt();
    const pwHash = await hashPassword(String(password), salt);
    await env.DB.prepare(
      `INSERT INTO users (username, nick, phone, password_hash, salt, role, status, referrer)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
    ).bind(username, String(nick).trim(), phone, pwHash, salt, isFirst ? 'admin' : chosenRole, referrer || null).run();

    const newUser = await env.DB.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).bind(username).first();

    const token = await createSession(env, newUser.id);
    await env.DB.prepare('DELETE FROM sms_codes WHERE phone = ?').bind(phone).run();

    return json({ ok: true, token, user: publicUser(newUser) }, 200, {
      'Set-Cookie': sessionCookie(token),
    });
  } catch (e) {
    return json({ ok: false, error: '注册失败，请稍后重试' }, 500);
  }
}

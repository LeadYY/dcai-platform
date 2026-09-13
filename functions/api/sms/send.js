import { ensureSchema, json, rateLimit, clientIp } from '../../lib/auth.js';

const PHONE_RE = /^1\d{10}$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);
    const { phone } = await request.json();
    if (!PHONE_RE.test(String(phone || ''))) return json({ ok: false, error: '手机号格式不正确' }, 400);

    const rlKey = 'sms:' + clientIp(request);
    if (!rateLimit(rlKey, 5, 3600000)) {
      return json({ ok: false, error: '发送过于频繁，请稍后再试' }, 429);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Math.floor(Date.now() / 1000) + 300; // 5 分钟
    await env.DB.prepare(
      'INSERT OR REPLACE INTO sms_codes (phone, code, expires_at, attempts) VALUES (?, ?, ?, 0)'
    ).bind(phone, code, expires).run();

    // 演示环境：直接返回验证码（前端会显示）；接真实短信服务时删除 code 字段即可
    return json({ ok: true, code, expiresIn: 300 });
  } catch (e) {
    return json({ ok: false, error: '验证码发送失败' }, 500);
  }
}

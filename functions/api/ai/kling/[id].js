import { getSessionUser, json, ensureSchema } from '../../../lib/auth.js';

// 可灵视频任务轮询：当前未接外部厂商密钥，统一返回预留状态
export async function onRequestGet(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ error: '请先登录' }, 401);
    return json({ ok: false, status: 'unconfigured', error: '视频生成服务待接入外部密钥' }, 200);
  } catch (e) {
    return json({ error: '读取失败' }, 500);
  }
}

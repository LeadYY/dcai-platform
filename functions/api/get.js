import { json, getSessionUser } from '../lib/auth.js';
import { readAllStore } from '../lib/store.js';

export async function onRequest(context) {
  try {
    const res = await readAllStore(context.request, context.env);
    if (!res) return json({ error: '请先登录' }, 401);
    return json(res.out);
  } catch (e) {
    return json({ error: '读取数据失败' }, 500);
  }
}

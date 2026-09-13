import { json } from '../../lib/auth.js';
import { readKey } from '../../lib/store.js';

export async function onRequest(context) {
  try {
    const r = await readKey(context.request, context.env, context.params.key);
    return json(r.body, r.status);
  } catch (e) {
    return json({ error: '读取失败' }, 500);
  }
}

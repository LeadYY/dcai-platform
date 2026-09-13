import { json } from '../../lib/auth.js';
import { writeKey } from '../../lib/store.js';

export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const r = await writeKey(context.request, context.env, context.params.key, data);
    return json(r.body, r.status);
  } catch (e) {
    return json({ error: '保存失败' }, 500);
  }
}

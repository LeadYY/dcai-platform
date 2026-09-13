import { json } from '../lib/auth.js';

export async function onRequest(context) {
  try {
    return json({ ok: true, service: 'dcai-platform', time: new Date().toISOString() });
  } catch (e) {
    return json({ ok: false, error: 'internal' }, 500);
  }
}

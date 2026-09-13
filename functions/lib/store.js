// ============================================================
// 业务数据读写与权限规则（P2）
// 前端沿用 dcShared 协议：按键存 JSON；服务端负责合并、鉴权、归属。
// ============================================================
import { getSessionUser, json, ensureSchema } from './auth.js';

const ADMIN_ONLY_KEYS = new Set(['ports', 'portAuth', 'courses', 'payCourses', 'pendingProducts']);
const ANY_AUTH_KEYS = new Set(['coopPartners', 'coopResources', 'suppliers', 'partners', 'students']);

function safeParse(t) { try { return JSON.parse(t); } catch (e) { return null; } }

/** 读取当前用户可见的全部共享数据（/api/get） */
export async function readAllStore(request, env) {
  await ensureSchema(env);
  const me = await getSessionUser(request, env);
  if (!me) return null;
  const out = {};

  // 通用 kv
  const kvRows = await env.DB.prepare('SELECT key, value FROM kv').all();
  for (const r of kvRows.results || []) {
    if (ADMIN_ONLY_KEYS.has(r.key) && me.role !== 'admin') continue;
    out[r.key] = safeParse(r.value);
  }

  // orders：按身份过滤
  out.orders = await readOrders(env, me);
  // products：所有人可读（仅在售由前端过滤）
  out.products = (await env.DB.prepare('SELECT id, supplier, status, payload FROM products').all()).results
    .map(r => ({ id: r.id, supplier: r.supplier, status: r.status, ...(safeParse(r.payload) || {}) }));
  // enrollments：管理员全部，其他人仅本人
  out.enrollments = await readEnrollments(env, me);

  return { me, out };
}

export async function readOrders(env, me) {
  let rows;
  if (me.role === 'admin') {
    rows = (await env.DB.prepare('SELECT id, buyer_id, supplier, amount, status, payload FROM orders').all()).results;
  } else if (me.role === 'merchant') {
    rows = (await env.DB.prepare(
      `SELECT id, buyer_id, supplier, amount, status, payload FROM orders
       WHERE supplier IS NULL OR supplier = '' OR supplier = ? OR supplier = ?`
    ).bind(me.username, me.nick || '').all()).results;
  } else {
    rows = (await env.DB.prepare(
      'SELECT id, buyer_id, supplier, amount, status, payload FROM orders WHERE buyer_id = ?'
    ).bind(me.id).all()).results;
  }
  return rows.map(r => ({ id: r.id, supplier: r.supplier, amount: r.amount, status: r.status, ...(safeParse(r.payload) || {}) }));
}

export async function readEnrollments(env, me) {
  let rows;
  if (me.role === 'admin') {
    rows = (await env.DB.prepare('SELECT id, user_id, payload FROM enrollments').all()).results;
  } else {
    rows = (await env.DB.prepare('SELECT id, user_id, payload FROM enrollments WHERE user_id = ?').bind(me.id).all()).results;
  }
  return rows.map(r => ({ id: r.id, ...(safeParse(r.payload) || {}) }));
}

/** 读取单个键 */
export async function readKey(request, env, key) {
  await ensureSchema(env);
  const me = await getSessionUser(request, env);
  if (!me) return { status: 401, body: { error: '请先登录' } };

  if (key === 'orders') return { status: 200, body: { data: await readOrders(env, me) } };
  if (key === 'products') {
    const rows = (await env.DB.prepare('SELECT id, supplier, status, payload FROM products').all()).results;
    return { status: 200, body: { data: rows.map(r => ({ id: r.id, supplier: r.supplier, status: r.status, ...(safeParse(r.payload) || {}) })) } };
  }
  if (key === 'enrollments') return { status: 200, body: { data: await readEnrollments(env, me) } };

  if (ADMIN_ONLY_KEYS.has(key) && me.role !== 'admin') return { status: 403, body: { error: '无权限' } };
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  return { status: 200, body: { data: row ? safeParse(row.value) : null } };
}

/** 写入某个键（合并/upsert，而非整包覆盖） */
export async function writeKey(request, env, key, data) {
  await ensureSchema(env);
  const me = await getSessionUser(request, env);
  if (!me) return { status: 401, body: { error: '请先登录' } };

  // ---- 订单：按 id 合并，记录买家归属 ----
  if (key === 'orders') {
    if (!Array.isArray(data)) return { status: 400, body: { error: 'orders 需为数组' } };
    for (const o of data) {
      if (!o || !o.id) continue;
      const supplier = o.supplier || o.shop || null;
      const amount = Number(o.amount || 0);
      const status = o.status || '';
      let buyerId = o.buyer_id || null;
      // 普通用户（买家）写入的订单归属本人；商家/管理员写入的不改写归属
      if (!buyerId && me.role === 'user') buyerId = me.id;
      await env.DB.prepare(
        `INSERT INTO orders (id, buyer_id, buyer_name, supplier, amount, status, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           buyer_id = COALESCE(orders.buyer_id, excluded.buyer_id),
           buyer_name = COALESCE(excluded.buyer_name, orders.buyer_name),
           supplier = COALESCE(excluded.supplier, orders.supplier),
           amount = excluded.amount,
           status = excluded.status,
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      ).bind(String(o.id), buyerId, o.buyer || o.buyer_name || null, supplier, amount, status, JSON.stringify(o)).run();
    }
    return { status: 200, body: { ok: true, merged: data.length } };
  }

  // ---- 商品：管理员/商家可写，按 id 合并 ----
  if (key === 'products') {
    if (me.role === 'user') return { status: 403, body: { error: '仅管理员或商家可管理商品' } };
    if (!Array.isArray(data)) return { status: 400, body: { error: 'products 需为数组' } };
    for (const p of data) {
      if (!p || !p.id) continue;
      await env.DB.prepare(
        `INSERT INTO products (id, supplier, status, payload, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET supplier=excluded.supplier, status=excluded.status,
           payload=excluded.payload, updated_at=excluded.updated_at`
      ).bind(String(p.id), p.supplier || p.merchant || me.username, p.status || '', JSON.stringify(p)).run();
    }
    return { status: 200, body: { ok: true, merged: data.length } };
  }

  // ---- 报名：按 id 合并，归属本人 ----
  if (key === 'enrollments') {
    if (!Array.isArray(data)) return { status: 400, body: { error: 'enrollments 需为数组' } };
    for (const e of data) {
      if (!e || !e.id) continue;
      let uid = e.user_id || null;
      if (!uid && me.role !== 'admin') uid = me.id;
      await env.DB.prepare(
        `INSERT INTO enrollments (id, user_id, payload, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, payload=excluded.payload, updated_at=excluded.updated_at`
      ).bind(String(e.id), uid, JSON.stringify(e)).run();
    }
    return { status: 200, body: { ok: true, merged: data.length } };
  }

  // ---- 其余键：按权限写入 kv 整值 ----
  if (ADMIN_ONLY_KEYS.has(key) && me.role !== 'admin') {
    // pendingProducts 允许商家提交
    if (!(key === 'pendingProducts' && me.role === 'merchant')) {
      return { status: 403, body: { error: '无权限' } };
    }
  }
  if (!ANY_AUTH_KEYS.has(key) && !ADMIN_ONLY_KEYS.has(key) && me.role === 'user') {
    // 普通用户允许写订单/商品(读)/报名/合作资源之外，其他键不开放
  }
  await env.DB.prepare(
    `INSERT INTO kv (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`
  ).bind(key, JSON.stringify(data), me.id).run();
  return { status: 200, body: { ok: true, key } };
}

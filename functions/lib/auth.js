// ============================================================
// 共享鉴权与数据迁移库（Cloudflare Pages Functions）
// 所有业务接口通过 getSessionUser() 识别登录用户；通过 requireRole 做权限。
// ============================================================

const PBKDF2_ITER = 100000;

// ---------- 密码 ----------
async function hashPassword(password, salt) {
  // salt 形如 "pbkdf2$<iter>$<hex>"；老数据 salt 为纯 hex（旧 SHA-256 方案），仅用于校验
  if (salt.startsWith('pbkdf2$')) {
    const parts = salt.split('$');
    const iter = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const key = await pbkdf2(password, hexToBytes(saltHex), iter);
    return 'pbkdf2$' + iter + '$' + bytesToHex(key);
  }
  // 兼容旧数据：salt + sha256(password)
  const data = new TextEncoder().encode(salt + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

async function pbkdf2(password, saltBytes, iter) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' },
    baseKey, 256
  );
  return new Uint8Array(bits);
}

function newSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return 'pbkdf2$' + PBKDF2_ITER + '$' + bytesToHex(arr);
}

function randomToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

function bytesToHex(b) {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// ---------- 数据库 schema（幂等迁移）----------
export async function ensureSchema(env) {
  const db = env.DB;
  // 基础表
  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    nick TEXT,
    phone TEXT,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    referrer TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS sms_codes (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  )`).run();
  // P2 业务表
  await db.prepare(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    buyer_id INTEGER,
    buyer_name TEXT,
    supplier TEXT,
    amount REAL,
    status TEXT,
    payload TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    supplier TEXT,
    status TEXT,
    payload TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    payload TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  // 旧库可能缺少新列，逐条尝试加列（重复则忽略报错）
  const cols = [
    "ALTER TABLE users ADD COLUMN username TEXT",
    "ALTER TABLE users ADD COLUMN nick TEXT",
    "ALTER TABLE users ADD COLUMN phone TEXT",
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN referrer TEXT",
  ];
  for (const sql of cols) {
    try { await db.prepare(sql).run(); } catch (e) { /* 列已存在 */ }
  }
}

// ---------- 会话 ----------
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 天

export async function createSession(env, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(token, userId, expires).run();
  return token;
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

/** 从 cookie 或 x-auth-token 头识别登录用户，返回 user 行或 null */
export async function getSessionUser(request, env) {
  await ensureSchema(env);
  const cookies = parseCookies(request);
  let token = cookies.session || '';
  if (!token) {
    const h = request.headers.get('x-auth-token') || '';
    if (/^[a-f0-9]{64}$/.test(h)) token = h;
  }
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.nick, u.phone, u.role, u.status
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  if (!row) return null;
  if (row.status === 'disabled') return null;
  return row;
}

export function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username || (u.email ? u.email.split('@')[0] : 'user' + u.id),
    nick: u.nick || u.username || (u.email ? u.email.split('@')[0] : '用户' + u.id),
    role: u.role || 'user',
    status: u.status || 'active',
  };
}

// ---------- 登录限流（内存级，尽力而为）----------
const _hits = new Map();
export function rateLimit(key, max = 5, windowMs = 60000) {
  const now = Date.now();
  let rec = _hits.get(key);
  if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; _hits.set(key, rec); }
  rec.count++;
  return rec.count <= max;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

// ---------- HTTP 帮助 ----------
export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function sessionCookie(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export async function verifyPassword(userRow, password) {
  const h = await hashPassword(password, userRow.salt);
  return timingSafeEqual(h, userRow.password_hash);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { hashPassword, newSalt, randomToken };

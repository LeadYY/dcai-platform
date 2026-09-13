async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { email, password } = await request.json();

  const db = env.DB;
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

  if (!user) {
    return Response.json({ error: "邮箱未注册" }, { status: 401 });
  }

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash) {
    return Response.json({ error: "密码错误" }, { status: 401 });
  }

  const token = randomToken();
  await db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").bind(token, user.id).run();

  return new Response(JSON.stringify({ email: user.email }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/session=([a-f0-9]+)/);
  if (match) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(match[1]).run();
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    }
  });
}

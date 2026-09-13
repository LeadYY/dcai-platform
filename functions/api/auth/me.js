export async function onRequestGet(context) {
  const { request, env } = context;
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/session=([a-f0-9]+)/);
  if (!match) {
    return Response.json({ user: null }, { status: 401 });
  }
  const row = await env.DB.prepare(
    "SELECT u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"
  ).bind(match[1]).first();
  if (!row) {
    return Response.json({ user: null }, { status: 401 });
  }
  return Response.json({ user: { email: row.email } });
}

async function getUser(request, env) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/session=([a-f0-9]+)/);
  if (!match) return null;
  return env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token = ?"
  ).bind(match[1]).first();
}

export async function onRequest(context) {
  const { request, env } = context;
  const session = await getUser(request, env);
  if (!session) {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user_id;

  // GET: 返回历史消息
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50"
    ).bind(userId).all();
    return Response.json({ messages: results.reverse() });
  }

  // POST: 发消息给 AI
  const { message } = await request.json();
  if (!message) {
    return Response.json({ error: "消息不能为空" }, { status: 400 });
  }

  await env.DB.prepare(
    "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)"
  ).bind(userId, message).run();

  const history = await env.DB.prepare(
    "SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 10"
  ).bind(userId).all();

  const messages = history.results.reverse().map(m => ({
    role: m.role, content: m.content
  }));

  const aiResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages });
  const reply = aiResp.response || "抱歉，我暂时无法回答。";

  await env.DB.prepare(
    "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'assistant', ?)"
  ).bind(userId, reply).run();

  return Response.json({ reply });
}

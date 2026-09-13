export async function onRequest(context) {
  return new Response(JSON.stringify({
    message: "你好，后端活了",
    time: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

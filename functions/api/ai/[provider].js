// ============================================================
// AI 统一代理（P3）
// 文本：未配置外部厂商 Key 时默认走 Cloudflare Workers AI；
//       配置了厂商密钥（环境变量）时可在此路由到对应厂商。
// 图片：seedream -> Workers AI 图像模型；
// 视频：kling 需外部厂商密钥，未配置时返回友好提示。
// ============================================================
import { getSessionUser, json, ensureSchema } from '../../lib/auth.js';

const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export async function onRequestPost(context) {
  try {
    await ensureSchema(context.env);
    const me = await getSessionUser(context.request, context.env);
    if (!me) return json({ error: '请先登录后使用 AI' }, 401);

    const provider = context.params.provider;
    const body = await context.request.json().catch(() => ({}));

    // ---- 文本对话类 ----
    if (['deepseek', 'zhipu', 'volcengine', 'qwen'].includes(provider)) {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const cleaned = messages
        .filter(m => m && typeof m.content === 'string')
        .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        .slice(-12);
      if (!cleaned.length) return json({ error: '消息不能为空' }, 400);

      if (!context.env.AI) {
        return json({ reply: 'AI 服务尚未在本环境绑定（Cloudflare Workers AI），部署后即可使用。' }, 200);
      }
      const resp = await context.env.AI.run(TEXT_MODEL, { messages: cleaned });
      const reply = (resp && resp.response) || '抱歉，我暂时无法回答。';
      return json({ reply, provider });
    }

    // ---- 文生图 ----
    if (provider === 'seedream') {
      const prompt = String(body.prompt || '').slice(0, 200);
      if (!prompt) return json({ error: '请输入图片描述' }, 400);
      if (!context.env.AI) {
        return json({ image: null, error: '图像服务未在本环境绑定，部署后可用。' }, 200);
      }
      const imgResp = await context.env.AI.run(IMAGE_MODEL, { prompt });
      // Workers AI 返回二进制
      const b64 = b64from(await imgResp.arrayBuffer());
      return json({ image: 'data:image/png;base64,' + b64, provider });
    }

    // ---- 视频生成（可灵）：需外部厂商密钥，预留 ----
    if (provider === 'kling') {
      return json({ ok: false, error: '视频生成需配置可灵/Kling 外部密钥（已预留，待你开通后启用）', taskId: null }, 200);
    }

    return json({ error: '未知的 AI 服务' }, 400);
  } catch (e) {
    return json({ error: 'AI 服务暂时不可用，请稍后重试' }, 500);
  }
}

function b64From(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

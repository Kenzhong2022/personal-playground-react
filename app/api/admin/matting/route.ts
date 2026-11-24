import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { callPython } from "@/lib/pythonApi";

/**
 * @description 在线抠图转发层：浏览器 → 本路由 → Workers AI 绑定
 *   （env.AI.run，bria/remove-background）。图片以 base64 data URI 放在 JSON
 *   里送来，模型推理由 Cloudflare 完成，返回的抠图结果是 Bria 托管的临时 URL
 *   （3 天过期），这里立刻取回 PNG 原样回传给浏览器，避免前端跨域下载与
 *   临时链接过期问题。绑定调用按 Workers AI Neurons 计费（每张约 1636，
 *   全账号共享每日 10000 免费 Neurons）；REST 统一端点对 bria 这类
 *   provider 模型走 AI Gateway 统一计费（需充值 credits），故必须用绑定。
 */

/** @description data URI 大小上限（base64 后超 16MB 直接拒绝，Bria 端也有同量级限制） */
const MAX_DATA_URI_LENGTH = 16 * 1024 * 1024;

/** @description Workers AI 绑定的最小类型声明（只用到 run） */
type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

/** @description Cookie 转发校验登录态 */
async function currentUser(request: Request) {
  const cookie = request.headers.get("cookie");
  const me = await callPython("/api/auth/me", {
    headers: cookie ? { cookie } : {},
  });
  return me.ok ? (me.body as { user?: { id?: string } }).user : undefined;
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  const user = await currentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: { image?: unknown };
  try {
    body = (await request.json()) as { image?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const image = body.image;
  if (
    typeof image !== "string" ||
    !image.startsWith("data:") ||
    image.length > MAX_DATA_URI_LENGTH
  ) {
    return NextResponse.json(
      { error: "缺少 image data URI 或体积超限（原图需压缩到 12MB 内）" },
      { status: 400 },
    );
  }

  // 本地 next dev 下绑定经 getPlatformProxy 异步初始化，必须用 async 形式获取；
  // Windows 下 workerd 可能崩溃导致本地代理起不来，这里捕获后降级为明确提示
  let ai: AiBinding | undefined;
  try {
    ai = (
      (await getCloudflareContext({ async: true })).env as {
        AI?: AiBinding;
      }
    ).AI;
  } catch (err) {
    console.error(
      "[matting] 获取 Cloudflare 绑定失败（本地多为 workerd 启动崩溃）:",
      err,
    );
    return NextResponse.json(
      { error: "本地运行时无法初始化 Cloudflare 绑定，请部署后在环境验证" },
      { status: 503 },
    );
  }
  if (!ai) {
    return NextResponse.json(
      { error: "服务端未配置 Workers AI 绑定（需部署后使用）" },
      { status: 503 },
    );
  }

  let cutoutUrl: string | undefined;
  try {
    const response = (await ai.run("bria/remove-background", { image })) as {
      state?: string;
      result?: { image?: string };
    };
    cutoutUrl = response.result?.image;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 额度耗尽：绑定 run 会抛含 429 / "Account limited" 的错误，次日 UTC 00:00 重置
    const quotaExceeded =
      message.includes("Account limited") || message.includes("429");
    console.error(
      `[matting] Workers AI 调用失败（${quotaExceeded ? "额度耗尽" : "未知错误"}）: ${message}`,
    );
    return NextResponse.json(
      {
        error: quotaExceeded
          ? "今日免费抠图额度已用完，次日 UTC 0 点重置后可继续使用"
          : "抠图服务调用失败，请稍后重试",
      },
      { status: quotaExceeded ? 429 : 502 },
    );
  }
  if (!cutoutUrl) {
    return NextResponse.json(
      { error: "模型未返回抠图结果" },
      { status: 502 },
    );
  }

  // 模型只给 3 天临时链接，这里立刻取回 PNG 并原样流式回传
  const cutout = await fetch(cutoutUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!cutout.ok || !cutout.body) {
    console.error(`[matting] 抠图结果下载失败: ${cutout.status}`);
    return NextResponse.json({ error: "抠图结果下载失败" }, { status: 502 });
  }
  return new Response(cutout.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}

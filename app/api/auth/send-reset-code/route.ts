import { NextResponse } from "next/server";
import { callPython, errorResponse } from "@/lib/pythonApi";
import { gateTurnstile } from "@/lib/turnstile";

/**
 * @description 发送重置密码验证码：先过 Turnstile 人机验证（action=send_reset_code，
 *   防邮件轰炸），再转发 Python 服务端；邮箱注册校验、60 秒冷却与 SMTP 发送均由
 *   Python 服务端实现，本路由仅做转发
 */
export async function POST(request: Request): Promise<NextResponse> {
  const text = await request.text();
  let payload: { turnstileToken?: unknown } = {};
  try {
    payload = JSON.parse(text || "{}");
  } catch {
    // 保持空 payload：token 校验会拒绝缺失
  }
  const gate = await gateTurnstile(
    payload.turnstileToken,
    request,
    "send_reset_code"
  );
  if (!gate.ok) return gate.response;

  const { ok, status, body } = await callPython("/api/auth/send-reset-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  return ok ? NextResponse.json(body) : errorResponse(status, body);
}

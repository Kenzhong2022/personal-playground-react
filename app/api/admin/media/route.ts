import { NextResponse } from "next/server";
import { callPython, errorResponse } from "@/lib/pythonApi";

/**
 * @description 后台媒体管理转发层：列表（GET）与重命名 / 删除（POST 按 action 分发）。
 *   登录门禁与 /api/realtime/presets 一致（/api/auth/me 校验，暂无角色字段）；
 *   Storage 操作（media 桶、service key）全部由 Python 服务端实现，本路由仅做转发
 */

/** @description Cookie 转发校验登录态 */
async function currentUser(request: Request) {
  const cookie = request.headers.get("cookie");
  const me = await callPython("/api/auth/me", {
    headers: cookie ? { cookie } : {},
  });
  return me.ok
    ? (me.body as { user?: { id?: string } }).user
    : undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await currentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
  const { ok, status, body } = await callPython(
    `/api/admin/media?prefix=${encodeURIComponent(prefix)}`,
  );
  return ok ? NextResponse.json(body) : errorResponse(status, body);
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await currentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const payload = (await request.json().catch(() => null)) as {
    action?: string;
    paths?: unknown;
    from?: unknown;
    to?: unknown;
  } | null;

  if (payload?.action === "delete") {
    if (
      !Array.isArray(payload.paths) ||
      payload.paths.length === 0 ||
      payload.paths.some((p) => typeof p !== "string")
    ) {
      return NextResponse.json({ error: "请提供要删除的路径" }, { status: 400 });
    }
    const { ok, status, body } = await callPython("/api/admin/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: payload.paths }),
    });
    return ok ? NextResponse.json(body) : errorResponse(status, body);
  }

  if (payload?.action === "rename") {
    if (typeof payload.from !== "string" || typeof payload.to !== "string") {
      return NextResponse.json(
        { error: "请提供原路径与新路径" },
        { status: 400 },
      );
    }
    const { ok, status, body } = await callPython("/api/admin/media/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: payload.from, to: payload.to }),
    });
    return ok ? NextResponse.json(body) : errorResponse(status, body);
  }

  return NextResponse.json({ error: "未知的操作类型" }, { status: 400 });
}

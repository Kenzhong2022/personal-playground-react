import { NextResponse } from "next/server";
import { callPython, errorResponse } from "@/lib/pythonApi";

/**
 * @description 后台媒体上传转发层：multipart 原样透传给 Python 服务端
 *   （保留 Content-Type 边界，服务端校验媒体类型与大小），本路由仅做登录门禁与转发
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

export async function POST(request: Request): Promise<NextResponse> {
  const user = await currentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "请使用 multipart 上传" }, { status: 400 });
  }
  // 原样透传 multipart 请求体（含边界），由 Python 端解析文件与 prefix
  const body = await request.arrayBuffer();
  const { ok, status, body: resBody } = await callPython(
    "/api/admin/media/upload-file",
    {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    },
  );
  return ok ? NextResponse.json(resBody) : errorResponse(status, resBody);
}

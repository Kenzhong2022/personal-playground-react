import { NextResponse } from "next/server";
import { callPython, errorResponse } from "@/lib/pythonApi";

/**
 * @description 飞书文档管理转发层：
 *   GET  ?doc_id=       —— 转发 /api/reports/snapshots/{doc_id}，读最近一次成功快照（PDF 直链 + revision + 时间）
 *   GET  ?history=      —— 转发 /api/reports/fetch-history，读当前用户的 wiki 链接拉取历史
 *   GET  ?schedules=    —— 转发 /api/reports/schedules，读当前用户的定时总结任务列表
 *   GET  ?summaries=1&doc_id= —— 转发 /api/reports/summaries/{doc_id}，读某文档的历史总结列表
 *   POST action=list     —— 传 wiki_url，转发 /api/reports/docs 拉取链接自身及子文档列表；
 *                           Python 端拉取成功后自行解析标题落库拉取历史（同用户同链接去重）
 *   POST action=snapshot —— 传 node_token，转发 /api/reports/snapshots 对单篇文档导出 PDF 落桶落库
 *   POST action=summary  —— 传 node_token，转发 /api/reports/summaries 触发 AI 总结（Agent 读快照 PDF）
 *   POST action=history-delete —— 传 wiki_url，删除一条拉取历史
 *   POST action=schedule-save   —— 保存/覆盖定时总结任务（同用户同链接唯一，Python 端校验字段）
 *   POST action=schedule-toggle —— 传 schedule_id + enabled，启用/停用定时任务
 *   POST action=schedule-delete —— 传 schedule_id，删除定时任务
 *   登录门禁与 /api/admin/media 一致（/api/auth/me 校验）；用户身份一律
 *   由 Python 端从 cb_token Cookie 自行解析，本层只透传 Cookie，不传用户 id
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

/** @description 带 Cookie 转发请求到 Python 端（用户身份由 Python 解析 Cookie） */
async function forwardWithCookie(
  request: Request,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<NextResponse> {
  const cookie = request.headers.get("cookie");
  const { ok, status, body: result } = await callPython(path, {
    method,
    headers: cookie
      ? { cookie, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return ok ? NextResponse.json(result) : errorResponse(status, result);
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await currentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;

  if (params.get("history") !== null) {
    return forwardWithCookie(request, "GET", "/api/reports/fetch-history");
  }

  if (params.get("schedules") !== null) {
    // 可选 wiki_url：Python 端只返回与该链接一致或位于其子树内的任务
    const wikiUrlParam = params.get("wiki_url");
    const suffix = wikiUrlParam
      ? `?wiki_url=${encodeURIComponent(wikiUrlParam)}`
      : "";
    return forwardWithCookie(request, "GET", `/api/reports/schedules${suffix}`);
  }

  if (params.get("summaries") !== null) {
    const summaryDocId = params.get("doc_id");
    if (!summaryDocId) {
      return NextResponse.json({ error: "请提供 doc_id" }, { status: 400 });
    }
    return forwardWithCookie(
      request,
      "GET",
      `/api/reports/summaries/${encodeURIComponent(summaryDocId)}`,
    );
  }

  const docId = params.get("doc_id");
  if (!docId) {
    return NextResponse.json({ error: "请提供 doc_id" }, { status: 400 });
  }
  const { ok, status, body } = await callPython(
    `/api/reports/snapshots/${encodeURIComponent(docId)}`,
  );
  return ok ? NextResponse.json(body) : errorResponse(status, body);
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await currentUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const payload = (await request.json().catch(() => null)) as {
    action?: unknown;
    wiki_url?: unknown;
    node_token?: unknown;
    model?: unknown;
    schedule_id?: unknown;
    frequency?: unknown;
    time?: unknown;
    weekday?: unknown;
    month_day?: unknown;
    enabled?: unknown;
  } | null;
  const action = typeof payload?.action === "string" ? payload.action : "list";

  if (action === "history-delete") {
    if (typeof payload?.wiki_url !== "string" || !payload.wiki_url.trim()) {
      return NextResponse.json({ error: "请提供 wiki_url" }, { status: 400 });
    }
    return forwardWithCookie(request, "DELETE", "/api/reports/fetch-history", {
      wiki_url: payload.wiki_url.trim(),
    });
  }

  if (action === "schedule-save") {
    if (typeof payload?.wiki_url !== "string" || !payload.wiki_url.trim()) {
      return NextResponse.json({ error: "请提供飞书 wiki 链接" }, { status: 400 });
    }
    // 字段校验在 Python 端（模型白名单 / 频率 / 时间格式），本层透传
    return forwardWithCookie(request, "POST", "/api/reports/schedules", {
      wiki_url: payload.wiki_url.trim(),
      model: payload.model,
      frequency: payload.frequency,
      time: payload.time,
      weekday: payload.weekday,
      month_day: payload.month_day,
      enabled: payload.enabled,
    });
  }

  if (action === "schedule-toggle") {
    if (typeof payload?.schedule_id !== "string" || !payload.schedule_id) {
      return NextResponse.json({ error: "请提供 schedule_id" }, { status: 400 });
    }
    return forwardWithCookie(
      request,
      "PUT",
      `/api/reports/schedules/${encodeURIComponent(payload.schedule_id)}`,
      { enabled: payload.enabled === true },
    );
  }

  if (action === "schedule-delete") {
    if (typeof payload?.schedule_id !== "string" || !payload.schedule_id) {
      return NextResponse.json({ error: "请提供 schedule_id" }, { status: 400 });
    }
    return forwardWithCookie(
      request,
      "DELETE",
      `/api/reports/schedules/${encodeURIComponent(payload.schedule_id)}`,
    );
  }

  if (action === "list") {
    if (typeof payload?.wiki_url !== "string" || !payload.wiki_url.trim()) {
      return NextResponse.json({ error: "请提供飞书 wiki 链接" }, { status: 400 });
    }
    // 透传 Cookie：Python 端解析用户身份用于拉取历史落库
    const cookie = request.headers.get("cookie");
    const { ok, status, body } = await callPython("/api/reports/docs", {
      method: "POST",
      headers: cookie
        ? { cookie, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
      body: JSON.stringify({ wiki_url: payload.wiki_url.trim() }),
    });
    return ok ? NextResponse.json(body) : errorResponse(status, body);
  }

  if (action === "snapshot") {
    if (typeof payload?.node_token !== "string" || !payload.node_token.trim()) {
      return NextResponse.json({ error: "请提供 node_token" }, { status: 400 });
    }
    const { ok, status, body } = await callPython("/api/reports/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wiki_node_token: payload.node_token.trim() }),
    });
    return ok ? NextResponse.json(body) : errorResponse(status, body);
  }

  if (action === "summary") {
    // AI 总结：Agent 自主读取最近快照 PDF 并产出结构化总结（耗时 10~60 秒）
    // 可选 model 指定 Gemini 模型（后端白名单校验）
    if (typeof payload?.node_token !== "string" || !payload.node_token.trim()) {
      return NextResponse.json({ error: "请提供 node_token" }, { status: 400 });
    }
    const body: Record<string, string> = {
      wiki_node_token: payload.node_token.trim(),
    };
    if (typeof payload?.model === "string" && payload.model.trim()) {
      body.model = payload.model.trim();
    }
    const { ok, status, body: result } = await callPython("/api/reports/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return ok ? NextResponse.json(result) : errorResponse(status, result);
  }

  return NextResponse.json({ error: "未知的操作类型" }, { status: 400 });
}

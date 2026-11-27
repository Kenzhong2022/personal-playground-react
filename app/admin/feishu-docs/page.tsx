import { cookies } from "next/headers";
import PageLayout from "@/components/PageLayout";
import { callPython } from "@/lib/pythonApi";
import FetchHistoryAside, { type HistoryItem } from "./FetchHistoryAside";
import FeishuDocsContainer from "./FeishuDocsContainer";

/**
 * @description 后台飞书文档管理（服务端组件）：页面级 RSC 带请求 Cookie 调 Python
 *   读取当前用户的拉取历史，交由左侧 FetchHistoryAside（服务端组件）渲染；
 *   点击历史条目经 ?wiki_url= URL 参数联动右侧 FeishuDocsContainer（客户端）的输入框；
 *   删除历史 / 拉取文档成功后由客户端 router.refresh() 触发本页重新取数
 */
export default async function AdminFeishuDocsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const activeWikiUrl =
    typeof params.wiki_url === "string" ? params.wiki_url : "";

  // 服务端取数：转发请求 Cookie 给 Python（cb_token 鉴权），按用户隔离读取拉取历史
  let history: HistoryItem[] = [];
  const cookie = (await cookies()).toString();
  if (cookie) {
    const { ok, body } = await callPython("/api/reports/fetch-history", {
      headers: { cookie },
    });
    const rows = ok
      ? (body as { history?: HistoryItem[] } | null)?.history
      : undefined;
    if (Array.isArray(rows)) history = rows;
  }

  return (
    <PageLayout>
      <div className="flex min-h-[60vh] gap-4">
        <FetchHistoryAside history={history} activeWikiUrl={activeWikiUrl} />
        <FeishuDocsContainer initialWikiUrl={activeWikiUrl} />
      </div>
    </PageLayout>
  );
}

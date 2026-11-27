import Link from "next/link";
import { Empty } from "antd";
import HistoryDeleteButton from "./HistoryDeleteButton";

/** @description 拉取历史条目（落库 report_fetch_history，按用户隔离、同链接去重） */
export type HistoryItem = {
  id?: string;
  wiki_url: string;
  /** 链接对应文档的标题（取子树遍历第一项即链接自身） */
  title: string | null;
  fetched_at: string;
};

/**
 * @description 左侧拉取历史栏（服务端组件）：数据由页面级 RSC 取数注入，
 *   点击条目经 ?wiki_url= URL 参数联动右侧客户端面板的输入框；
 *   删除交互下沉到 HistoryDeleteButton（客户端），删完 router.refresh() 重新取数
 */
export default function FetchHistoryAside({
  history,
  activeWikiUrl,
}: {
  history: HistoryItem[];
  activeWikiUrl: string;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 rounded-lg border border-(--ant-color-border-secondary) bg-(--ant-color-bg-container) p-3">
      <span className="text-sm font-medium">拉取历史</span>
      {history.length === 0 ? (
        <Empty
          description="暂无历史"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="mt-6"
        />
      ) : (
        <ul className="flex max-h-[70vh] flex-col gap-1 overflow-auto">
          {history.map((h) => (
            <li key={h.wiki_url}>
              <div
                className={`group flex w-full items-center rounded-md px-2 py-1.5 transition-colors hover:bg-(--ant-color-fill-tertiary) ${
                  h.wiki_url === activeWikiUrl
                    ? "bg-(--ant-color-fill-secondary)"
                    : ""
                }`}
              >
                <Link
                  href={`/admin/feishu-docs?wiki_url=${encodeURIComponent(h.wiki_url)}`}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-xs text-(--ant-color-text)">
                    {h.title || "（无标题）"}
                  </div>
                  <div className="text-[11px] text-(--ant-color-text-tertiary)">
                    {h.fetched_at.slice(0, 16).replace("T", " ")}
                  </div>
                </Link>
                <HistoryDeleteButton wikiUrl={h.wiki_url} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

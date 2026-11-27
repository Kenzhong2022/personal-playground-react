"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

/**
 * @description 拉取历史的删除按钮（客户端组件）：POST 删除后 router.refresh()
 *   触发服务端组件重新取数，左侧历史列表随之更新
 */
export default function HistoryDeleteButton({ wikiUrl }: { wikiUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="text"
      size="small"
      icon={<DeleteOutlined />}
      loading={pending}
      className="ml-1 shrink-0 text-(--ant-color-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100"
      title="删除该条历史"
      onClick={() => {
        startTransition(async () => {
          await fetch("/api/admin/feishu-docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "history-delete",
              wiki_url: wikiUrl,
            }),
          });
          router.refresh();
        });
      }}
    />
  );
}

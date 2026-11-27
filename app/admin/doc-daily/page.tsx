"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  App as AntApp,
  Button,
  Empty,
  Modal,
  Spin,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  ClockCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import PageLayout from "@/components/PageLayout";

/**
 * @description 文档日报页（从飞书文档管理页「查看」新标签页进入）：左右布局，
 *   左侧上下布局——上方预览该文档最近一次快照 PDF，下方展示该文档的定时总结
 *   任务设置情况（启停 / 删除）；右侧为该文档的每日摘要记录列表，点击「查看」
 *   弹窗展示结构化总结（概述 / 内容要点 / 待办）
 */

/** @description 快照简要信息（GET ?doc_id= 返回的 current） */
type SnapshotBrief = {
  record_id: string;
  title: string | null;
  revision: number | null;
  pdf_url: string | null;
  started_at: string | null;
};

/** @description 结构化总结结果（report_summaries.summary JSON 字段） */
type SummaryResult = {
  title: string;
  overview: string;
  key_points: string[];
  action_items: string[];
};

/** @description 每日摘要记录（report_summaries 表行，最新在前） */
type SummaryRecord = {
  id: string;
  doc_id: string;
  model: string | null;
  summary: SummaryResult | null;
  elapsed_ms: number | null;
  created_at: string;
};

/** @description 定时总结任务（服务端 report_schedules 表行） */
type ScheduleItem = {
  id: string;
  wiki_url: string;
  /** 文档标题（保存时由后端从拉取历史补齐） */
  title: string | null;
  task_type: string;
  model: string;
  frequency: "daily" | "weekly" | "monthly";
  time: string;
  weekday: number | null;
  month_day: number | null;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
};

/** @description scheduleLabel 只关心这几个字段 */
type ScheduleLike = Pick<
  ScheduleItem,
  "frequency" | "time" | "weekday" | "month_day" | "model" | "enabled"
>;

const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

/** @description 定时任务的一句话摘要（列表行展示用） */
const scheduleLabel = (d: ScheduleLike) => {
  const when =
    d.frequency === "daily"
      ? "每天"
      : d.frequency === "weekly"
        ? `每周${
            WEEKDAY_OPTIONS.find((w) => w.value === d.weekday)?.label.slice(1) ??
            ""
          }`
        : `每月 ${d.month_day} 号`;
  return `${when} ${d.time} · ${d.model}${d.enabled ? "" : " · 已停用"}`;
};

/** @description 快照时间 / revision 标注（预览区上方展示） */
const snapshotLabel = (s: SnapshotBrief) => {
  const time = s.started_at
    ? s.started_at.slice(0, 19).replace("T", " ")
    : "";
  return `revision ${s.revision ?? "—"} · ${time}`;
};

/** @description 日报页主体：searchParams 读取 doc_id / title / wiki_url */
function DocDailyContent() {
  const { message } = AntApp.useApp();
  const searchParams = useSearchParams();
  const docId = searchParams.get("doc_id") ?? "";
  const title = searchParams.get("title") ?? "";
  const wikiUrl = searchParams.get("wiki_url") ?? "";

  // 最近一次 PDF 快照（null = 无快照）
  const [snapshot, setSnapshot] = useState<SnapshotBrief | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  // 该文档的定时总结任务列表
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  // 每日摘要记录列表
  const [summaries, setSummaries] = useState<SummaryRecord[]>([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  // 当前查看的摘要记录（null = 弹窗关闭）
  const [activeSummary, setActiveSummary] = useState<SummaryRecord | null>(
    null,
  );

  /** @description 挂载：并行拉取最近快照与摘要记录（均按 doc_id 查询） */
  useEffect(() => {
    (async () => {
      if (!docId) {
        setSnapshotLoading(false);
        setSummariesLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/admin/feishu-docs?doc_id=${encodeURIComponent(docId)}`,
        );
        const data = await res.json().catch(() => null);
        setSnapshot(
          res.ok ? ((data?.current as SnapshotBrief | undefined) ?? null) : null,
        );
      } catch {
        setSnapshot(null);
      } finally {
        setSnapshotLoading(false);
      }
    })();
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/feishu-docs?summaries=1&doc_id=${encodeURIComponent(docId)}`,
        );
        const data = await res.json().catch(() => null);
        setSummaries(
          res.ok && Array.isArray(data?.summaries)
            ? (data.summaries as SummaryRecord[])
            : [],
        );
      } catch {
        setSummaries([]);
      } finally {
        setSummariesLoading(false);
      }
    })();
  }, [docId]);

  /** @description 拉取当前文档的定时任务（wiki_url 交后端过滤，前端只展示） */
  const loadSchedules = useCallback(async () => {
    if (!wikiUrl) {
      setSchedules([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/feishu-docs?schedules=1&wiki_url=${encodeURIComponent(wikiUrl)}`,
      );
      const data = await res.json();
      setSchedules(
        res.ok && Array.isArray(data.schedules)
          ? (data.schedules as ScheduleItem[])
          : [],
      );
    } catch {
      setSchedules([]);
    }
  }, [wikiUrl]);

  /** @description 挂载时拉取该文档的定时任务 */
  useEffect(() => {
    (async () => {
      await loadSchedules();
    })();
  }, [loadSchedules]);

  /** @description 启用 / 停用定时任务（乐观更新，失败回滚） */
  const toggleSchedule = useCallback(
    async (item: ScheduleItem, enabled: boolean) => {
      setSchedules((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, enabled } : s)),
      );
      try {
        const res = await fetch("/api/admin/feishu-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "schedule-toggle",
            schedule_id: item.id,
            enabled,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "操作失败");
        }
      } catch (err) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === item.id ? { ...s, enabled: !enabled } : s)),
        );
        message.error(err instanceof Error ? err.message : "操作失败");
      }
    },
    [message],
  );

  /** @description 删除定时任务 */
  const deleteSchedule = useCallback(
    async (item: ScheduleItem) => {
      try {
        const res = await fetch("/api/admin/feishu-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "schedule-delete",
            schedule_id: item.id,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "删除失败");
        }
        message.success("定时任务已删除");
        await loadSchedules();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [loadSchedules, message],
  );

  const docTitle = title || snapshot?.title || "（未命名文档）";

  return (
    <PageLayout>
      <div className="flex h-full min-h-[60vh] gap-4">
        {/* 左侧容器：上下布局（上=PDF 预览，下=定时任务设置情况） */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileTextOutlined className="text-(--ant-color-text-secondary)" />
            <Typography.Text strong className="text-base">
              {docTitle}
            </Typography.Text>
          </div>

          {/* 上：预览文档 PDF */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">文档预览</span>
              {snapshot && (
                <>
                  <Tag color="blue">最近一次</Tag>
                  <Typography.Text type="secondary" className="text-xs">
                    {snapshotLabel(snapshot)}
                  </Typography.Text>
                </>
              )}
            </div>
            {snapshotLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Spin />
              </div>
            ) : snapshot?.pdf_url ? (
              <iframe
                src={snapshot.pdf_url}
                title={`snapshot-${snapshot.record_id}`}
                className="min-h-0 w-full flex-1 rounded-md border border-(--ant-color-border-secondary)"
              />
            ) : (
              <Empty
                className="flex flex-1 flex-col items-center justify-center"
                description="该文档还没有 PDF 快照，先在飞书文档管理页点击「更新快照」生成"
              />
            )}
          </div>

          {/* 下：定时任务设置情况 */}
          <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-(--ant-color-border-secondary) bg-(--ant-color-bg-container) p-3">
            <div className="flex items-center gap-2">
              <ClockCircleOutlined className="text-xs text-(--ant-color-text-tertiary)" />
              <span className="text-sm font-medium">定时任务</span>
              <Typography.Text type="secondary" className="text-xs">
                共 {schedules.length} 个
              </Typography.Text>
            </div>
            {schedules.length === 0 ? (
              <Empty
                description="该文档暂无定时任务，可在飞书文档管理页设置"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                className="my-2"
              />
            ) : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-auto">
                {schedules.map((s) => (
                  <li key={s.id}>
                    <div className="group flex w-full items-center rounded-md px-2 py-1.5 transition-colors hover:bg-(--ant-color-fill-tertiary)">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-(--ant-color-text)">
                          {scheduleLabel(s)}
                        </div>
                        <div className="truncate text-[11px] text-(--ant-color-text-tertiary)">
                          上次执行：
                          {s.last_run_at
                            ? s.last_run_at.slice(0, 16).replace("T", " ")
                            : "尚未执行"}
                        </div>
                      </div>
                      <Switch
                        size="small"
                        checked={s.enabled}
                        className="ml-1 shrink-0"
                        onChange={(v) => void toggleSchedule(s, v)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        className="ml-1 shrink-0 text-(--ant-color-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100"
                        title="删除该任务"
                        onClick={() => void deleteSchedule(s)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 右侧容器：每日摘要记录 */}
        <aside className="flex w-80 shrink-0 flex-col gap-2 rounded-lg border border-(--ant-color-border-secondary) bg-(--ant-color-bg-container) p-3">
          <span className="text-sm font-medium">每日摘要</span>
          {summariesLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spin />
            </div>
          ) : summaries.length === 0 ? (
            <Empty
              description="暂无摘要记录"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              className="mt-6"
            />
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              {summaries.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border border-(--ant-color-border-secondary) p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-(--ant-color-text)">
                      {s.created_at.slice(0, 16).replace("T", " ")}
                    </span>
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setActiveSummary(s)}
                    >
                      查看
                    </Button>
                  </div>
                  <div className="mt-1 truncate text-xs text-(--ant-color-text)">
                    {s.summary?.title || "（无标题）"}
                  </div>
                  <div className="truncate text-[11px] text-(--ant-color-text-tertiary)">
                    {s.model || "—"}
                    {s.elapsed_ms != null &&
                      ` · 耗时 ${(s.elapsed_ms / 1000).toFixed(1)} 秒`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* 摘要弹窗：概述 / 内容要点 / 待办（与 AI 总结弹窗同结构） */}
      <Modal
        open={activeSummary !== null}
        title={
          <span>
            每日摘要：{docTitle}
            {activeSummary?.model && (
              <span className="ml-2 text-xs font-normal text-(--ant-color-text-tertiary)">
                {activeSummary.model}
              </span>
            )}
            {activeSummary?.elapsed_ms != null && (
              <span className="ml-2 text-xs font-normal text-(--ant-color-text-tertiary)">
                耗时 {(activeSummary.elapsed_ms / 1000).toFixed(1)} 秒
              </span>
            )}
          </span>
        }
        footer={null}
        width={760}
        onCancel={() => setActiveSummary(null)}
      >
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
          <div>
            <Typography.Title level={5} className="mb-1">
              概述
            </Typography.Title>
            <p className="text-sm leading-6 text-(--ant-color-text)">
              {activeSummary?.summary?.overview || "（无概述内容）"}
            </p>
          </div>
          <div>
            <Typography.Title level={5} className="mb-1">
              内容要点
            </Typography.Title>
            {activeSummary?.summary?.key_points.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-(--ant-color-text)">
                {activeSummary.summary.key_points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : (
              <Empty
                description="无内容要点"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
          {activeSummary?.summary?.action_items.length ? (
            <div>
              <Typography.Title level={5} className="mb-1">
                待办 / 行动项
              </Typography.Title>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-(--ant-color-warning)">
                {activeSummary.summary.action_items.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty
              description="无待办事项"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </div>
      </Modal>
    </PageLayout>
  );
}

export default function AdminDocDailyPage() {
  // useSearchParams 需包在 Suspense 内，否则静态预渲染阶段构建报错
  return (
    <Suspense
      fallback={
        <PageLayout>
          <div className="flex h-full items-center justify-center">
            <Spin />
          </div>
        </PageLayout>
      }
    >
      <DocDailyContent />
    </Suspense>
  );
}

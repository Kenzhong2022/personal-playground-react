"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Listy,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  TimePicker,
  Tooltip,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  ClockCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileDoneOutlined,
  NodeIndexOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

/**
 * @description 飞书文档管理核心容器（客户端）：输入知识库 wiki 链接，经 /api/admin/feishu-docs
 *   转发 Python 服务端拉取该链接自身及其全部子文档列表；操作列可对单篇文档
 *   更新快照（导出 PDF 上传桶 + 落库）；查看跳转 /admin/doc-daily 日报页；支持为当前
 *   链接设置定时总结任务。左侧拉取历史已拆为服务端组件（FetchHistoryAside），
 *   点击历史经 ?wiki_url= URL 参数联动本输入框，删除 / 拉取成功后 router.refresh()
 *   触发服务端重新取数
 */

type WikiDoc = {
  node_token: string;
  doc_id: string | null;
  title: string;
  obj_type: string | null;
  has_child: boolean;
  parent_node_token: string;
};

type SummaryResult = {
  title: string;
  overview: string;
  key_points: string[];
  action_items: string[];
};

/** @description 总结模型下拉选项（与后端白名单对齐） */
const MODEL_OPTIONS = [
  {
    value: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    desc: "上一代通用 Flash 模型，适合常规自动化与多模态任务",
  },
  {
    value: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    desc: "高吞吐、低延迟，适合文档解析与轻量级 Agent 子任务",
  },
  {
    value: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite（默认）",
    desc: "当前默认模型",
  },
];

/** @description 定时总结任务表单值（time 为 dayjs 对象，提交前格式化为 HH:mm） */
type ScheduleFormValues = {
  model: string;
  frequency: "daily" | "weekly" | "monthly";
  time: Dayjs;
  weekday?: number;
  month_day?: number;
  enabled: boolean;
};

/** @description 定时总结任务（服务端 report_schedules 表行，Python 端扫描器按此触发） */
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

const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

export default function FeishuDocsContainer({
  initialWikiUrl,
}: {
  initialWikiUrl: string;
}) {
  const { message } = AntApp.useApp();
  const router = useRouter();
  const [wikiUrl, setWikiUrl] = useState(initialWikiUrl);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<WikiDoc[] | null>(null);
  // 正在更新快照的行（node_token），同一时刻只允许一行在途
  const [snapshotting, setSnapshotting] = useState<string | null>(null);
  // 正在生成 AI 总结的行（node_token）
  const [summarizing, setSummarizing] = useState<string | null>(null);
  // AI 总结弹窗数据（null = 关闭）
  const [summary, setSummary] = useState<{
    docTitle: string;
    model: string;
    result: SummaryResult;
    elapsedSeconds: number | null;
  } | null>(null);
  // AI 总结使用的模型（下拉选择，重新总结时生效）
  const [summaryModel, setSummaryModel] = useState("gemini-3.1-flash-lite");
  // 定时总结任务弹窗开关
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // 定时总结任务列表（服务端 report_schedules，挂载时拉取）
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [scheduleForm] = Form.useForm<ScheduleFormValues>();
  // 执行频率（用于条件渲染每周 / 每月执行日）
  const scheduleFrequency = Form.useWatch("frequency", scheduleForm);

  /** @description 点击左侧历史条目（URL 参数变化）时同步输入框 */
  useEffect(() => {
    (async () => {
      setWikiUrl(initialWikiUrl);
    })();
  }, [initialWikiUrl]);

  /**
   * @description 拉取定时任务列表：wiki_url 传给后端过滤（一致或位于其子树内），
   *   前端只做展示；url 为空时不请求、直接清空
   */
  const loadSchedules = useCallback(async (url: string) => {
    const target = url.trim();
    if (!target) {
      setSchedules([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/feishu-docs?schedules=1&wiki_url=${encodeURIComponent(target)}`,
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
  }, []);

  const fetchDocs = useCallback(async () => {
    const url = wikiUrl.trim();
    if (!url) {
      message.warning("请输入飞书 wiki 链接");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/feishu-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wiki_url: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "拉取文档列表失败");
      const list = Array.isArray(data.docs) ? data.docs : [];
      setDocs(list);
      // 拉取会同步更新服务端该链接的历史与标题，刷新服务端取数保持左侧历史一致
      await loadSchedules(url);
      router.refresh();
      message.success(`已拉取 ${(data.count as number) ?? 0} 个节点`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "拉取文档列表失败");
      setDocs(null);
    } finally {
      setLoading(false);
    }
  }, [message, wikiUrl, loadSchedules, router]);

  /** @description 更新快照：对单篇文档导出 PDF 上传桶 + 落库（POST action=snapshot） */
  const runSnapshot = useCallback(
    async (record: WikiDoc) => {
      setSnapshotting(record.node_token);
      try {
        const res = await fetch("/api/admin/feishu-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "snapshot",
            node_token: record.node_token,
          }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data?.error ?? data?.detail ?? "更新快照失败");
        const result = (
          data.results as
            | Array<{
                ok?: boolean;
                skipped?: boolean;
                error?: string;
                title?: string;
                revision?: number;
              }>
            | undefined
        )?.[0];
        if (!result?.ok) {
          throw new Error(result?.error ?? "更新快照失败");
        }
        if (result.skipped) {
          message.info(
            `《${record.title}》内容无变化（revision ${result.revision}），已跳过`,
          );
        } else {
          message.success(
            `《${result.title ?? record.title}》快照已更新（revision ${result.revision}）`,
          );
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : "更新快照失败");
      } finally {
        setSnapshotting(null);
      }
    },
    [message],
  );

  /** @description 查看：新开标签页进入文档日报页（PDF 预览 + 定时任务 + 每日摘要） */
  const openDocDaily = useCallback(
    (record: WikiDoc) => {
      if (!record.doc_id) {
        message.warning("该行没有文档 ID，无法查看");
        return;
      }
      const params = new URLSearchParams({
        doc_id: record.doc_id,
        title: record.title,
      });
      if (wikiUrl.trim()) params.set("wiki_url", wikiUrl.trim());
      window.open(`/admin/doc-daily?${params.toString()}`, "_blank");
    },
    [message, wikiUrl],
  );

  /** @description AI 总结：Agent 读最近快照 PDF 产出结构化总结（POST action=summary，耗时 10~60 秒） */
  const runSummary = useCallback(
    async (record: WikiDoc) => {
      setSummarizing(record.node_token);
      try {
        const res = await fetch("/api/admin/feishu-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "summary",
            node_token: record.node_token,
            model: summaryModel,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "AI 总结失败");
        const result = data.summary as SummaryResult | undefined;
        if (!result) throw new Error("总结结果为空");
        setSummary({
          docTitle: result.title ?? record.title,
          model: (data.model as string) ?? "",
          result,
          elapsedSeconds: (data.elapsed_seconds as number | null) ?? null,
        });
        message.success(
          `AI 总结完成，耗时 ${(data.elapsed_seconds as number) ?? "?"} 秒`,
        );
      } catch (err) {
        message.error(err instanceof Error ? err.message : "AI 总结失败");
      } finally {
        setSummarizing(null);
      }
    },
    [message, summaryModel],
  );

  /** @description 保存定时总结任务：提交到后端（同链接覆盖），成功后刷新列表 */
  const saveSchedule = useCallback(
    async (values: ScheduleFormValues) => {
      try {
        const res = await fetch("/api/admin/feishu-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "schedule-save",
            wiki_url: wikiUrl.trim(),
            model: values.model,
            frequency: values.frequency,
            time: values.time.format("HH:mm"),
            weekday:
              values.frequency === "weekly" ? (values.weekday ?? null) : null,
            month_day:
              values.frequency === "monthly"
                ? (values.month_day ?? null)
                : null,
            enabled: values.enabled,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "保存定时任务失败");
        setScheduleOpen(false);
        message.success("定时总结任务已保存，到期将自动总结并发送邮件");
        await loadSchedules(wikiUrl);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "保存定时任务失败");
      }
    },
    [loadSchedules, message, wikiUrl],
  );

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
        await loadSchedules(wikiUrl);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [loadSchedules, message, wikiUrl],
  );

  /** @description 挂载 / 历史切换（URL 参数变化）时拉取该文档的定时任务 */
  useEffect(() => {
    (async () => {
      await loadSchedules(initialWikiUrl);
    })();
  }, [loadSchedules, initialWikiUrl]);

  const columns: TableColumnsType<WikiDoc> = [
    {
      title: "标题",
      dataIndex: "title",
      width: 280,
      render: (title: string, record) => (
        <div className="flex items-center gap-1">
          <Typography.Text
            ellipsis={{ tooltip: true }}
            className="min-w-0 flex-1"
          >
            {title}
          </Typography.Text>
          {record.has_child && <Tag className="shrink-0">含子级</Tag>}
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "obj_type",
      width: 100,
      render: (value: string | null) => (value ? <Tag>{value}</Tag> : "—"),
    },
    {
      title: "文档 ID",
      dataIndex: "doc_id",
      width: 220,
      render: (value: string | null) =>
        value ? (
          <Typography.Text
            copyable={{ text: value }}
            ellipsis={{ tooltip: true }}
            className="block text-xs"
          >
            {value}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "节点 token",
      dataIndex: "node_token",
      width: 220,
      render: (value: string) => (
        <Typography.Text
          copyable={{ text: value }}
          ellipsis={{ tooltip: true }}
          className="block text-xs"
        >
          {value}
        </Typography.Text>
      ),
    },
    {
      title: "父节点",
      dataIndex: "parent_node_token",
      width: 140,
      ellipsis: true,
      render: (value: string) => (
        <Typography.Text
          copyable={{ text: value }}
          ellipsis={{ tooltip: true }}
          className="block text-xs"
        >
          {value}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 140,

      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<FileDoneOutlined />}
            loading={snapshotting === record.node_token}
            disabled={
              snapshotting !== null && snapshotting !== record.node_token
            }
            onClick={() => void runSnapshot(record)}
          >
            更新快照
          </Button>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDocDaily(record)}
          >
            查看
          </Button>
          <Button
            size="small"
            icon={<RobotOutlined />}
            loading={summarizing === record.node_token}
            disabled={summarizing !== null && summarizing !== record.node_token}
            title="用上方所选模型读取该文档最近快照生成 AI 总结（耗时 10~60 秒）"
            onClick={() => void runSummary(record)}
          >
            总结
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-base font-medium">飞书文档管理</span>
          <span className="text-xs text-(--ant-color-text-tertiary)">
            输入知识库 wiki
            链接，拉取链接自身及其全部子文档（链接文档需先把应用添加为协作者）
          </span>
        </div>

        <Space.Compact className="w-full max-w-3xl">
          <Input
            value={wikiUrl}
            onChange={(e) => setWikiUrl(e.target.value)}
            onPressEnter={() => void fetchDocs()}
            placeholder="https://xxx.feishu.cn/wiki/..."
            allowClear
          />
          <Button
            type="primary"
            icon={<NodeIndexOutlined />}
            loading={loading}
            onClick={() => void fetchDocs()}
          >
            拉取文档
          </Button>
          <Button
            icon={<ClockCircleOutlined />}
            disabled={!wikiUrl.trim()}
            title={
              wikiUrl.trim()
                ? "为当前链接的文档设置定时总结任务"
                : "请先输入 wiki 链接"
            }
            onClick={() => setScheduleOpen(true)}
          >
            设置定时任务
          </Button>
        </Space.Compact>

        <div className="flex items-center gap-2">
          <span className="text-xs text-(--ant-color-text-tertiary)">
            总结模型
          </span>
          <Tooltip title="选择后点击表格行的「总结」即用该模型重新总结">
            <QuestionCircleOutlined className="cursor-help text-xs text-(--ant-color-text-quaternary)" />
          </Tooltip>
          <Select
            value={summaryModel}
            onChange={(v) => setSummaryModel(v)}
            style={{ width: 260 }}
            options={MODEL_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              title: o.desc,
            }))}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spin />
          </div>
        ) : docs === null ? (
          <Empty description="输入链接后点击「拉取文档」" />
        ) : docs.length === 0 ? (
          <Empty description="该链接下没有可见文档（请确认应用已被添加为协作者）" />
        ) : (
          <Table<WikiDoc>
            rowKey="node_token"
            columns={columns}
            dataSource={docs}
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
          />
        )}
      </div>

      <aside className="flex w-60 shrink-0 flex-col gap-2 rounded-lg border border-(--ant-color-border-secondary) bg-(--ant-color-bg-container) p-3">
        <span className="text-sm font-medium">定时任务</span>
        {schedules.length === 0 ? (
          <Empty
            description="暂无定时任务"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="mt-6"
          />
        ) : (
          <Listy<ScheduleItem, string>
            items={schedules}
            rowKey="id"
            virtual={false}
            sticky
            styles={{ root: { maxHeight: "70vh", overflowY: "auto" } }}
            group={{
              // 按文档 wiki_url 分组，组头展示文档标题，组内只展示时间和模型
              key: (item) => item.wiki_url,
              title: (_groupKey, items) => items[0]?.title || "（无标题）",
            }}
            itemRender={(item) => (
              <div className="group flex w-full items-center rounded-md px-2 py-1.5 transition-colors hover:bg-(--ant-color-fill-tertiary)">
                <div className="min-w-0 flex-1 truncate text-xs text-(--ant-color-text)">
                  {item.time} · {item.model}
                </div>
                <Switch
                  size="small"
                  checked={item.enabled}
                  className="ml-1 shrink-0"
                  onChange={(v) => void toggleSchedule(item, v)}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  className="ml-1 shrink-0 text-(--ant-color-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100"
                  title="删除该任务"
                  onClick={() => void deleteSchedule(item)}
                />
              </div>
            )}
          />
        )}
      </aside>

      <Modal
        open={summary !== null}
        title={
          <span>
            AI 总结：{summary?.docTitle}
            {summary?.model && (
              <span className="ml-2 text-xs font-normal text-(--ant-color-text-tertiary)">
                {summary.model}
              </span>
            )}
            {summary?.elapsedSeconds != null && (
              <span className="ml-2 text-xs font-normal text-(--ant-color-text-tertiary)">
                耗时 {summary.elapsedSeconds} 秒
              </span>
            )}
          </span>
        }
        footer={null}
        width={760}
        onCancel={() => setSummary(null)}
      >
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
          <div>
            <Typography.Title level={5} className="mb-1">
              概述
            </Typography.Title>
            <p className="text-sm leading-6 text-(--ant-color-text)">
              {summary?.result.overview}
            </p>
          </div>
          <div>
            <Typography.Title level={5} className="mb-1">
              内容要点
            </Typography.Title>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-(--ant-color-text)">
              {summary?.result.key_points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          {summary?.result.action_items.length ? (
            <div>
              <Typography.Title level={5} className="mb-1">
                待办 / 行动项
              </Typography.Title>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-(--ant-color-warning)">
                {summary?.result.action_items.map((p, i) => (
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

      <Modal
        open={scheduleOpen}
        title="设置定时总结任务"
        width={460}
        okText="保存"
        cancelText="取消"
        onOk={() => scheduleForm.submit()}
        onCancel={() => setScheduleOpen(false)}
      >
        <Form<ScheduleFormValues>
          form={scheduleForm}
          layout="vertical"
          requiredMark={false}
          initialValues={{
            model: "gemini-3.1-flash-lite",
            frequency: "daily",
            time: dayjs("09:00", "HH:mm"),
            enabled: true,
          }}
          onFinish={saveSchedule}
        >
          <Form.Item label="任务内容">
            <Space size={8}>
              <Tag color="blue">AI 总结</Tag>
              <Typography.Text type="secondary" className="text-xs">
                定时对当前链接及其全部子文档生成总结
              </Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item
            label="总结模型"
            name="model"
            rules={[{ required: true, message: "请选择总结模型" }]}
          >
            <Select
              options={MODEL_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                title: o.desc,
              }))}
            />
          </Form.Item>
          <Form.Item label="执行频率" name="frequency">
            <Radio.Group
              optionType="button"
              options={[
                { value: "daily", label: "每天" },
                { value: "weekly", label: "每周" },
                { value: "monthly", label: "每月" },
              ]}
            />
          </Form.Item>
          {scheduleFrequency === "weekly" && (
            <Form.Item
              label="执行日"
              name="weekday"
              preserve={false}
              rules={[{ required: true, message: "请选择星期" }]}
            >
              <Select options={WEEKDAY_OPTIONS} style={{ width: 120 }} />
            </Form.Item>
          )}
          {scheduleFrequency === "monthly" && (
            <Form.Item
              label="执行日"
              name="month_day"
              preserve={false}
              extra="1~28 号，避开月末缺失"
              rules={[{ required: true, message: "请输入日期" }]}
            >
              <InputNumber min={1} max={28} style={{ width: 120 }} />
            </Form.Item>
          )}
          <Form.Item
            label="执行时间"
            name="time"
            rules={[{ required: true, message: "请选择执行时间" }]}
          >
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item label="保存后启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

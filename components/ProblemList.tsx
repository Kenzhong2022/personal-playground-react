"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEventHandler,
} from "react";
import dayjs from "dayjs";
import {
  Alert,
  App as AntApp,
  Button,
  Empty,
  Flex,
  Form,
  Input,
  Listy,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";

/**
 * @description 游标分页接口返回的题目列表项：轻量字段，不含题面与题解长文本
 */
type ProblemListItem = {
  id: string | number;
  dataset_name?: string | null;
  subset?: string | null;
  title?: string | null;
  difficulty?: string | null;
  created_at?: string | null;
};

/**
 * @description 题目列表接口返回结构：items 当前页数据；has_more 是否还有下一页；next_cursor 下一页游标
 */
export type ProblemPage = {
  items: ProblemListItem[];
  has_more: boolean;
  next_cursor: string | number | null;
};

const DIFFICULTY_COLORS: Record<string, string> = {
  简单: "green",
  中等: "orange",
  困难: "red",
};

const PAGE_SIZE = 20;

const DATASET_OPTIONS = [
  { label: "mbpp", value: "mbpp" },
  { label: "custom", value: "custom" },
];

// 语言分段控制器选项：练习时选择作答语言（评测语言，暂不影响列表数据）
const LANGUAGE_OPTIONS = [
  { label: "Python", value: "python" },
  { label: "Java", value: "java" },
];

/**
 * @description 按游标拉取一页题目列表
 * @param nextCursor 下一页游标（首页传 null）
 * @param datasetName 数据集筛选（可选）
 * @returns 当前页题目、has_more 与 next_cursor
 */
async function fetchPage(
  nextCursor: string | number | null,
  datasetName?: string,
): Promise<ProblemPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (nextCursor !== null) params.set("cursor", String(nextCursor));
  if (datasetName) params.set("dataset_name", datasetName);
  const res = await fetch(`/api/problems/cursor?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error ?? "加载题目失败",
    );
  }
  return body as ProblemPage;
}

/**
 * @description 新增/编辑弹窗的表单值：test_cases 以 JSON 文本编辑，提交时解析为数组；
 *              test_imports 以逗号分隔文本编辑
 */
type ProblemFormValues = {
  dataset_name: string;
  subset?: string;
  title?: string;
  difficulty?: string;
  prompt: string;
  reference_solution?: string;
  test_imports?: string;
  test_cases: string;
};

/**
 * @description 组件属性：条目操作统一为「前往练习」（itemHref 可覆盖跳转地址，actionLabel 可覆盖文案）；
 *              initialPage 为服务端组件预取的首页数据（React Server Components，RSC 模式），传入后首屏零客户端请求，
 *              翻页 / 筛选 / 增删改仍由客户端发起；未传时回退为客户端自取（原行为）
 */
type ProblemListProps = {
  itemHref?: (item: ProblemListItem) => string;
  actionLabel?: string;
  // 语言选中变化回调（可选）：父组件可用于联动展示
  onLanguageChange?: (language: string) => void;
  initialPage?: ProblemPage;
};

/**
 * @description 题目列表页内容：游标分页逐页加载，支持按数据集筛选与题目的增删改查，点击条目前往练习页
 */
export default function ProblemList({
  itemHref,
  actionLabel = "前往练习",
  onLanguageChange,
  initialPage,
}: ProblemListProps) {
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<ProblemListItem[]>(
    initialPage?.items ?? [],
  );
  const [cursor, setCursor] = useState<string | number | null>(
    initialPage?.next_cursor ?? null,
  );
  const [hasMore, setHasMore] = useState(initialPage?.has_more ?? false);
  const [dataset, setDataset] = useState<string | undefined>();
  const [loading, setLoading] = useState(!initialPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 手动重试计数：值变化触发重新拉取首页
  const [reloadTick, setReloadTick] = useState(0);
  // 练习语言选择：Python / Java
  const [language, setLanguage] = useState("python");
  // Listy 虚拟滚动需要数值高度：包裹层在 loading/error 时不渲染（提前 return），
  // 所以用 callback ref 捕获挂载时机，挂载后由 ResizeObserver 推送尺寸（observe 时自带初始通知）
  const [listWrap, setListWrap] = useState<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState(480);
  // 加载中的 ref 标记：滚动事件可能高频触发，防止并发重复拉取
  const loadingMoreRef = useRef(false);
  // 新增/编辑弹窗：editing 为 null 表示新增；test_cases 以 JSON 文本编辑
  const [form] = Form.useForm<ProblemFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProblemListItem | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!listWrap) return;
    const observer = new ResizeObserver((entries) => {
      setListHeight(entries[0].contentRect.height);
    });
    observer.observe(listWrap);
    return () => observer.disconnect();
  }, [listWrap]);

  // 首次加载与切换数据集时重置列表，重新从第一页拉取；
  // RSC（React Server Components，下同）模式（initialPage 存在）下首屏数据由服务端下发，跳过本次客户端拉取，
  // 仅在切换数据集 / 手动重试（reloadTick 变化）时回到客户端拉取
  useEffect(() => {
    if (initialPage && dataset === undefined && reloadTick === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(null, dataset)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setHasMore(page.has_more);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, reloadTick, initialPage]);

  /**
   * @description 加载下一页并追加到列表尾部（哨兵自动触发或手动点击）
   */
  const loadMore = useCallback(async () => {
    if (cursor === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchPage(cursor, dataset);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, dataset]);

  // Listy 虚拟滚动容器的触底加载：距底部 120px 内且未在加载时拉取下一页。
  // onScroll 只在真实滚动时触发，追加数据后不继续滚动就不会重复请求
  const handleListScroll: UIEventHandler<HTMLElement> = (event) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    if (
      !hasMore ||
      loadingMoreRef.current ||
      scrollHeight - scrollTop - clientHeight > 120
    ) {
      return;
    }
    loadMore();
  };

  /** @description 打开新增弹窗（destroyOnHidden 保证每次都是空白表单） */
  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  /**
   * @description 打开编辑弹窗：列表项只有轻量字段，先按 id 拉取题目全量数据回填表单
   */
  async function openEdit(item: ProblemListItem) {
    setEditing(item);
    setModalOpen(true);
    try {
      const res = await fetch(`/api/problems?id=${item.id}`);
      const body = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & { test_imports?: string[] | null })
        | null;
      if (!res.ok) {
        throw new Error(
          (body as { error?: string } | null)?.error ?? "加载题目失败"
        );
      }
      form.setFieldsValue({
        dataset_name: String(body?.dataset_name ?? ""),
        subset: (body?.subset as string) || undefined,
        title: (body?.title as string) || undefined,
        difficulty: (body?.difficulty as string) || undefined,
        prompt: (body?.prompt as string) ?? "",
        reference_solution: (body?.reference_solution as string) || undefined,
        test_imports: Array.isArray(body?.test_imports)
          ? body?.test_imports.join(", ")
          : undefined,
        test_cases: JSON.stringify(body?.test_cases ?? [], null, 2),
      });
    } catch (err) {
      message.error((err as Error).message);
      setModalOpen(false);
    }
  }

  /**
   * @description 弹窗提交：test_cases 文本解析为 JSON 数组（非法时定位到该字段）；
   *              空可选字段不提交，编辑走 PUT 局部更新，新增走 POST 后回到第一页重新加载
   */
  async function submit() {
    let values: ProblemFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    let testCases: unknown[];
    try {
      const parsed = JSON.parse(values.test_cases) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not array");
      testCases = parsed;
    } catch {
      form.setFields([
        { name: "test_cases", errors: ["必须是合法的 JSON 数组"] },
      ]);
      return;
    }
    const payload: Record<string, unknown> = {
      dataset_name: values.dataset_name,
      prompt: values.prompt,
      test_cases: testCases,
    };
    if (values.title) payload.title = values.title;
    if (values.subset) payload.subset = values.subset;
    if (values.difficulty) payload.difficulty = values.difficulty;
    if (values.reference_solution) {
      payload.reference_solution = values.reference_solution;
    }
    const imports = (values.test_imports ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (imports.length) payload.test_imports = imports;

    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/problems/${editing.id}` : "/api/problems",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "保存失败");
      if (editing) {
        message.success(`已保存题目 #${editing.id}`);
        // 本地同步轻量字段，虚拟列表无需重拉
        setItems((prev) =>
          prev.map((it) =>
            it.id === editing.id
              ? {
                  ...it,
                  title: values.title ?? it.title,
                  difficulty: values.difficulty ?? it.difficulty,
                  dataset_name: values.dataset_name,
                  subset: values.subset ?? it.subset,
                }
              : it
          )
        );
        setModalOpen(false);
      } else {
        message.success("已新增题目");
        // 新题目的 id 在游标序列末尾，回到第一页重新加载
        setModalOpen(false);
        setReloadTick((t) => t + 1);
      }
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** @description 删除题目：成功后从本地列表移除 */
  async function remove(item: ProblemListItem) {
    try {
      const res = await fetch(`/api/problems/${item.id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "删除失败");
      message.success(`已删除题目 #${item.id}`);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载失败"
        description={error}
        action={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => setReloadTick((t) => t + 1)}
          >
            重试
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-hidden h-full">
      {/* 筛选区：语言分段控制 + 按数据集筛选，切换后从第一页重新加载 */}
      <Space wrap>
        <Segmented
          options={LANGUAGE_OPTIONS}
          value={language}
          onChange={(value) => {
            setLanguage(value as string);
            onLanguageChange?.(value as string);
          }}
        />
        <Select
          style={{ width: 160 }}
          placeholder="全部数据集"
          allowClear
          options={DATASET_OPTIONS}
          value={dataset}
          onChange={(value) => setDataset(value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增题目
        </Button>
      </Space>

      <div className="min-h-0 flex-1" ref={setListWrap}>
        {items.length === 0 ? (
          <Empty description="暂无题目" />
        ) : (
          <Listy
            virtual
            height={listHeight}
            items={items}
            rowKey={(item) => item.id}
            onScroll={handleListScroll}
            itemRender={(item) => (
              /* 行内布局自拼：左侧标题 + 标签与创建时间，右侧操作链接；
               内边距 / 分隔线 / hover 由 Listy 默认样式提供 */
              <div className="flex items-center gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <Space wrap size={8}>
                    <span>#{item.id}</span>
                    <span className="truncate">
                      {item.title || `题目 #${item.id}`}
                    </span>
                    {item.difficulty && DIFFICULTY_COLORS[item.difficulty] ? (
                      <Tag
                        color={DIFFICULTY_COLORS[item.difficulty]}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {item.difficulty}
                      </Tag>
                    ) : null}
                    {[item.dataset_name, item.subset]
                      .filter(Boolean)
                      .join(" / ") && (
                      <Tag style={{ marginInlineEnd: 0 }}>
                        {[item.dataset_name, item.subset]
                          .filter(Boolean)
                          .join(" / ")}
                      </Tag>
                    )}
                  </Space>
                  {item.created_at && (
                    <Typography.Text type="secondary">
                      创建于 {dayjs(item.created_at).format("YYYY-MM-DD HH:mm")}
                    </Typography.Text>
                  )}
                </div>
                <Space size={4} className="shrink-0 ml-auto">
                  <a
                    href={
                      itemHref
                        ? itemHref(item)
                        : `/CodeAgent/practice?id=${item.id}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {actionLabel}
                  </a>
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 4 }}
                    onClick={() => openEdit(item)}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title={`确定删除题目 #${item.id} 吗？`}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => remove(item)}
                  >
                    <Button
                      type="link"
                      size="small"
                      danger
                      style={{ paddingInline: 4 }}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            )}
          />
        )}
      </div>

      {/* 底部状态：加载中显示 Spin，空闲时提示触底自动加载 */}
      <Flex justify="center" align="center" style={{ height: 24 }}>
        {loadingMore ? (
          <Spin size="small" />
        ) : (
          <Typography.Text type="secondary">
            {!hasMore && "没有更多题目了"}
          </Typography.Text>
        )}
      </Flex>

      {/* 新增/编辑弹窗：destroyOnHidden 保证每次打开都是全新表单 */}
      <Modal
        open={modalOpen}
        title={editing ? `编辑题目 #${editing.id}` : "新增题目"}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ loading: saving }}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical">
          <Flex gap={16}>
            <Form.Item
              name="dataset_name"
              label="数据集"
              rules={[{ required: true, message: "请选择数据集" }]}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Select options={DATASET_OPTIONS} />
            </Form.Item>
            <Form.Item
              name="difficulty"
              label="难度"
              style={{ flex: 1, minWidth: 0 }}
            >
              <Select
                allowClear
                options={Object.keys(DIFFICULTY_COLORS).map((label) => ({
                  label,
                  value: label,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="subset"
              label="子集"
              style={{ flex: 1, minWidth: 0 }}
            >
              <Input placeholder="可选" />
            </Form.Item>
          </Flex>
          <Form.Item name="title" label="标题">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item
            name="prompt"
            label="题面"
            rules={[{ required: true, message: "请输入题面" }]}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            name="test_cases"
            label="测试用例（JSON 数组，元素为字符串或对象）"
            rules={[{ required: true, message: "请输入测试用例" }]}
          >
            <Input.TextArea rows={6} style={{ fontFamily: "monospace" }} />
          </Form.Item>
          <Form.Item name="test_imports" label="测试额外导入（逗号分隔）">
            <Input placeholder="如：math, itertools" />
          </Form.Item>
          <Form.Item name="reference_solution" label="参考题解">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

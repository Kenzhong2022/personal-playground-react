"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntApp,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Image as AntImage,
  Space,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Tooltip,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  FolderOutlined,
  LinkOutlined,
  ReloadOutlined,
  SoundOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { copyText } from "@/lib/clipboard";
import PageLayout from "@/components/PageLayout";

/**
 * @description 后台媒体管理：对 Supabase Storage media 桶（公开读）的图片 / 视频 /
 *   音频做增删改查——上传、重命名 / 移动、删除、复制公开链接、文件夹导航与预览。
 *   数据走 /api/admin/media（登录门禁 + 转发 Python 服务端 service key 操作），
 *   前端不接触 Supabase 凭证
 */

type MediaItem = {
  name: string;
  /** @description 展示名：中文名上传时 key 为编码形式，服务端解码还原后的原始名称 */
  displayName?: string;
  path: string;
  isFolder: boolean;
  size?: number;
  mimetype?: string;
  updatedAt?: string | null;
  publicUrl?: string;
};

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function mediaIcon(mimetype?: string) {
  if (mimetype?.startsWith("image/")) return <FileImageOutlined />;
  if (mimetype?.startsWith("video/")) return <VideoCameraOutlined />;
  if (mimetype?.startsWith("audio/")) return <SoundOutlined />;
  return <FileImageOutlined />;
}

export default function AdminMediaPage() {
  const { message } = AntApp.useApp();
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [renaming, setRenaming] = useState<MediaItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  // 上传后刷新去抖：多个文件连续上传完成时只在最后一个完成后刷新一次
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchList = useCallback(
    async (targetPrefix: string) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/media?prefix=${encodeURIComponent(targetPrefix)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "读取媒体列表失败");
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "读取媒体列表失败");
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    // 首次与切换文件夹时同步拉取列表；loading 置位是外部数据同步的一部分
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchList(prefix);
  }, [prefix, fetchList]);

  /** @description 上传完成后的合并刷新：300ms 内的多个完成只触发一次列表重取 */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void fetchList(prefix);
    }, 300);
  }, [fetchList, prefix]);

  /** @description antd Upload customRequest：multipart 转发到上传路由 */
  const customUpload = useCallback(
    (options: {
      file: unknown;
      onSuccess?: () => void;
      onError?: (err: Error) => void;
    }) => {
      const formData = new FormData();
      formData.append("file", options.file as File);
      formData.append("prefix", prefix);
      setUploading((n) => n + 1);
      fetch("/api/admin/media/upload", { method: "POST", body: formData })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          };
          if (!res.ok) throw new Error(data?.error ?? "上传失败");
          options.onSuccess?.();
          // 展示名 = 原始文件名（中文名在存储层编码为合法 key，列表时还原）
          message.success(`已上传 ${(options.file as File).name}`);
        })
        .catch((err: Error) => {
          options.onError?.(err);
          message.error(err.message);
        })
        .finally(() => {
          setUploading((n) => n - 1);
          scheduleRefresh();
        });
    },
    [message, prefix, scheduleRefresh],
  );

  const copyLink = useCallback(
    async (item: MediaItem) => {
      if (await copyText(item.publicUrl ?? ""))
        message.success("公开链接已复制");
      else message.error("复制失败，请手动复制");
    },
    [message],
  );

  const openRename = useCallback((item: MediaItem) => {
    setRenaming(item);
    setRenameValue(item.displayName ?? item.name);
  }, []);

  const submitRename = useCallback(async () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === (renaming.displayName ?? renaming.name)) {
      setRenaming(null);
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch("/api/admin/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          from: renaming.path,
          to: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "重命名失败");
      message.success("已重命名");
      setRenaming(null);
      void fetchList(prefix);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setRenameSaving(false);
    }
  }, [fetchList, message, prefix, renameValue, renaming]);

  const removeItem = useCallback(
    async (item: MediaItem) => {
      try {
        const res = await fetch("/api/admin/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", paths: [item.path] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "删除失败");
        message.success(`已删除 ${item.displayName ?? item.name}`);
        void fetchList(prefix);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [fetchList, message, prefix],
  );

  /** @description 面包屑：根目录 + prefix 逐级拆分，支持点击回跳 */
  const breadcrumbItems = [
    { title: "media", onClick: () => setPrefix("") },
    ...(prefix
      ? prefix
          .replace(/\/$/, "")
          .split("/")
          .map((segment, index, all) => ({
            title: segment,
            onClick: () => setPrefix(`${all.slice(0, index + 1).join("/")}/`),
          }))
      : []),
  ];

  return (
    <PageLayout>
      <div className="flex flex-col gap-4">
        {/* 标题与操作按钮：放在卡片内容区顶部，随白卡一起渲染 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">媒体管理</span>
            <span className="text-xs text-(--ant-color-text-tertiary)">
              Supabase Storage media 桶的图片 / 视频 / 音频资源，支持文件夹导航
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void fetchList(prefix)}
              loading={loading}
            >
              刷新
            </Button>
            <Upload
              multiple
              showUploadList={false}
              accept="image/*,video/*,audio/*"
              customRequest={customUpload as never}
            >
              <Button
                type="primary"
                icon={<UploadOutlined />}
                loading={uploading > 0}
              >
                上传媒体
              </Button>
            </Upload>
          </div>
        </div>
        <Breadcrumb items={breadcrumbItems} />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty description="此文件夹为空，点击右上角「上传媒体」添加资源" />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
            {items.map((item) => (
              <Card
                key={item.path}
                hoverable
                className="overflow-hidden"
                styles={{ body: { padding: "12px 16px" } }}
                onClick={
                  item.isFolder ? () => setPrefix(`${item.path}/`) : undefined
                }
                cover={
                  /* cover 插槽：文件夹 / 视频 / 音频展示图标，图片直接缩略图（可点击放大） */
                  <div
                    className="flex aspect-3/4 items-center justify-center overflow-hidden"
                    style={{ background: "var(--ant-color-fill-tertiary)" }}
                  >
                    {item.isFolder ? (
                      <FolderOutlined
                        style={{
                          fontSize: 40,
                          color: "var(--ant-color-primary)",
                        }}
                      />
                    ) : item.mimetype?.startsWith("image/") &&
                      item.publicUrl ? (
                      <AntImage
                        src={item.publicUrl}
                        alt={item.displayName ?? item.name}
                        className="h-full w-full object-contain"
                        /* 根节点撑满封面区：img 的 h-full 需要父级有确定高度才生效 */
                        styles={{ root: { width: "100%", height: "100%" } }}
                        preview={{
                          mask: { blur: true },
                          cover: (
                            <Space vertical align="center">
                              预览
                            </Space>
                          ),
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 40,
                          color: "var(--ant-color-text-quaternary)",
                        }}
                      >
                        {mediaIcon(item.mimetype)}
                      </span>
                    )}
                  </div>
                }
                actions={
                  /* actions 插槽：文件卡片的链接 / 重命名 / 删除（文件夹无操作） */
                  item.isFolder
                    ? undefined
                    : [
                        <Tooltip key="link" title="复制公开链接">
                          <LinkOutlined onClick={() => copyLink(item)} />
                        </Tooltip>,
                        <Tooltip key="rename" title="重命名">
                          <EditOutlined onClick={() => openRename(item)} />
                        </Tooltip>,
                        <Popconfirm
                          key="delete"
                          title="确认删除？"
                          description={`将永久删除 ${item.displayName ?? item.name}`}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => void removeItem(item)}
                        >
                          <DeleteOutlined />
                        </Popconfirm>,
                      ]
                }
              >
                {/* Meta 插槽：展示名（中文名还原）+ 大小 / 更新时间 */}
                <Card.Meta
                  title={
                    <span
                      className="truncate text-sm font-normal"
                      title={item.displayName ?? item.name}
                    >
                      {item.displayName ?? item.name}
                    </span>
                  }
                  description={
                    <span className="text-xs text-(--ant-color-text-tertiary)">
                      {item.isFolder
                        ? "文件夹"
                        : `${formatSize(item.size)} · ${
                            item.updatedAt
                              ? dayjs(item.updatedAt).format("YYYY-MM-DD HH:mm")
                              : "—"
                          }`}
                    </span>
                  }
                />
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 视频 / 音频预览弹窗（图片用 antd Image 自带预览） */}
      <Modal
        open={
          preview?.mimetype?.startsWith("video/") === true ||
          preview?.mimetype?.startsWith("audio/") === true
        }
        title={preview?.name}
        footer={null}
        width={720}
        onCancel={() => setPreview(null)}
        destroyOnHidden
      >
        {preview?.mimetype?.startsWith("video/") && (
          <video src={preview.publicUrl} controls className="w-full" />
        )}
        {preview?.mimetype?.startsWith("audio/") && (
          <audio src={preview.publicUrl} controls className="w-full" />
        )}
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        open={renaming !== null}
        title="重命名"
        okText="保存"
        cancelText="取消"
        confirmLoading={renameSaving}
        onOk={() => void submitRename()}
        onCancel={() => setRenaming(null)}
        destroyOnHidden
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => void submitRename()}
          placeholder="新的名称"
        />
        <div className="mt-2 text-xs text-(--ant-color-text-tertiary)">
          展示名称支持中文；保存后存储文件与公开链接会同步更新
        </div>
      </Modal>
    </PageLayout>
  );
}

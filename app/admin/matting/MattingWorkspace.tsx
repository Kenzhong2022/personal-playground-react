"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Space,
  Spin,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  CloudServerOutlined,
  DownloadOutlined,
  FileImageOutlined,
  InboxOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import PageLayout from "@/components/PageLayout";

/**
 * @description 在线抠图工作台：推理由 Cloudflare Workers AI（bria/remove-background）
 *   在服务端完成，前端只负责选图校验、压缩编码与结果展示。
 *   原图会压缩为最长边 2048 的 JPEG data URI 提交给本项目 /api/admin/matting 转发层，
 *   由其调用 Workers AI 并回传透明 PNG
 */

/** @description 送推理前的原图边长上限：超长边等比降采样，控制上传体积与推理耗时 */
const MAX_DIMENSION = 2048;
const MAX_FILE_SIZE = 30 * 1024 * 1024;
/** @description data URI 体积上限（服务端同款校验，前端提前拦截省一次往返） */
const MAX_DATA_URI_LENGTH = 16 * 1024 * 1024;

/** @description 透明 PNG 预览用的棋盘格背景（模拟透明区域） */
const CHECKER_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #ececec 25%, transparent 25%), " +
    "linear-gradient(-45deg, #ececec 25%, transparent 25%), " +
    "linear-gradient(45deg, transparent 75%, #ececec 75%), " +
    "linear-gradient(-45deg, transparent 75%, #ececec 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

type ResultState = { url: string; width: number; height: number };

/**
 * @description 压缩图片为适合送推理的 JPEG data URI：长边超过 2048 先等比降采样，
 *   统一 JPEG 0.92 编码控制体积（抠图场景无 Alpha 需求，有损压缩不影响效果）
 */
async function toDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) throw new Error("无法创建画布上下文");
    ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (item) => (item ? resolve(item) : reject(new Error("图片编码失败"))),
        "image/jpeg",
        0.92,
      );
    });
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(blob);
    });
    if (dataUri.length > MAX_DATA_URI_LENGTH) {
      throw new Error("图片压缩后仍然过大，请使用更小的图片");
    }
    return dataUri;
  } finally {
    bitmap.close();
  }
}

export default function MattingWorkspace() {
  const { message } = AntApp.useApp();
  const fileUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  /** @description 原图预览 object URL（state 供渲染，ref 供事件里撤销旧 URL） */
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [matteBusy, setMatteBusy] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  /** @description 接收图片：本地预览 + 校验类型与大小，推理前不经过任何网络传输 */
  const acceptFile = useCallback(
    (picked: File) => {
      if (!picked.type.startsWith("image/")) {
        message.error("请选择图片文件");
        return;
      }
      if (picked.size > MAX_FILE_SIZE) {
        message.error("图片不能超过 30MB");
        return;
      }
      setErrorText(null);
      setResult(null);
      setFile(picked);
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
      const url = URL.createObjectURL(picked);
      fileUrlRef.current = url;
      setFileUrl(url);
    },
    [message],
  );

  const startMatte = useCallback(async () => {
    if (!file || matteBusy) return;
    setErrorText(null);
    setMatteBusy(true);
    try {
      const dataUri = await toDataUri(file);
      const response = await fetch("/api/admin/matting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUri }),
      });
      if (!response.ok) {
        // 服务端错误统一为 JSON { error }，转发层已把额度/参数类错误翻译成中文
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? `抠图失败（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;
      bitmap.close();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResult({ url, width, height });
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "抠图失败，请稍后重试");
    } finally {
      setMatteBusy(false);
    }
  }, [file, matteBusy]);

  const downloadResult = useCallback(() => {
    if (!result) return;
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = `matting-${Date.now()}.png`;
    anchor.click();
  }, [result]);

  return (
    <PageLayout>
      <div className="flex flex-col gap-4">
        {/* 标题 / 服务状态 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">在线抠图</span>
            <span className="text-xs text-(--ant-color-text-tertiary)">
              推理由 Cloudflare Workers AI（bria/remove-background）在服务端完成，
              图片会压缩至最长边 2048 后提交
            </span>
          </div>
          <Space wrap>
            <Tooltip title="模型运行在 Cloudflare 服务端，无需本地下载模型文件">
              <Tag icon={<CloudServerOutlined />} color="blue">
                Workers AI · bria
              </Tag>
            </Tooltip>
          </Space>
        </div>

        {/* 每日额度提示 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--ant-color-border) px-4 py-3">
          <span className="text-sm">
            BRIA 通用主体抠图
            <span className="ml-2 text-xs text-(--ant-color-text-tertiary)">
              人像、商品、动物等任意主体，输出透明 PNG
            </span>
          </span>
          <Tag color="processing">免费额度约 6 张/天（UTC 0 点重置）</Tag>
        </div>

        {errorText && (
          <div className="rounded-lg border border-(--ant-color-error-border) bg-(--ant-color-error-bg) px-4 py-2 text-sm text-(--ant-color-error)">
            {errorText}
          </div>
        )}

        {/* 上传区 / 原图 + 结果对比 */}
        {!file ? (
          <Upload.Dragger
            accept="image/*"
            showUploadList={false}
            beforeUpload={(picked) => {
              acceptFile(picked);
              return false;
            }}
          >
            <p className="py-4">
              <InboxOutlined
                style={{ fontSize: 40, color: "var(--ant-color-primary)" }}
              />
            </p>
            <p className="text-sm">点击或拖拽图片到此处</p>
            <p className="text-xs text-(--ant-color-text-tertiary)">
              支持 JPG / PNG / WebP，单张不超过 30MB，超过 2048px
              会自动等比缩放后提交
            </p>
          </Upload.Dragger>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            <Card
              title={
                <Space>
                  <FileImageOutlined />
                  原图
                </Space>
              }
              extra={
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={(picked) => {
                    acceptFile(picked);
                    return false;
                  }}
                >
                  <Button size="small">换一张</Button>
                </Upload>
              }
              styles={{ body: { padding: 12 } }}
            >
              <div className="flex max-h-96 items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl ?? undefined}
                  alt={file.name}
                  className="max-h-96 max-w-full object-contain"
                />
              </div>
            </Card>
            <Card
              title={
                <Space>
                  <ScissorOutlined />
                  抠图结果（透明 PNG，{result ? `${result.width}×${result.height}` : "提交尺寸"}
                  ）
                </Space>
              }
              extra={
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={!result}
                  onClick={downloadResult}
                >
                  下载
                </Button>
              }
              styles={{ body: { padding: 12 } }}
            >
              <div
                className="flex max-h-96 items-center justify-center overflow-hidden"
                style={CHECKER_STYLE}
              >
                {matteBusy ? (
                  <div className="flex flex-col items-center gap-2 py-10">
                    <Spin />
                    <span className="text-xs text-(--ant-color-text-tertiary)">
                      正在抠图，请稍候…
                    </span>
                  </div>
                ) : result ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.url}
                    alt="抠图结果"
                    className="max-h-96 max-w-full object-contain"
                  />
                ) : (
                  <Empty
                    className="py-10"
                    description="点击下方「开始抠图」生成透明 PNG"
                  />
                )}
              </div>
            </Card>
          </div>
        )}

        {/* 操作区 */}
        <div className="flex justify-end gap-2">
          <Button
            type="primary"
            icon={<ScissorOutlined />}
            disabled={!file}
            loading={matteBusy}
            onClick={() => void startMatte()}
          >
            开始抠图
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}

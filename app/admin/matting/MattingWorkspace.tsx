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
  DownloadOutlined,
  FileImageOutlined,
  InboxOutlined,
  LaptopOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import PageLayout from "@/components/PageLayout";

/**
 * @description 在线抠图工作台：纯前端方案，推理由 BiRefNet-lite-512
 *   （@huggingface/transformers / ONNX Runtime Web）在浏览器内完成，
 *   优先 WebGPU（fp16），不支持或初始化失败时回退 WASM（fp32，较慢）。
 *   模型文件（fp16 约 94MB）首次使用需从 HuggingFace 下载，之后由浏览器缓存；
 *   图片完全在本地处理，不上传到任何服务器。
 *   流程：RawImage → processor（512×512 归一化）→ model → logits sigmoid
 *   得到 alpha 掩膜 → 放大回原图尺寸 → 与原图 destination-in 合成透明 PNG。
 */

const MODEL_ID = "studioludens/birefnet-lite-512";
const MAX_FILE_SIZE = 30 * 1024 * 1024;

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
type Device = "webgpu" | "wasm";

/** @description 仅用于类型的 transformers.js 模块（npm 包保持 devDependency） */
type TransformersModule = typeof import("@huggingface/transformers");

/**
 * @description transformers.js 模块与已加载模型/处理器的会话缓存（进程级，换图复用）；
 *   model/processor 字段取 AutoModel / AutoProcessor 的宽泛实例类型
 */
type MattingSession = {
  mod: TransformersModule;
  model: Awaited<ReturnType<TransformersModule["AutoModel"]["from_pretrained"]>>;
  processor: Awaited<
    ReturnType<TransformersModule["AutoProcessor"]["from_pretrained"]>
  >;
  device: Device;
};
let cachedSession: MattingSession | null = null;

/**
 * @description 运行时从 CDN 加载 transformers.js（与参考实现一致的浏览器 ESM 导入），
 *   webpackIgnore / turbopackIgnore 阻止打包器解析该 URL——否则 onnxruntime-web
 *   的 wasm（单个约 25MiB）会被拷进构建产物，超出 Cloudflare Workers 单资产 25MiB 上限；
 *   版本固定 3.1.0（参考落地页已验证可用），类型来自本地 devDependency
 */
async function loadTransformers(): Promise<TransformersModule> {
  const cdnUrl: string =
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.0/+esm";
  return (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ cdnUrl
  )) as TransformersModule;
}

/**
 * @description 加载模型与会话：按 WebGPU 支持情况选择设备与精度，
 *   WebGPU 初始化失败（驱动/上下文丢失等）时自动回退 WASM fp32
 */
async function loadSession(
  onStatus: (text: string) => void,
): Promise<MattingSession> {
  if (cachedSession) return cachedSession;
  const mod = await loadTransformers();
  const supportsWebGPU =
    typeof navigator !== "undefined" && "gpu" in navigator;
  const device: Device = supportsWebGPU ? "webgpu" : "wasm";

  const build = async (dev: Device) => ({
    model: await mod.AutoModel.from_pretrained(MODEL_ID, {
      device: dev,
      dtype: dev === "webgpu" ? "fp16" : "fp32",
    }),
    processor: await mod.AutoProcessor.from_pretrained(MODEL_ID),
  });

  onStatus(
    supportsWebGPU
      ? "正在加载模型（WebGPU / fp16，首次约 94MB）…"
      : "正在加载模型（WASM / fp32，首次约 190MB，较慢）…",
  );
  try {
    const { model, processor } = await build(device);
    cachedSession = { mod, model, processor, device };
  } catch (err) {
    if (device !== "webgpu") throw err;
    console.warn("[matting] WebGPU 初始化失败，回退到 WASM:", err);
    onStatus("WebGPU 初始化失败，回退到 WASM（fp32）…");
    const { model, processor } = await build("wasm");
    cachedSession = { mod, model, processor, device: "wasm" };
  }
  return cachedSession;
}

/**
 * @description 从模型输出 logits 中健壮地提取张量：依次尝试常见键名，
 *   最后扫描对象值，兼容 transformers.js 不同版本/模型的输出结构
 */
function pickTensor(
  output: Record<string, unknown>,
): { data: Float32Array; dims: number[] } | null {
  const candidates = [
    output.logits,
    output.output_image,
    output.output,
    ...Object.values(output),
  ];
  for (const value of candidates) {
    if (
      value &&
      typeof value === "object" &&
      "data" in value &&
      "dims" in value &&
      typeof (value as { dims: unknown }).dims !== "undefined"
    ) {
      const tensor = value as { data: Float32Array; dims: number[] };
      if (tensor.data) return tensor;
    }
  }
  return null;
}

/**
 * @description logits → alpha 掩膜 PNG：sigmoid 后写入灰度图的 alpha 通道，
 *   再放大到目标尺寸（双线性插值平滑边缘）
 */
async function logitsToAlphaBlob(
  logits: { data: Float32Array; dims: number[] },
  targetWidth: number,
  targetHeight: number,
): Promise<Blob> {
  const dims = logits.dims;
  const modelH = dims[dims.length - 2];
  const modelW = dims[dims.length - 1];

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = modelW;
  maskCanvas.height = modelH;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("无法创建掩膜画布上下文");
  const maskData = maskCtx.createImageData(modelW, modelH);
  for (let i = 0; i < logits.data.length; i++) {
    const val = 1 / (1 + Math.exp(-logits.data[i]));
    maskData.data[i * 4] = 255;
    maskData.data[i * 4 + 1] = 255;
    maskData.data[i * 4 + 2] = 255;
    maskData.data[i * 4 + 3] = Math.round(val * 255);
  }
  maskCtx.putImageData(maskData, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.drawImage(maskCanvas, 0, 0, targetWidth, targetHeight);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (item) => (item ? resolve(item) : reject(new Error("掩膜编码失败"))),
      "image/png",
    );
  });
}

/**
 * @description 原图与 alpha 掩膜合成透明 PNG：先画原图，
 *   再以 destination-in 混合模式应用掩膜（保留原图色彩，只在主体区域留像素）
 */
async function compositeWithOriginal(
  originalFile: File,
  alphaBlob: Blob,
): Promise<Blob> {
  const originalBitmap = await createImageBitmap(originalFile);
  const alphaBitmap = await createImageBitmap(alphaBlob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = originalBitmap.width;
    canvas.height = originalBitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    ctx.drawImage(originalBitmap, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(alphaBitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (item) => (item ? resolve(item) : reject(new Error("结果编码失败"))),
        "image/png",
      );
    });
  } finally {
    originalBitmap.close();
    alphaBitmap.close();
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
  const [statusText, setStatusText] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  /** @description 接收图片：本地预览 + 校验类型与大小，全程不经过网络传输 */
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
      const session = await loadSession(setStatusText);
      setDevice(session.device);
      setStatusText("正在推理…");

      const image = await session.mod.RawImage.fromBlob(file);
      const { pixel_values } = await session.processor(image);
      const output = (await session.model({
        input_image: pixel_values,
      })) as Record<string, unknown>;

      const logits = pickTensor(output);
      if (!logits) {
        console.error("模型原始输出:", output);
        throw new Error("无法从模型输出中找到有效的张量，请检查控制台日志");
      }

      const alphaBlob = await logitsToAlphaBlob(
        logits,
        image.width,
        image.height,
      );
      const resultBlob = await compositeWithOriginal(file, alphaBlob);

      const bitmap = await createImageBitmap(resultBlob);
      const { width, height } = bitmap;
      bitmap.close();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(resultBlob);
      resultUrlRef.current = url;
      setResult({ url, width, height });
      setStatusText(null);
    } catch (err) {
      console.error("[matting] 处理失败:", err);
      setErrorText(
        err instanceof Error ? err.message : "抠图失败，请稍后重试",
      );
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
        {/* 标题 / 设备状态 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">在线抠图</span>
            <span className="text-xs text-(--ant-color-text-tertiary)">
              推理由 BiRefNet-lite-512 在浏览器内完成，图片不会上传；模型
              fp16 约 94MB，首次使用需下载，之后由浏览器缓存
            </span>
          </div>
          <Space wrap>
            <Tooltip
              title={
                device
                  ? device === "webgpu"
                    ? "当前使用 WebGPU 加速推理（fp16）"
                    : "当前使用 WASM 推理（fp32），速度较慢"
                  : "推理在本地浏览器完成，无需服务端"
              }
            >
              <Tag icon={<LaptopOutlined />} color="geekblue">
                BiRefNet-lite-512 · 纯前端
              </Tag>
            </Tooltip>
            {device && (
              <Tag color={device === "webgpu" ? "green" : "orange"}>
                {device === "webgpu" ? "WebGPU · fp16" : "WASM · fp32"}
              </Tag>
            )}
          </Space>
        </div>

        {/* 使用说明 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--ant-color-border) px-4 py-3">
          <span className="text-sm">
            通用主体抠图
            <span className="ml-2 text-xs text-(--ant-color-text-tertiary)">
              人像、商品、动物等任意主体，输出与原图同尺寸的透明 PNG
            </span>
          </span>
          <Tag color="processing">无用量限制 · 图片本地处理不上传</Tag>
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
              支持 JPG / PNG / WebP，单张不超过 30MB，原图全尺寸本地推理
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
                  抠图结果（透明 PNG，{result ? `${result.width}×${result.height}` : "原图尺寸"}
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
                      {statusText ?? "正在抠图，请稍候…"}
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

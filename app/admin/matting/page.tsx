"use client";

import MattingWorkspace from "./MattingWorkspace";

/**
 * @description 后台在线抠图页：纯前端方案，推理由 BiRefNet-lite-512
 *   （transformers.js）在浏览器内完成，图片不上传，交互见 MattingWorkspace
 */
export default function AdminMattingPage() {
  return <MattingWorkspace />;
}

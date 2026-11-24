"use client";

import MattingWorkspace from "./MattingWorkspace";

/**
 * @description 后台在线抠图页：推理由 Cloudflare Workers AI（bria/remove-background）
 *   经本项目 /api/admin/matting 转发层在服务端完成，交互见 MattingWorkspace
 */
export default function AdminMattingPage() {
  return <MattingWorkspace />;
}

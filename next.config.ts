import type { NextConfig } from "next";
// 本地 next dev 时通过 getPlatformProxy 桥接 wrangler.jsonc 的绑定（如 AI），
// 使 getCloudflareContext() 在开发环境也能拿到与线上一致的绑定；仅构建期执行。
// 注意：Windows 下 workerd 可能因 VC++ Redistributable 过旧而崩溃，
// 崩溃不影响站点其他功能，仅本地拿不到绑定（抠图接口会返回 503 降级提示）
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  /* config options here */
  // cacheComponents 的运行时依赖 setTimeout 语义，在 Cloudflare Workers (workerd) 上会崩溃/挂起，故关闭
  cacheComponents: false,
};

export default nextConfig;

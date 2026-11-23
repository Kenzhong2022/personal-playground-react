import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * 增量缓存改用 Workers 静态资产：默认 dummy 缓存下，预渲染页面每次请求都回源
 * SSR，免费版 10ms CPU 上限必然超限（Worker exceeded CPU time limit）。
 * 全站页面均为构建期预渲染 + 客户端拉数据（无 ISR / revalidate），
 * 静态资产缓存把预渲染 HTML / RSC 直接从 ASSETS 提供，请求不再触发 SSR。
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});

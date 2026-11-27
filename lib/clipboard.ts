/**
 * @description 剪贴板复制统一入口（客户端专用）。
 *   优先 Clipboard API；不可用时（非 HTTPS / 旧浏览器 / 权限受限）
 *   降级为隐藏 textarea + document.execCommand("copy")。
 *   各页面拿到返回值后自行用 message / toast 提示结果。
 */

/** @description 复制文本到剪贴板，返回是否成功（空文本直接返回失败） */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

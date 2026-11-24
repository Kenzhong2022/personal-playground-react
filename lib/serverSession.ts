import { cookies } from "next/headers";
import { callPython } from "./pythonApi";

/**
 * 服务端登录态：登录成功后 Python 端签发的 HttpOnly 会话 Cookie（cb_token，JWT），
 * 这里把请求 Cookie 原样转发给 Python 端 /api/auth/me 验签后取得用户。
 * 仅作 UI 与首屏渲染使用，鉴权仍以 Python 端 API 为准。
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * @description 在服务端组件（根布局）中读取当前登录用户：
 *              SSR 首屏即可渲染真实用户信息，无水合不一致与闪烁。
 *              未登录 / Cookie 过期 / Python 不可用均返回 null，由调用方兜底
 */
export async function getServerUser(): Promise<SessionUser | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;
  const { ok, body } = await callPython("/api/auth/me", {
    headers: { cookie },
  });
  if (!ok) return null;
  const user = (body as { user?: SessionUser } | null)?.user;
  return user?.id ? user : null;
}

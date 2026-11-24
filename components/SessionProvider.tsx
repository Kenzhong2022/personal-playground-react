"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/serverSession";

const SessionContext = createContext<SessionUser | null>(null);

/**
 * @description 登录态下发：根布局（服务端）在请求阶段读 Cookie 验签取得用户，
 *              经 Context 传给客户端组件——SSR 首屏即真实用户，无需客户端再读。
 *              注意：根布局在客户端路由跳转间不会重新执行，因此登录 / 退出
 *              必须走整页跳转（window.location），否则 Context 里的用户会过期
 */
export default function SessionProvider({
  user,
  children,
}: {
  user: SessionUser | null;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}

/** @description 读取服务端下发的当前登录用户（未登录为 null） */
export function useSessionUser(): SessionUser | null {
  return useContext(SessionContext);
}

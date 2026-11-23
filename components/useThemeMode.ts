"use client";

import { useCallback, useEffect, useState, startTransition } from "react";

/** 主题模式：亮色 / 暗色 / 跟随系统 */
export type ThemeMode = "light" | "dark" | "system";

const KEY = "cb_theme";
const EVENT = "cb-theme-change";
const DARK_MQ = "(prefers-color-scheme: dark)";
// 主题镜像 cookie：cb_theme 存原始模式（供 SSR 下拉选中态），cb_theme_dark 存
// 解析结果（0/1，供服务端渲染 antd token）；由下方 effect 在每次主题变化时同步
const THEME_COOKIE = "cb_theme";
const THEME_DARK_COOKIE = "cb_theme_dark";
const COOKIE_TTL = "; path=/; max-age=31536000; samesite=lax";

/** @description 把当前模式与解析结果镜像到 cookie，供服务端组件下次请求读取 */
function writeThemeCookies(mode: ThemeMode, dark: boolean): void {
  document.cookie = `${THEME_DARK_COOKIE}=${dark ? 1 : 0}${COOKIE_TTL}`;
  document.cookie = `${THEME_COOKIE}=${mode}${COOKIE_TTL}`;
}

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function setThemeMode(mode: ThemeMode): void {
  window.localStorage.setItem(KEY, mode);
  // 同页其他 hook 实例（跨标签页用 storage 事件即可，不另处理）
  window.dispatchEvent(new Event(EVENT));
}

/** 该模式当前是否应渲染暗色 */
function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia(DARK_MQ).matches;
}

/**
 * 主题模式 hook：返回当前模式、解析出的暗色状态与切换函数。
 * 同时把结果同步到 <html> 的类上，驱动 globals.css 的 CSS 变量：
 * - 强制暗色：html.dark
 * - 强制亮色：html.cb-light（用于在系统暗色时锁定亮色）
 * - 跟随系统：两个类都不加，走 prefers-color-scheme 媒体查询
 */
export function useThemeMode(initial?: { mode: ThemeMode; dark: boolean }) {
  // 初始值来自服务端读取的主题 cookie（根布局传入）：SSR 与客户端首帧一致，
  // 避免挂载后从亮色翻转到暗色的整页闪变；首次访问无 cookie 时按亮色起步
  const [mode, setModeState] = useState<ThemeMode>(initial?.mode ?? "system");
  const [dark, setDark] = useState(initial?.dark ?? false);

  const refresh = useCallback(() => {
    const m = getThemeMode();
    // 用 transition 标记主题切换：流式 SSR 下该 effect 可能在部分 Suspense
    // 边界（如 useSearchParams 包裹的内容）完成水合之前触发，若用默认紧急
    // 更新，React 会带着暗色 token 去水合服务端渲染的亮色 HTML，产生
    // hydration mismatch。transition 保证 React 先完成水合，再应用主题。
    startTransition(() => {
      setModeState(m);
      setDark(resolveDark(m));
    });
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    const mq = window.matchMedia(DARK_MQ);
    mq.addEventListener("change", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      mq.removeEventListener("change", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark" || (mode === "system" && dark));
    root.classList.toggle("cb-light", mode === "light");
    // 同步镜像 cookie：下次请求服务端即可按当前主题渲染，消除刷新闪变
    writeThemeCookies(mode, dark);
  }, [mode, dark]);

  const setMode = useCallback((m: ThemeMode) => setThemeMode(m), []);

  return { mode, dark, setMode };
}

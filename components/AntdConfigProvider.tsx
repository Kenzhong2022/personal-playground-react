"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { App, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import AntdAppBridge from "./AntdAppBridge";
import { useThemeMode, type ThemeMode } from "./useThemeMode";

dayjs.locale("zh-cn");

export default function AntdConfigProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  /** 服务端从主题 cookie 解析出的初始值：保证 SSR 渲染的 antd token 与用户当前主题一致 */
  initialTheme?: { mode: ThemeMode; dark: boolean };
}) {
  const { dark } = useThemeMode(initialTheme);
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;

  // 与 colorLink 共用同一份算法 token；useMemo 避免每次 render 重复计算
  const baseToken = useMemo(
    () => theme.getDesignToken({ algorithm }),
    [algorithm],
  );

  return (
    <>
      {/* 全局滚动条：颜色取自当前算法 token，亮/暗自动跟随 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            * {
              scrollbar-width: thin; /* Firefox */
              scrollbar-color: ${baseToken.colorFillSecondary} ${baseToken.colorFillQuaternary};
            }
            ::-webkit-scrollbar {
              width: 8px;
              height: 8px;
            }
            ::-webkit-scrollbar-track {
              background: ${baseToken.colorFillQuaternary};
            }
            ::-webkit-scrollbar-thumb {
              background: ${baseToken.colorFillSecondary};
              border-radius: 4px;
            }
            ::-webkit-scrollbar-thumb:hover {
              background: ${baseToken.colorFill};
            }
            ::-webkit-scrollbar-corner {
              background: ${baseToken.colorFillQuaternary};
            }
          `,
        }}
      />
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm,
          token: {
            colorLink: baseToken.colorBgTextActive,
            colorLinkHover: baseToken.colorBgTextActive,
          },
          components: {
            Layout: {
              headerHeight: 64,
            },
          },
        }}
      >
        {/* 根级 App：全站任何组件都能 App.useApp()，message 弹层跟随主题 */}
        <App>
          <AntdAppBridge />
          {children}
        </App>
      </ConfigProvider>
    </>
  );
}

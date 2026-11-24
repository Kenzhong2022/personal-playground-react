"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Layout, Menu, theme } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { canLeavePage } from "@/lib/leave-guard";
import { flattenNavChildren, type NavChild } from "./navConfig";
import { useSessionUser } from "./SessionProvider";

type SideItem = NavChild;

// 侧边栏：渲染传入的二级菜单树（叶子为路由项，带 children 的项渲染为可展开的子菜单）；
// 收缩状态由顶部传入
export default function SideNav({
  groupKey,
  items,
  collapsed,
}: {
  groupKey: string;
  items: SideItem[];
  collapsed: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // 选中匹配以叶子为准、取最长前缀命中（如 /admin/problems/detail 归入
  // /admin/problems 而非 /admin）；匹配不上时不高亮任何项
  const leaves = flattenNavChildren(items);
  const selectedKey = leaves
    .filter((item) => pathname.startsWith(item.key))
    .sort((a, b) => b.key.length - a.key.length)[0]?.key;
  // 深链进入子菜单时自动展开对应父项（如直接访问分组内页）
  const [openKeys, setOpenKeys] = useState<string[]>(() =>
    items
      .filter((item) => item.children?.length && pathname.startsWith(item.key))
      .map((item) => item.key),
  );
  // 站内导航进入新的子菜单范围时追加展开，已手动折叠的不强开
  useEffect(() => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (item.children?.length && pathname.startsWith(item.key)) {
          next.add(item.key);
        }
      }
      return [...next];
    });
  }, [pathname, items]);
  // 登录态由根布局服务端验签后经 Context 下发，SSR 首屏即真实用户
  const user = useSessionUser();
  const { token } = theme.useToken();

  return (
    <Layout.Sider
      theme="light"
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={200}
    >
      <div style={{ height: "100vh" }}>
        {/* 侧边栏顶部占位条：与顶栏同高，底部分割线对齐 TopNav 的底边 */}
        <div
          style={{
            height: 64,
            borderRight: `${0.1}px ${token.lineType} ${token.colorBorder}`,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            overflow: "hidden",
          }}
        >
          {/* 用户注册邮箱 */}
          <span
            style={{
              marginLeft: 8,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {user?.email ?? "用户"}
          </span>
        </div>
        <Menu
          // key 变化时重建菜单，避免上一组菜单的选中态与展开态残留
          key={groupKey}
          theme="light"
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={(keys) => setOpenKeys([...keys])}
          items={items}
          onClick={({ key }) => {
            // 叶子 key 均为路由路径；分组父项点击只展开/收起，不跳转
            if (!key.startsWith("/")) return;
            // 当前页注册了离开守卫（如通话房间）时先确认再跳转
            void canLeavePage().then((ok) => {
              if (ok) router.push(key);
            });
          }}
        />
      </div>
    </Layout.Sider>
  );
}

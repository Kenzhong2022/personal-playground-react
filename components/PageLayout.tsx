"use client";

import { Suspense, useState } from "react";
import type { ReactNode } from "react";
import { Layout, Card, theme } from "antd";
import { usePathname } from "next/navigation";
import TopNav from "./TopNav";
import SideNav from "./SideNav";
import { getActiveGroup } from "./navConfig";

const { Content } = Layout;

/**
 * @description 页面骨架：外层左右布局（侧边栏 | 右侧），右侧上下布局（顶栏 / 核心内容 / 页脚）。
 *              标题区不在骨架内实现——需要页头（标题 / 返回按钮）的页面自行组合
 *              PageHeader 等组件传入 header 插槽
 * @param header 页头插槽（可选）：渲染在内容区上方、高度由内容决定，不参与内容区滚动
 * @param contentClassName 内容区包裹层 className（可选）：内容区为 flex 列布局、
 *              包裹层自动 flex:1 占满 header 以下的剩余高度，可用 h-full / overflow-* 控制子内容
 * @param card 是否用白卡包裹内容（默认 true，layout-fill-card 占满高度）；
 *              页面自行组合卡片的（如预览页、拼装多卡片的仪表盘）传 false 退出
 */
export default function PageLayout({
  header,
  children,
  contentClassName,
  card = true,
}: {
  header?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  card?: boolean;
}) {
  const pathname = usePathname();
  const activeGroup = getActiveGroup(pathname);
  // 收缩状态放在最外层，顶部按钮控制、侧边栏消费
  const [collapsed, setCollapsed] = useState(false);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  return (
    // App 上下文已提升到根级 AntdConfigProvider，这里不再重复包 <App>
    <Layout style={{ minHeight: "100vh" }}>
      <Suspense fallback={<Layout.Sider width={200} theme="light" />}>
        <SideNav
          groupKey={activeGroup.key}
          items={activeGroup.children}
          collapsed={collapsed}
        />
      </Suspense>

      {/* 右侧：上下布局（顶栏 / 内容区） */}
      <Layout style={{ maxHeight: "calc(100vh)" }}>
        {/* TopNav 内含使用导航路由的组件，保留 Suspense 边界；fallback 用同尺寸 Header 防止布局跳动 */}
        <Suspense
          fallback={<Layout.Header style={{ background: colorBgContainer }} />}
        >
          <TopNav
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
          />
        </Suspense>

        <Content
          style={{
            margin: 24,
            flex: 1,
            overflow: "auto",
            // flex 列布局：标题区固定，包裹层 flex:1 占满剩余高度，供子页面 h-full 填充
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 页头插槽：内容由页面自行组合（PageHeader / 自定义节点），高度随内容收缩 */}
          {header && <div className="shrink-0 self-start">{header}</div>}
          <div className={`flex-1 ${contentClassName}`}>
            {/* 默认白卡包裹（layout-fill-card 占满高度，规则见 globals.css）；
                card=false 时原样渲染 children，页面自行决定容器 */}
            {card ? (
              <Card className="layout-fill-card">{children}</Card>
            ) : (
              children
            )}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

"use client";

// 无法服务端化：usePathname（菜单分组 / 高亮需要客户端路径）、collapsed 共享状态、
// antd 交互组件（Menu / Sider / TopNav 弹层）三者都要求运行在浏览器。
// 服务端化收益已由数据层（页面级 RSC 取数）与登录分支（proxy 验签）承担。
import { useState } from "react";
import type { ReactNode } from "react";
import { Layout, Card } from "antd";
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
 * @param wrapInCard 是否用白卡包裹内容（默认 true，layout-fill-card 占满高度）；
 *              页面自行组合卡片的（如预览页、拼装多卡片的仪表盘）传 false 退出
 */
export default function PageLayout({
  header,
  children,
  contentClassName,
  wrapInCard = true,
}: {
  header?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  wrapInCard?: boolean;
}) {
  const pathname = usePathname();
  const activeGroup = getActiveGroup(pathname);
  // 收缩状态放在最外层，顶部按钮控制、侧边栏消费
  const [collapsed, setCollapsed] = useState(false);

  return (
    // App 上下文已提升到根级 AntdConfigProvider，这里不再重复包 <App>
    <Layout style={{ minHeight: "100vh" }}>
      <SideNav
        groupKey={activeGroup.key}
        items={activeGroup.children}
        collapsed={collapsed}
      />

      {/* 右侧：上下布局（顶栏 / 内容区）。渲染全同步、无悬挂点，整树一次性 flush，
          不需要 Suspense 边界（实测加了也不会出现 fallback） */}
      <Layout style={{ maxHeight: "calc(100vh)" }}>
        <TopNav
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />

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
                wrapInCard=false 时原样渲染 children，页面自行决定容器 */}
            {wrapInCard ? (
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

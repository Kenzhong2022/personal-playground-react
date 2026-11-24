import PageLayout from "@/components/PageLayout";
import HomeContainer from "./HomeContainer";
import type { ProblemListItem } from "./RecentProblemsCard";
import { callPython } from "@/lib/pythonApi";

// CodeAgent 首页：总览与快捷入口（原 ?tab=home，统一迁移为子路由）
//
// 题库总数与最近题目在服务端预取（均为免鉴权只读接口），随 React Server
// Components（RSC）payload 下发、首屏 0 请求；提交记录依赖登录会话与刷新交互，
// 仍由 HomeContainer 在客户端拉取。服务端取数失败时对应 prop 为 undefined，
// HomeContainer 自动回退为客户端自取（重试按钮也走客户端刷新）
export default async function CodeAgentHomePage() {
  const [totalRes, recentRes] = await Promise.all([
    callPython("/api/problems?count_only=1"),
    callPython("/api/problems/cursor?limit=6"),
  ]);
  const count = totalRes.ok
    ? (totalRes.body as { count?: number } | null)?.count
    : undefined;
  const items = recentRes.ok
    ? (recentRes.body as { items?: ProblemListItem[] } | null)?.items
    : undefined;

  return (
    <PageLayout>
      <HomeContainer
        initialTotal={typeof count === "number" ? count : undefined}
        initialRecent={Array.isArray(items) ? items : undefined}
      />
    </PageLayout>
  );
}

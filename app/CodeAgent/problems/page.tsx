import PageLayout from "@/components/PageLayout";
import ProblemList, { type ProblemPage } from "@/components/ProblemList";
import { callPython } from "@/lib/pythonApi";

// CodeAgent 练习入口：题库列表（原 ?tab=problems，统一迁移为子路由）
//
// React Server Components（RSC）首屏取数示范：首页数据在服务端直接向 Python 服务端获取（/api/problems/cursor
// 为免鉴权只读接口），随 RSC payload 下发，客户端首屏 0 请求；
// 翻页 / 切换数据集 / 增删改后的刷新仍由 ProblemList 在客户端发起。
// 服务端取数失败时 initialPage 为 undefined，ProblemList 自动回退为客户端自取。
export default async function CodeAgentProblemsPage() {
  const { ok, body } = await callPython("/api/problems/cursor?limit=20");
  const initialPage = ok ? (body as ProblemPage) : undefined;

  return (
    <PageLayout>
      <ProblemList initialPage={initialPage} />
    </PageLayout>
  );
}

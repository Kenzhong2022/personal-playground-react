"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { Button, Space, Typography, theme } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { useSessionUser } from "@/components/SessionProvider";
import BannerCard from "./BannerCard";
import DifficultyEntriesCard from "./DifficultyEntriesCard";
import RecentProblemsCard, { type ProblemListItem } from "./RecentProblemsCard";
import SubmissionStatsCard, { type SubmissionRow } from "./SubmissionStatsCard";
import UserProfileCard from "./UserProfileCard";
import CheckInHeatmapCard from "./CheckInHeatmapCard";

/**
 * @description CodeAgent 首页容器：按左右布局渲染——
 *              左侧主内容（上 BannerCard 横幅，中部「统计卡片 / 最近题目 / 难度入口」），
 *              右侧用户信息与打卡热力图侧栏。
 *              题库总数与最近题目由页面级服务端组件预取传入（RSC，首屏 0 请求）；
 *              提交记录依赖登录会话，仍在客户端拉取
 */
export default function HomeContainer({
  initialTotal,
  initialRecent,
}: {
  /** 服务端预取的题库总数；undefined 表示服务端取数失败（统计卡显示占位） */
  initialTotal?: number;
  /** 服务端预取的最近题目列表；undefined 表示服务端取数失败，客户端 effect 自取 */
  initialRecent?: ProblemListItem[];
}) {
  const { token } = theme.useToken();
  const [recent, setRecent] = useState<ProblemListItem[] | null>(
    initialRecent ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // 登录态由根布局服务端验签后经 Context 下发，SSR 首屏即已就绪
  const sessionUser = useSessionUser();

  /** @description 打卡数据源：YYYY-MM-DD → 当天提交次数；null 表示未加载完成（热力图先用内置模拟兜底） */
  const [checkInValues, setCheckInValues] = useState<Record<
    string,
    number
  > | null>(null);

  /** @description submissions 全量行：打卡热力图与统计卡片共用同一次拉取 */
  const [submissionRows, setSubmissionRows] = useState<SubmissionRow[] | null>(
    null,
  );

  /** @description 题库总题目数量：由页面级服务端组件预取（count_only=1 精确计数），
   *  随 props 传入、首屏 0 请求；服务端取数失败时保持 null，统计卡显示占位 */
  const [problemTotal] = useState<number | null>(initialTotal ?? null);

  // 拉取当前登录用户的提交记录（mine=true 由 Python 端按会话 Cookie 过滤）：
  // 一份原始行同时供统计卡片与打卡热力图（按本地日期聚合提交次数）；
  // 未登录时不请求，直接置空——统计显示 0、热力图回退内置模拟占位
  useEffect(() => {
    let cancelled = false;
    if (!sessionUser) {
      setSubmissionRows([]);
      setCheckInValues({});
      return;
    }
    fetch("/api/submissions?mine=true", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "加载提交记录失败");
        return body as SubmissionRow[];
      })
      .then((typedRows) => {
        if (cancelled) return;
        setSubmissionRows(typedRows);
        const byDay: Record<string, number> = {};
        for (const row of typedRows) {
          const key = dayjs(row.created_at).format("YYYY-MM-DD");
          byDay[key] = (byDay[key] ?? 0) + 1;
        }
        setCheckInValues(byDay);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error("[checkin] 提交记录加载失败", err);
        setSubmissionRows([]);
        setCheckInValues({});
      });
    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  // 拉取最新一批题目：服务端已预取首屏（initialRecent）时跳过首轮，仅重试时执行
  useEffect(() => {
    if (reloadTick === 0 && initialRecent) return;
    let cancelled = false;
    setError(null);
    fetch("/api/problems/cursor?limit=6")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "加载题目失败");
        return body as { items: ProblemListItem[] };
      })
      .then((body) => {
        if (!cancelled) setRecent(body.items);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setRecent([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick, initialRecent]);

  return (
    /* 外层布局框架：左侧主内容占满剩余宽度，右侧预留侧栏 */
    <div className="flex gap-4 h-full overflow-hidden">
      {/* 左：主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-auto">
        {/* 上：欢迎横幅 */}
        <div className="flex-1">
          <BannerCard />
        </div>
        {/* 统计组件：总提交数量 / 总通过题目数量 / 提交通过率（数据复用 submissions 拉取） */}
        <SubmissionStatsCard
          rows={submissionRows}
          totalProblems={problemTotal ?? undefined}
        />
        {/* 中：行动号召文案 + 最近题目 + 难度入口（三栏布局） */}
        <div className="flex gap-4 flex-1">
          {/* 中右：最近题目（flex-1 占满剩余宽度，min-w-0 防止内容撑破容器） */}
          <div className="flex-1 min-w-0">
            <RecentProblemsCard
              recent={recent}
              error={error}
              onRetry={() => setReloadTick((t) => t + 1)}
            />
          </div>
          {/* 中右：最近题目（flex-1 占满剩余宽度，min-w-0 防止内容撑破容器） */}
          <div className="flex-1 min-w-0">
            <DifficultyEntriesCard />
          </div>
        </div>
      </div>
      {/* 右：侧栏，用户头部卡片在最上方，其后为打卡热力图与难度入口 */}
      <div className="w-[320px] shrink-0 flex flex-col gap-4 overflow-auto">
        <UserProfileCard />
        {/* 打卡热力图：数据来自 submissions 表；未加载完成时组件内部用模拟数据占位 */}
        <CheckInHeatmapCard values={checkInValues ?? undefined} />
      </div>
    </div>
  );
}

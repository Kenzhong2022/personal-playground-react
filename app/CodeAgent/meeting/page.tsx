"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import PageLayout from "@/components/PageLayout";

// UI Kit 基于 Web Components / WebRTC，必须在浏览器端加载，关闭 SSR
const MeetingRoom = dynamic(() => import("./MeetingRoom"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-(--ant-color-text-tertiary)">
      正在加载会议组件…
    </div>
  ),
});

/**
 * @description 1v1 视频 / 语音会议页：useSearchParams 必须在 Suspense 边界内的
 *              子组件中调用，否则预渲染阶段会 CSR bailout 导致构建失败；
 *              会议号由 MeetingRoom 写入地址栏以便分享
 */
function RoomFromQuery() {
  return <MeetingRoom roomCode={useSearchParams().get("room")} />;
}

export default function MeetingPage() {
  return (
    <PageLayout wrapInCard={false}>
      <div className="h-full min-h-0">
        <Suspense fallback={null}>
          <RoomFromQuery />
        </Suspense>
      </div>
    </PageLayout>
  );
}

"use client";

import { useCallback, useState } from "react";
import { App as AntApp, Button, Modal, Popconfirm, Tag } from "antd";
import { ShareAltOutlined } from "@ant-design/icons";
import { useRealtimeKitMeeting } from "@cloudflare/realtimekit-react";
import { RtkMeeting, useLanguage } from "@cloudflare/realtimekit-react-ui";
import { formatRoomCode } from "@/lib/room-code";
import { copyText } from "@/lib/clipboard";
import { zhCN } from "./zh-CN";

/**
 * @description 会议主体：顶部会议名称 / 会议号 / 房主操作 / 分享入口 + 官方 Meeting UI。
 *              语言切换、分享、关闭会议等业务内聚在组件里，关闭成功后回调编排层回入口
 */
export default function Room({
  roomCode,
  roomName,
  isHost,
  onClosed,
}: {
  roomCode: string | null;
  roomName: string;
  isHost: boolean;
  /** @description 房主关闭会议成功后通知编排层重置回入口 */
  onClosed: () => void;
}) {
  const { meeting } = useRealtimeKitMeeting();
  // 界面语言：默认中文，可切回官方英文；useLanguage 会把中文包覆盖到默认英文包上
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const t = useLanguage(lang === "zh" ? zhCN : undefined);
  const { message } = AntApp.useApp();
  const [shareOpen, setShareOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  // 分享内容仿照飞书会议邀请：主题 / 会议 ID / 会议链接
  const displayCode = roomCode ? formatRoomCode(roomCode) : "";
  const inviteUrl = roomCode
    ? `${window.location.origin}/CodeAgent/meeting?room=${roomCode}`
    : "";
  const inviteText = `邀请你加入视频通话

会议主题：${roomName || "视频通话"}
会议 ID：${displayCode}
会议链接：${inviteUrl}`;

  const copyInviteText = useCallback(async () => {
    if (await copyText(inviteText)) {
      message.success("邀请内容已复制，发给对方即可加入");
      setShareOpen(false);
    } else {
      message.error("复制失败，请手动选中复制");
    }
  }, [inviteText, message]);

  // 房主关闭会议：先让服务端置为 closed，避免其他人再拿 token，然后主动离开
  const closeRoom = useCallback(async () => {
    if (!roomCode) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/realtime/rooms/${roomCode}/close`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "关闭会议失败");
      await meeting.leave();
      message.success("会议已关闭");
      onClosed();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "关闭会议失败");
    } finally {
      setClosing(false);
    }
  }, [meeting, message, onClosed, roomCode]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-(--ant-color-border-secondary) bg-(--ant-color-bg-container) px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-(--ant-color-text-secondary)">
          <span className="truncate font-medium text-(--ant-color-text)">
            {roomName || "视频通话"}
          </span>
          <span className="shrink-0">
            会议号：<code className="text-(--ant-color-text)">{displayCode}</code>
          </span>
          {isHost && (
            <Tag color="gold" className="shrink-0">
              房主
            </Tag>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="small"
            onClick={() => setLang((prev) => (prev === "zh" ? "en" : "zh"))}
          >
            {lang === "zh" ? "English" : "中文"}
          </Button>
          <Button
            size="small"
            icon={<ShareAltOutlined />}
            onClick={() => setShareOpen(true)}
          >
            分享
          </Button>
          {isHost && (
            <Popconfirm
              title="关闭会议？"
              description="关闭后其他人将无法再加入"
              okText="关闭会议"
              cancelText="取消"
              onConfirm={closeRoom}
            >
              <Button size="small" danger loading={closing}>
                关闭会议
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-(--ant-color-bg-layout)">
        {/* 加入动作已在自绘面板完成，这里不再展示官方 setup screen */}
        <RtkMeeting
          meeting={meeting}
          mode="fill"
          showSetupScreen={false}
          t={t}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      <Modal
        open={shareOpen}
        title="分享通话邀请"
        okText="复制邀请内容"
        cancelText="关闭"
        onOk={copyInviteText}
        onCancel={() => setShareOpen(false)}
      >
        <div className="whitespace-pre-wrap break-all rounded-lg border border-(--ant-color-border-secondary) bg-(--ant-color-bg-layout) p-3 text-xs leading-6 text-(--ant-color-text)">
          {inviteText}
        </div>
      </Modal>
    </div>
  );
}

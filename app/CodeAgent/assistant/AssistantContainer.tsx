"use client";

import { useRef, useState } from "react";
import { App } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { copyText } from "@/lib/clipboard";
import ChatContent from "./components/ChatContent";
import ChatInput, {
  DEFAULT_MODEL_CONFIG,
  type ChatModelConfig,
} from "./components/ChatInput";
import type {
  ChatBubbleAction,
  ChatMessageData,
} from "./components/ChatBubbleCard";
import type { ChatRequest } from "./chatApi";

// 首次进入的演示消息：同时展示用户与助手两种气泡形态
const INITIAL_MESSAGES: ChatMessageData[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "你好，我是 CodeAgent 智能助手。\n可以帮你分析题目思路、解释代码或给出优化建议。",
  },
  {
    id: "demo-question",
    role: "user",
    content: "两数之和有哪些常见解法？",
  },
  {
    id: "demo-answer",
    role: "assistant",
    content:
      "暴力枚举是 O(n²)；用哈希表把查找降到 O(1)，整体 O(n)。\n遍历时先查 target - nums[i] 是否已出现，再把当前值存入表中。",
  },
];

/**
 * @description 智能助手容器：维护消息列表，内容区独立滚动，输入框固定在内容区底部；
 *              气泡底部操作按钮在此按消息生成（当前为复制，可按需扩展）
 */
export default function AssistantContainer() {
  const { message: toast } = App.useApp();
  const [messages, setMessages] = useState<ChatMessageData[]>(INITIAL_MESSAGES);
  // 模型配置：功能开关 + 选中模型，发送请求时随消息一并交给后端
  const [modelConfig, setModelConfig] =
    useState<ChatModelConfig>(DEFAULT_MODEL_CONFIG);
  // 本地消息自增序号，避免用时间戳做 key
  const nextIdRef = useRef(0);
  // 会话 ID：首次发送时生成（事件回调仅在客户端执行，避免 SSR 水合不一致），整个会话复用
  const sessionIdRef = useRef<string | null>(null);

  /** @description 复制消息正文到剪贴板 */
  async function copyMessage(text: string) {
    if (await copyText(text)) toast.success("已复制");
    else toast.error("复制失败，请手动选择文本");
  }

  /** @description 每条气泡的底部按钮：当前只有复制 */
  function actionsOf(message: ChatMessageData): ChatBubbleAction[] {
    return [
      {
        key: "copy",
        title: "复制",
        icon: <CopyOutlined />,
        onClick: () => void copyMessage(message.content),
      },
    ];
  }

  /** @description 发送消息：追加用户气泡并按契约组装 ChatRequest（服务端暂未实现，先在控制台输出验证） */
  function handleSend(text: string) {
    nextIdRef.current += 1;
    const messageId = `local-${nextIdRef.current}`;
    setMessages((prev) => [
      ...prev,
      { id: messageId, role: "user", content: text },
    ]);

    // 组装请求体：会话 ID 首次生成；父消息取当前列表最后一条（会话首条为 null）；
    // ref_file_ids / preempt 对应的功能未实现，暂不携带
    if (!sessionIdRef.current) {
      sessionIdRef.current = crypto.randomUUID();
    }
    const request: ChatRequest = {
      chat_session_id: sessionIdRef.current,
      parent_message_id:
        messages.length > 0 ? messages[messages.length - 1].id : null,
      prompt: text,
      model_type: modelConfig.model,
      search_enabled: modelConfig.webSearch,
      thinking_enabled: modelConfig.deepThink,
    };
    // TODO: 服务端就绪后改为 fetch / SSE 流式请求
    console.log("[assistant] ChatRequest", request);
  }

  return (
    // 白卡外壳由 PageLayout 默认提供（wrapInCard=true），这里只管内部布局
    <div className="flex flex-col h-full">
      {/* 消息区：min-h-0 + flex-1 保证内部滚动而不撑开外层 */}
      <div className="min-h-0 flex-1">
        <ChatContent messages={messages} actionsOf={actionsOf} />
      </div>
      {/* 输入区：固定在内容区底部，不随消息滚动 */}
      <div className="pb-4">
        <ChatInput
          config={modelConfig}
          onConfigChange={setModelConfig}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}

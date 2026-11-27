import type { ReactNode } from "react";
import {
  ApiOutlined,
  AppstoreOutlined,
  BgColorsOutlined,
  BookOutlined,
  CodeOutlined,
  DeepSeekFilled,
  DashboardOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
  ScissorOutlined,
  SettingOutlined,
  TeamOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";

export type NavGroup = {
  key: string;
  label: string;
  icon?: ReactNode;
  // 二级菜单项，key 即目标路由；支持再嵌套 children 形成三级菜单（父项为分组，
  // 自身不可跳转，点击展开子级），description 用于顶部导航弹出面板
  children: NavChild[];
};

export type NavChild = {
  key: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  children?: NavChild[];
};

/**
 * @description 展开菜单树的所有叶子节点（跳过带 children 的分组层）：
 *              侧边栏选中匹配、顶部弹出面板平铺展示都以叶子为准
 */
export function flattenNavChildren(children: NavChild[]): NavChild[] {
  return children.flatMap((child) =>
    child.children?.length
      ? flattenNavChildren(child.children)
      : [child],
  );
}

/**
 * 一级导航配置
 *
 * 约定：二级菜单统一使用真实子路由（如 /CodeAgent/problems、/admin/users），
 * 不再用 ?tab= 查询参数——子路由支持嵌套深链（/admin/users/[id]）、
 * 按路由分包与 middleware 前缀守卫；各模块根路径（/problems 等）重定向到默认子页
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "/colors",
    label: "色系",
    icon: <BgColorsOutlined />,
    children: [
      {
        // 子项 key 不能与分组 key 相同：antd Menu 内部按 key 建扁平映射，重复会互相覆盖
        key: "/colors/preview",
        label: "色系预览",
        description: "antd 主题颜色 token 预览",
        icon: <BgColorsOutlined />,
      },
    ],
  },
  {
    key: "/css-vars",
    label: "CSS 变量",
    icon: <ApiOutlined />,
    children: [
      {
        key: "/css-vars/preview",
        label: "CSS 变量",
        description: "antd 生成的 --ant-* CSS 变量浏览器",
        icon: <ApiOutlined />,
      },
    ],
  },
  {
    key: "/CodeAgent",
    label: "CodeAgent",
    icon: <AppstoreOutlined />,
    children: [
      {
        key: "/CodeAgent/home",
        label: "首页",
        description: "CodeAgent 总览与快捷入口",
        icon: <AppstoreOutlined />,
      },
      {
        key: "/CodeAgent/problems",
        label: "题库",
        description: "选择题目进入在线练习",
        icon: <CodeOutlined />,
      },
      {
        key: "/CodeAgent/assistant",
        label: "智能助手",
        description: "获取代码提示与建议",
        icon: <DeepSeekFilled />,
      },
      {
        key: "/CodeAgent/playground",
        label: "快速执行",
        description: "临时执行简单代码脚本（多语言沙箱）",
        icon: <PlayCircleOutlined />,
      },
      {
        key: "/CodeAgent/meeting",
        label: "视频通话",
        description: "创建 1v1 视频 / 语音通话会议并邀请对方",
        icon: <VideoCameraOutlined />,
      },
    ],
  },
  {
    key: "/admin",
    label: "后台管理中心",
    icon: <SettingOutlined />,
    children: [
      {
        key: "/admin/dashboard",
        label: "仪表盘",
        description: "后台运营数据总览（规划中）",
        icon: <DashboardOutlined />,
      },
      {
        key: "/admin/problems",
        label: "题目管理",
        description: "题库浏览与增删改查，按数据集筛选",
        icon: <BookOutlined />,
      },
      {
        key: "/admin/users",
        label: "用户管理",
        description: "账号信息管理（规划中）",
        icon: <TeamOutlined />,
      },
      {
        key: "/admin/roles",
        label: "角色管理",
        description: "角色与权限管理（规划中）",
        icon: <SafetyOutlined />,
      },
      {
        key: "/admin/submissions",
        label: "提交管理",
        description: "所有用户的提交记录查看与维护",
        icon: <BookOutlined />,
      },
      {
        key: "/admin/presets",
        label: "通话预设",
        description: "RealtimeKit 预设与权限管理（会中角色能力配置）",
        icon: <ApiOutlined />,
      },
      {
        key: "/admin/media",
        label: "媒体管理",
        description: "Supabase Storage 媒体资源增删改查（图片 / 视频 / 音频）",
        icon: <PictureOutlined />,
      },
      {
        key: "/admin/feishu-docs",
        label: "飞书文档管理",
        description: "输入知识库 wiki 链接拉取自身及子文档列表",
        icon: <FileTextOutlined />,
      },
      {
        key: "/admin/matting",
        label: "在线抠图",
        description: "在线图片抠图（Workers AI · bria/remove-background）",
        icon: <ScissorOutlined />,
      },
    ],
  },
];

// 按当前路径找到所属的一级导航：优先匹配分组 key，其次匹配任意二级子项 key
// （如 /problems/list 归属 /admin 分组，路径前缀与分组 key 不同）；
// 找不到时默认第一个
export function getActiveGroup(pathname: string): NavGroup {
  return (
    NAV_GROUPS.find(
      (group) =>
        pathname.startsWith(group.key) ||
        group.children.some((child) => pathname.startsWith(child.key)),
    ) ?? NAV_GROUPS[0]
  );
}

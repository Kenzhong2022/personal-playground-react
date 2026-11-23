"use client";

import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Typography } from "antd";
import dayjs from "dayjs";
import PageLayout from "@/components/PageLayout";
import CrudManager from "@/components/CrudManager";
import type { CrudField } from "@/components/CrudManager";

/**
 * 用户行：与 Python 端 /api/users 返回列一致。
 * 用 type 而非 interface：类型别名可隐式获得索引签名，直接兼容 CrudManager 的行类型
 */
type AdminUser = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  last_login_at: string | null;
  created_at: string;
};

// 表格/表单字段配置：初始密码创建时必填，编辑时留空表示不修改
const USER_FIELDS: CrudField[] = [
  {
    name: "name",
    label: "用户名",
    required: true,
    placeholder: "登录展示名",
    render: (value) => (
      <Typography.Text strong>{String(value ?? "")}</Typography.Text>
    ),
  },
  {
    name: "email",
    label: "邮箱",
    required: true,
    requiredMessage: "请输入邮箱",
    rules: [{ type: "email", message: "邮箱格式不正确" }],
    placeholder: "user@example.com",
  },
  {
    name: "password",
    label: "初始密码",
    required: true,
    type: "password",
    editOptional: true,
    hideInTable: true,
  },
  {
    name: "avatar",
    label: "头像地址",
    placeholder: "https://…",
    hideInTable: true,
  },
  {
    name: "last_login_at",
    label: "最后登录",
    editable: false,
    render: (value) =>
      value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm") : "—",
  },
  {
    name: "created_at",
    label: "创建时间",
    editable: false,
    render: (value) => dayjs(String(value)).format("YYYY-MM-DD HH:mm"),
  },
];

// 用户管理页：数据与增删改全部走 /api/users（Next 转发 Python /api/users）。
// 表格交互由通用 CrudManager 承担：服务端分页 + 关键字筛选 + 回调模式增删改
export default function AdminUsersPage() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  /** @description 统一错误提取：转发层错误结构为 { error: string } */
  const request = useCallback(async (init: RequestInit & { url: string }) => {
    const { url, ...options } = init;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((body as { error?: string } | null)?.error ?? "请求失败");
    }
    return body;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (keyword) params.set("keyword", keyword);
      const body = (await request({
        url: `/api/users?${params.toString()}`,
      })) as { items: AdminUser[]; total: number };
      setRows(body.items);
      setTotal(body.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用户失败");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, request]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageLayout>
      <CrudManager
        title="用户"
        fields={USER_FIELDS}
        rows={rows ?? []}
        loading={loading}
        paginated
        total={total}
        current={page}
        pageSize={pageSize}
        onPageChange={(next, nextSize) => {
          setPage(next);
          setPageSize(nextSize);
        }}
        filterFields={[
          {
            name: "keyword",
            label: "关键字",
            placeholder: "按用户名 / 邮箱搜索",
          },
        ]}
        onFilterSearch={(values) => {
          setKeyword(
            values.keyword === undefined ? "" : String(values.keyword),
          );
          setPage(1);
        }}
        // 服务端分页只持有当前页数据，导出/导入不适用
        toolbar={{ export: false }}
        onCreate={async (values) => {
          await request({
            url: "/api/users",
            method: "POST",
            body: JSON.stringify(values),
          });
          await load();
        }}
        onUpdate={async (record, values) => {
          await request({
            url: `/api/users/${record.id}`,
            method: "PATCH",
            body: JSON.stringify(values),
          });
          await load();
        }}
        onDelete={async (record) => {
          await request({ url: `/api/users/${record.id}`, method: "DELETE" });
          await load();
        }}
      />
    </PageLayout>
  );
}

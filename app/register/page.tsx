"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App as AntApp, Button, Form, Input, type FormInstance } from "antd";
import AuthBrandPanel from "@/components/AuthBrandPanel";
import Turnstile from "@/components/Turnstile";

/** 注册表单数据类型 */
interface RegisterForm {
  name: string;
  email: string;
  code: string;
  password: string;
}

/**
 * 注册页：与登录页同款左右布局。
 * 流程：输入邮箱点击「发送验证码」-> 服务端生成随机验证码存 Redis 并经 Gmail 发送 ->
 *   用户填入验证码、用户名、密码，点击「注册」-> 服务端消费验证码，
 *   匹配成功则写入 accounts 表完成注册。
 */
/** 注册页外壳：<AntApp> 必须先渲染，useApp 只能在其内部子组件中调用 */
export default function RegisterPage() {
  return (
    <AntApp>
      <RegisterView />
    </AntApp>
  );
}

function RegisterView() {
  const router = useRouter();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  // 提交 / 发码防重入：loading 态挡不住「输入框回车 + 点按钮」的并发提交，
  // 同一个一次性 Turnstile token 被两个请求复用时第二个必然 403
  const sendingRef = useRef(false);
  const submittingRef = useRef(false);
  const [countdown, setCountdown] = useState(0);
  const [form] = Form.useForm<RegisterForm>();
  // Turnstile 人机验证令牌：发码与注册各一个组件（action 不同、令牌一次性消费），
  // 提交失败后通过 resetKey 重置重取
  const [sendToken, setSendToken] = useState<string | null>(null);
  const [sendReset, setSendReset] = useState(0);
  const [regToken, setRegToken] = useState<string | null>(null);
  const [regReset, setRegReset] = useState(0);

  // 发送验证码的 60 秒倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  async function sendCode(form: FormInstance<RegisterForm>) {
    const email = form.getFieldValue("email");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message.warning("请先输入合法的邮箱地址");
      return;
    }
    if (!sendToken) {
      message.warning("请先完成人机验证再发送验证码");
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: sendToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.error ?? "发送失败");
        setSendReset((k) => k + 1);
        return;
      }
      message.success(`验证码已发送至 ${email}，请查收邮件（5 分钟内有效）`);
      setCountdown(60);
    } catch {
      message.error("网络错误，请稍后重试");
      setSendReset((k) => k + 1);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleRegister(values: RegisterForm) {
    if (submittingRef.current) return;
    if (!regToken) {
      message.warning("请先完成人机验证");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, turnstileToken: regToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.error ?? "注册失败");
        setRegReset((k) => k + 1);
        return;
      }
      message.success(`注册成功，${data.user.name}！请登录`);
      // 稍作停留让成功提示可见，再跳转登录页
      await new Promise((r) => setTimeout(r, 600));
      router.push("/login");
    } catch {
      message.error("网络错误，请稍后重试");
      setRegReset((k) => k + 1);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-(--ant-layout-body-bg)">
      {/* 左侧品牌面板：移动端隐藏 */}
      <AuthBrandPanel slogan="创建账户，开启你的编程练习之旅。" />

      {/* 右侧注册表单 */}
      <div className="flex-1 flex w-full items-center justify-center px-8 md:w-2/5 bg-(--ant-layout-body-bg)">
        <div className="w-full max-w-[400px] py-16">
          <h1 className="mb-8 text-2xl font-bold text-(--ant-color-text)">创建新账户</h1>

          <Form<RegisterForm>
            form={form}
            layout="vertical"
            size="large"
            onFinish={handleRegister}
          >
            <Form.Item
              name="name"
              rules={[
                { required: true, message: "请输入用户名" },
                { max: 32, message: "用户名最长 32 个字符" },
              ]}
            >
              {/* 不声明 username，避免 Chrome 把注册表单误判为登录表单而回填已保存的账号 */}
              <Input placeholder="用户名" autoComplete="off" />
            </Form.Item>

            <Form.Item
              name="email"
              rules={[
                { required: true, message: "请输入邮箱" },
                { type: "email", message: "邮箱格式不正确" },
              ]}
            >
              <Input placeholder="邮箱" autoComplete="email" />
            </Form.Item>

            {/* 发码前的人机验证（action=send_code，防邮件轰炸） */}
            <Form.Item className="mb-2">
              <Turnstile
                action="send_code"
                onToken={setSendToken}
                resetKey={sendReset}
              />
            </Form.Item>

            <Form.Item
              name="code"
              rules={[
                { required: true, message: "请输入验证码" },
                { pattern: /^\d{6}$/, message: "验证码为 6 位数字" },
              ]}
            >
              <Input
                placeholder="邮箱验证码"
                maxLength={6}
                inputMode="numeric"
                suffix={
                  <Button
                    type="link"
                    size="small"
                    className="px-0"
                    disabled={countdown > 0}
                    loading={sending}
                    onClick={(e) => {
                      // 阻止触发表单提交
                      e.stopPropagation();
                      void sendCode(form);
                    }}
                  >
                    {countdown > 0 ? `${countdown}s 后重发` : "发送验证码"}
                  </Button>
                }
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: "请输入密码" },
                { min: 6, message: "密码长度至少 6 位" },
              ]}
            >
              <Input.Password
                placeholder="密码（至少 6 位）"
                autoComplete="new-password"
              />
            </Form.Item>

            {/* 注册提交前的人机验证（action=register） */}
            <Form.Item className="mb-2">
              <Turnstile
                action="register"
                onToken={setRegToken}
                resetKey={regReset}
              />
            </Form.Item>

            <Form.Item className="mt-2 mb-4">
              <Button type="primary" htmlType="submit" block loading={loading}>
                注册
              </Button>
            </Form.Item>

            <div className="text-center text-sm text-(--ant-color-text-secondary)">
              已有账户？
              <Link
                href="/login"
                className="cursor-pointer text-(--ant-color-primary)"
              >
                去登录
              </Link>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}

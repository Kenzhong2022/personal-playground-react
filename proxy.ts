import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * 全站登录门禁（Next 16 的 proxy 约定，middleware.ts 已废弃改名）：
 * 除登录 / 注册 / 忘记密码外的所有页面都要求有效会话，否则 302 到登录页。
 *
 * 会话是 Python 服务端登录时签发的 HttpOnly Cookie cb_token（JWT HS256，
 * 密钥 AUTH_SECRET 与 Python 共享）。这里做真实签名校验而非仅检查存在性——
 * 过期 / 伪造的 Cookie 会在这一层被拦下，不会出现「进了页面但数据全 401」的半残态。
 * 未配置 AUTH_SECRET 时退化为 Cookie 存在性检查（本地开发未配密钥也不误伤）。
 */

// 与 Python security.py 的 SESSION_COOKIE 保持一致（proxy 独立于应用代码运行，不能共享模块，只能就地声明）
const SESSION_COOKIE = "cb_token";

// 免登录页面：登录 / 注册 / 忘记密码
const PUBLIC_PATHS = /^\/(login|register|forgot-password)(\/|$)/;

function authSecret(): Uint8Array | null {
  const secret = process.env.AUTH_SECRET;
  return secret ? new TextEncoder().encode(secret) : null;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.test(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = authSecret();
  let loggedIn = false;
  if (token) {
    if (secret) {
      try {
        await jwtVerify(token, secret, { algorithms: ["HS256"] });
        loggedIn = true;
      } catch {
        // 签名不符 / 已过期
        loggedIn = false;
      }
    } else {
      // 降级：未配置共享密钥时只检查 Cookie 存在性
      loggedIn = true;
    }
  }
  if (loggedIn) return NextResponse.next();

  // 未登录：跳登录页并携带来源，登录成功后回跳
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

// 排除 API（各自鉴权）、Next 静态资源与 public 静态文件；
// 其余页面路径全部过门禁
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|images|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$).*)",
  ],
};

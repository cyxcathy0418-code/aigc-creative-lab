import type { Metadata } from "next";
import Link from "next/link";
import { hasSupabaseEnv } from "@/lib/supabase/config";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "登录",
  description: "使用受邀邮箱登录 Brand Anchor Studio Beta。",
};

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const configured = hasSupabaseEnv();
  const devLoginEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_LOGIN_ENABLED === "true";
  const params = await searchParams;
  const callbackFailed =
    params.error === "auth_callback_failed" ||
    params.error === "auth_link_invalid";
  const devLoginFailed = params.error === "dev_login_failed";

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <Link className="wordmark" href="/">
          <span className="brand-dot" aria-hidden="true" />
          <span>Brand Anchor</span>
          <span className="wordmark-muted">Studio</span>
        </Link>

        <div className="auth-content">
          <p className="section-kicker">PRIVATE BETA / 邮箱登录</p>
          <h1>
            Your creative workspace is waiting.
          </h1>
          <p className="auth-intro">
            输入已获邀请的邮箱。我们会发送一次性登录链接，无需设置密码。
          </p>

          {!configured ? (
            <div className="config-notice" role="status">
              <strong>产品骨架已就绪，等待连接 Supabase。</strong>
              <br />
              请复制 <code>.env.example</code> 为 <code>.env.local</code>，
              填入项目 URL 与匿名公钥。当前不会尝试连接外部服务。
            </div>
          ) : null}

          {callbackFailed ? (
            <p className="form-message" data-tone="error" role="alert">
              登录链接无效、已过期、已经使用过，或不是在发起登录的浏览器中打开。请发送一封新的登录邮件。
            </p>
          ) : null}

          {devLoginFailed ? (
            <p className="form-message" data-tone="error" role="alert">
              未能建立本地测试会话。请确认 Supabase 已启用匿名登录后重试。
            </p>
          ) : null}

          <LoginForm
            configured={configured}
            devLoginEnabled={devLoginEnabled}
          />
          <p className="login-privacy">
            未获邀请的邮箱不会创建新账号。登录链接为一次性使用，并会在过期后自动失效。
          </p>
        </div>

        <Link className="auth-back" href="/">
          ← 返回产品介绍
        </Link>
      </section>

      <aside className="auth-visual" aria-label="产品理念">
        <div className="auth-visual-copy">
          <span>IDENTITY BEFORE GENERATION</span>
          <blockquote>Protect the product. Push the idea further.</blockquote>
          <p>
            Brand Anchor Studio
            把商品身份变成整个广告工作流的起点，而不是在结果出来后再人工找错。
          </p>
        </div>
      </aside>
    </main>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { createImplicitLoginClient } from "@/lib/supabase/client";

type LoginFormProps = {
  configured: boolean;
  devLoginEnabled: boolean;
};

function getLoginErrorMessage(error: unknown) {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  const detail = error instanceof Error ? error.message : "";
  const normalized = `${code} ${detail}`.toLowerCase();

  if (
    status === 429 ||
    normalized.includes("rate limit") ||
    normalized.includes("over_email_send_rate_limit")
  ) {
    return "Supabase 当前的邮件发送频率已达上限。请不要继续点击，等待约 1 小时后再发送一次。";
  }

  if (
    normalized.includes("user not found") ||
    normalized.includes("signups not allowed")
  ) {
    return "该邮箱尚未加入 Beta 名单，请先由管理员在 Supabase 中邀请。";
  }

  return "暂时无法发送登录链接。请稍后重试；如果问题持续，请联系 Beta 管理员。";
}

export function LoginForm({
  configured,
  devLoginEnabled,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  function handleDevLogin() {
    setStatus("sending");
    setMessage("");

    const requestedNext = new URLSearchParams(window.location.search).get(
      "next",
    );
    const next =
      requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
        ? requestedNext
        : "/dashboard";

    window.location.assign(
      `/auth/dev-login?next=${encodeURIComponent(next)}`,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      setStatus("error");
      setMessage(
        "本地环境尚未连接 Supabase，请先按配置清单补充环境变量。",
      );
      return;
    }

    setStatus("sending");
    setMessage("");

    try {
      const supabase = createImplicitLoginClient();
      const callbackUrl = new URL("/auth/confirm", window.location.origin);
      const next = new URLSearchParams(window.location.search).get("next");

      if (next?.startsWith("/") && !next.startsWith("//")) {
        callbackUrl.searchParams.set("next", next);
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: callbackUrl.toString(),
        },
      });

      if (error) {
        throw error;
      }

      setStatus("sent");
      setMessage(
        "登录链接已发送。请只打开最新一封邮件。开发阶段仍需在运行本项目的电脑上打开，因为手机无法访问 localhost。",
      );
    } catch (error) {
      console.error("Supabase magic-link request failed", error);
      setStatus("error");
      setMessage(getLoginErrorMessage(error));
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      {devLoginEnabled ? (
        <div className="dev-login-panel">
          <span>LOCAL DEVELOPMENT ONLY</span>
          <strong>跳过邮件，建立真实 Supabase 测试会话</strong>
          <p>仍会执行 Cookie、RLS 与私有存储权限；生产环境不会显示此入口。</p>
          <button
            className="button dev-login-button"
            type="button"
            disabled={!configured || status === "sending"}
            onClick={handleDevLogin}
          >
            <span>{status === "sending" ? "正在进入…" : "进入本地测试工作台"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
      <label htmlFor="email">受邀邮箱</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={
          !configured || status === "sending" || status === "sent"
        }
      />
      <button
        className="button button-primary"
        type="submit"
        disabled={
          !configured ||
          status === "sending" ||
          status === "sent"
        }
      >
        <span>
          {status === "sending"
            ? "正在发送…"
            : status === "sent"
              ? "请检查邮箱"
              : "发送邮箱登录链接"}
        </span>
        <span aria-hidden="true">→</span>
      </button>
      {status === "sent" ? (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setStatus("idle");
            setMessage("");
          }}
        >
          更换邮箱
        </button>
      ) : null}
      {message ? (
        <p
          className="form-message"
          data-tone={status === "error" ? "error" : "success"}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

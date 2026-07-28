"use client";

import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type ConfirmState = "verifying" | "error";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

const supportedEmailTypes = new Set<EmailOtpType>([
  "email",
  "invite",
  "recovery",
  "email_change",
]);

export function ConfirmClient() {
  const [state, setState] = useState<ConfirmState>("verifying");

  useEffect(() => {
    let active = true;

    async function confirmSession() {
      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const next = safeNextPath(query.get("next"));
      const code = query.get("code");
      const tokenHash = query.get("token_hash");
      const requestedType = query.get("type");
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const supabase = createBrowserSupabaseClient();

      // Remove credentials from the visible URL before making network calls.
      window.history.replaceState({}, "", window.location.pathname);

      let error: Error | null = null;

      if (accessToken && refreshToken) {
        const result = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        error = result.error;
      } else if (code) {
        const result = await supabase.auth.exchangeCodeForSession(code);
        error = result.error;
      } else if (
        tokenHash &&
        requestedType &&
        supportedEmailTypes.has(requestedType as EmailOtpType)
      ) {
        const result = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: requestedType as EmailOtpType,
        });
        error = result.error;
      } else {
        error = new Error("登录链接没有包含可验证的会话信息");
      }

      if (!active) return;

      if (error) {
        console.error("Supabase auth confirmation failed", error);
        setState("error");
        return;
      }

      window.location.replace(next);
    }

    void confirmSession();

    return () => {
      active = false;
    };
  }, []);

  if (state === "error") {
    return (
      <div className="auth-confirm-card" role="alert">
        <span>LINK NOT ACCEPTED</span>
        <h1>这条登录链接无法完成验证。</h1>
        <p>链接可能已经使用或过期。请返回登录页，只发送并打开最新一封邮件。</p>
        <a className="button button-primary" href="/login">
          返回登录页
        </a>
      </div>
    );
  }

  return (
    <div className="auth-confirm-card" role="status">
      <span>SECURE SIGN-IN</span>
      <h1>正在建立登录会话…</h1>
      <p>验证成功后将自动进入工作台，请不要关闭页面。</p>
    </div>
  );
}

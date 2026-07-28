"use client";

import { useState } from "react";

export function RetryExtractionButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function retryExtraction() {
    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch(`/api/products/${productId}/spec`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Spec 重新抽取失败，请稍后重试。");
      }
      window.location.reload();
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Spec 重新抽取失败，请稍后重试。",
      );
    }
  }

  return (
    <div>
      <button
        className="button button-dark"
        type="button"
        disabled={status === "loading"}
        onClick={retryExtraction}
      >
        {status === "loading" ? "正在重新抽取…" : "重新抽取当前商品"}
        <span aria-hidden="true">→</span>
      </button>
      {message ? (
        <p className="form-message" data-tone="error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

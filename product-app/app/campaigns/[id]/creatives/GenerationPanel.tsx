"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type GenerationPanelProps = {
  campaignId: string;
  markets: string[];
};

export function GenerationPanel({
  campaignId,
  markets,
}: GenerationPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(
    markets.length ? [markets[0]] : [],
  );
  const [size, setSize] = useState("1024x1536");
  const [quality, setQuality] = useState("medium");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  function toggle(market: string) {
    setSelected((current) =>
      current.includes(market)
        ? current.filter((item) => item !== market)
        : [...current, market],
    );
  }

  async function generate() {
    if (!selected.length) {
      setStatus("error");
      setMessage("请至少选择一个市场。");
      return;
    }
    const accepted = window.confirm(
      `即将调用 OpenAI 生成 ${selected.length} 张图片。\n当前中等质量竖版测试预算约为每张 $0.05–$0.07，实际以账单为准。\n\n确认继续？`,
    );
    if (!accepted) return;

    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketsToGenerate: selected,
          size,
          quality,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        completed?: number;
      };
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error ?? "图片生成失败");
      }
      router.push(`/campaigns/${campaignId}/assets`);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "图片生成失败");
    }
  }

  return (
    <section className="generation-console">
      <div className="generation-console-copy">
        <span>REFERENCE-IMAGE GENERATION</span>
        <h2>选择第一批要生成的市场。</h2>
        <p>
          建议先生成一个市场，确认商品一致性后再扩大。每次请求都会使用已保存的真实商品参考图。
        </p>
      </div>
      <div className="generation-controls">
        <fieldset>
          <legend>市场</legend>
          <div className="generation-market-options">
            {markets.map((market) => (
              <label key={market}>
                <input
                  type="checkbox"
                  checked={selected.includes(market)}
                  onChange={() => toggle(market)}
                />
                <span>{market}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="generation-setting-grid">
          <label>
            画幅
            <select value={size} onChange={(event) => setSize(event.target.value)}>
              <option value="1024x1536">竖版 1024 × 1536</option>
              <option value="1024x1024">方形 1024 × 1024</option>
              <option value="1536x1024">横版 1536 × 1024</option>
            </select>
          </label>
          <label>
            质量
            <select
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
            >
              <option value="low">低 — 方向草测</option>
              <option value="medium">中 — 推荐首测</option>
              <option value="high">高 — 暂不建议首测</option>
            </select>
          </label>
        </div>
        <button
          className="button button-primary"
          type="button"
          disabled={status === "submitting"}
          onClick={generate}
        >
          <span>
            {status === "submitting"
              ? "正在生成并保存…"
              : `生成 ${selected.length || 0} 张图片`}
          </span>
          <span aria-hidden="true">→</span>
        </button>
        <small>
          真实图片开关默认关闭。开启前仍需项目方确认本次预算。
        </small>
        {message ? (
          <p className="form-message" data-tone="error" role="alert">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}


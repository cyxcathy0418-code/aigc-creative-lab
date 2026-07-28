"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_MARKETS } from "@/lib/products/schema";

type CampaignFormProps = {
  productId: string;
  productName: string;
  suggestedMarkets: string[];
};

export function CampaignForm({
  productId,
  productName,
  suggestedMarkets,
}: CampaignFormProps) {
  const router = useRouter();
  const [selectedMarkets, setSelectedMarkets] =
    useState<string[]>(suggestedMarkets);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  function toggleMarket(market: string) {
    setSelectedMarkets((current) =>
      current.includes(market)
        ? current.filter((item) => item !== market)
        : [...current, market],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (selectedMarkets.length < 2) {
      setStatus("error");
      setMessage("请选择至少两个市场，才能比较本地化方向。");
      return;
    }

    const form = new FormData(event.currentTarget);
    setStatus("submitting");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId,
          name: form.get("name"),
          targetMarkets: selectedMarkets,
        }),
      });
      const payload = (await response.json()) as {
        campaignId?: string;
        error?: string;
      };
      if (!response.ok || !payload.campaignId) {
        throw new Error(payload.error ?? "市场创意派生失败");
      }
      router.push(`/campaigns/${payload.campaignId}/creatives`);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "市场创意派生失败",
      );
    }
  }

  return (
    <form className="campaign-form" onSubmit={handleSubmit}>
      <section className="campaign-setup">
        <div className="campaign-setup-copy">
          <span>CAMPAIGN NAME</span>
          <h2>这批创意要解决什么任务？</h2>
          <p>名称只用于工作台识别，不会进入模型 Prompt。</p>
        </div>
        <label className="campaign-name-field">
          创意任务名称
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={`${productName} / 首轮市场创意`}
          />
        </label>
      </section>

      <section className="campaign-market-section">
        <div className="campaign-setup-copy">
          <span>MARKET SET</span>
          <h2>同一商品，选择不同语境。</h2>
          <p>
            至少选择两个市场。系统会改变场景、切入角度和表达语言，但不会改写商品身份。
          </p>
        </div>
        <fieldset className="campaign-market-grid">
          <legend className="sr-only">目标市场</legend>
          {SUPPORTED_MARKETS.map((market, index) => {
            const selected = selectedMarkets.includes(market);
            return (
              <label key={market} data-selected={selected}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleMarket(market)}
                />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{market}</strong>
                <small>{selected ? "已加入本轮" : "选择市场"}</small>
              </label>
            );
          })}
        </fieldset>
      </section>

      <div className="campaign-submit-bar">
        <div>
          <strong>先生成策略，不生成图片</strong>
          <span>
            这一步只调用文字模型；真实开关当前默认关闭，确认费用后才会开启。
          </span>
        </div>
        <button
          className="button button-primary"
          type="submit"
          disabled={status === "submitting"}
        >
          <span>
            {status === "submitting" ? "正在派生市场创意…" : "生成市场创意"}
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {message ? (
        <p className="form-message" data-tone="error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}


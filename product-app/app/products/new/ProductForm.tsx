"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_MARKETS } from "@/lib/products/schema";

type Preview = {
  file: File;
  url: string;
};

export function ProductForm() {
  const router = useRouter();
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  const previewUrls = useMemo(
    () => previews.map((preview) => preview.url),
    [previews],
  );

  useEffect(
    () => () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewUrls],
  );

  function handleFiles(files: FileList | null) {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    const nextFiles = Array.from(files ?? []).slice(0, 3);
    setPreviews(
      nextFiles.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (previews.length < 1) {
      setStatus("error");
      setMessage("请先上传至少一张商品参考图。");
      return;
    }

    setStatus("submitting");
    const formData = new FormData(event.currentTarget);
    formData.delete("images");
    previews.forEach(({ file }) => formData.append("images", file));

    try {
      const response = await fetch("/api/products", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        productId?: string;
        error?: string;
      };

      if (!response.ok || !payload.productId) {
        throw new Error(payload.error ?? "商品创建失败，请稍后重试。");
      }

      router.push(`/products/${payload.productId}/spec`);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "商品创建失败，请稍后重试。",
      );
    }
  }

  return (
    <form className="product-form" onSubmit={handleSubmit}>
      <section className="form-section form-section-images">
        <div className="form-section-title">
          <span>01</span>
          <div>
            <h2>商品参考图</h2>
            <p>1–3 张，首张将作为主参考图。支持 JPEG、PNG、WebP，单张不超过 10MB。</p>
          </div>
        </div>
        <label className="upload-zone">
          <input
            type="file"
            name="images"
            accept="image/jpeg,image/png,image/webp"
            multiple
            required
            onChange={(event) => handleFiles(event.target.files)}
          />
          <span className="upload-mark">＋</span>
          <strong>选择商品图片</strong>
          <small>尽量包含正面、侧面与品牌标识细节</small>
        </label>
        {previews.length ? (
          <div className="image-preview-grid">
            {previews.map((preview, index) => (
              <figure key={`${preview.file.name}-${preview.file.lastModified}`}>
                <Image
                  src={preview.url}
                  alt={`商品参考图 ${index + 1}`}
                  fill
                  unoptimized
                />
                <figcaption>
                  {index === 0 ? "PRIMARY" : `VIEW ${index + 1}`}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </section>

      <section className="form-section">
        <div className="form-section-title">
          <span>02</span>
          <div>
            <h2>商品信息</h2>
            <p>把已知事实交给系统，避免模型从图片里猜测功能或材质。</p>
          </div>
        </div>
        <div className="field-grid">
          <label>
            商品名称
            <input name="name" required maxLength={120} placeholder="例如：随行保温杯" />
          </label>
          <label>
            投放平台
            <input name="platform" required maxLength={80} placeholder="例如：Meta / TikTok" />
          </label>
          <label className="field-span">
            核心卖点
            <textarea
              name="sellingPoints"
              required
              maxLength={1200}
              rows={4}
              placeholder="例如：防漏、保温 12 小时、杯盖易清洗"
            />
          </label>
          <label>
            品牌调性
            <input name="brandTone" required maxLength={600} placeholder="例如：克制、可靠、现代" />
          </label>
          <label>
            材质（可选）
            <input name="materialHint" maxLength={300} placeholder="例如：304 不锈钢杯身" />
          </label>
          <label className="field-span">
            风格倾向
            <input
              name="stylePreference"
              required
              maxLength={300}
              placeholder="例如：编辑感产品摄影，干净光影，避免过度科技感"
            />
          </label>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-title">
          <span>03</span>
          <div>
            <h2>目标市场</h2>
            <p>这里仅记录后续广告上下文，不会改变商品本身的视觉身份。</p>
          </div>
        </div>
        <fieldset className="market-options">
          <legend className="sr-only">选择目标市场</legend>
          {SUPPORTED_MARKETS.map((market) => (
            <label key={market}>
              <input type="checkbox" name="targetMarkets" value={market} />
              <span>{market}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <div className="form-submit-bar">
        <div>
          <strong>No generation yet.</strong>
          <span>本步骤只建立商品身份档案，不生成广告图。</span>
        </div>
        <button
          className="button button-primary"
          type="submit"
          disabled={status === "submitting"}
        >
          <span>{status === "submitting" ? "正在提取 Spec…" : "创建商品并提取 Spec"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {message ? (
        <p className="form-message product-form-message" data-tone="error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}

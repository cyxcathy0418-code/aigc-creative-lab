"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductSpec } from "@/lib/products/schema";

type ProductImage = {
  id: string;
  signedUrl: string | null;
  fileName: string;
  isPrimary: boolean;
};

type SpecEditorProps = {
  productId: string;
  initialSpec: ProductSpec;
  initialVersion: number;
  images: ProductImage[];
};

function linesToArray(value: string, max: number) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function commaToArray(value: string, max: number) {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function SpecEditor({
  productId,
  initialSpec,
  initialVersion,
  images,
}: SpecEditorProps) {
  const router = useRouter();
  const [spec, setSpec] = useState<ProductSpec>(initialSpec);
  const [version, setVersion] = useState(initialVersion);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [imageStatus, setImageStatus] = useState<
    "idle" | "uploading" | "error"
  >("idle");
  const [imageMessage, setImageMessage] = useState("");

  async function uploadReferenceImages(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 3 - images.length);
    if (!selected.length) return;

    setImageStatus("uploading");
    setImageMessage("");
    const formData = new FormData();
    selected.forEach((file) => formData.append("images", file));

    try {
      const response = await fetch(
        `/api/products/${productId}/reference-images`,
        {
          method: "POST",
          body: formData,
        },
      );
      const payload = (await response.json()) as {
        uploaded?: number;
        error?: string;
      };
      if (!response.ok || !payload.uploaded) {
        throw new Error(payload.error ?? "商品参考图上传失败");
      }

      setImageStatus("idle");
      router.refresh();
    } catch (error) {
      setImageStatus("error");
      setImageMessage(
        error instanceof Error ? error.message : "商品参考图上传失败",
      );
    }
  }

  async function saveSpec() {
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch(`/api/products/${productId}/spec`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spec),
      });
      const payload = (await response.json()) as {
        spec?: ProductSpec;
        version?: number;
        error?: string;
      };

      if (!response.ok || !payload.spec || !payload.version) {
        throw new Error(payload.error ?? "Spec 保存失败，请稍后重试。");
      }

      setSpec(payload.spec);
      setVersion(payload.version);
      setStatus("saved");
      setMessage(`版本 v${payload.version} 已保存。`);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Spec 保存失败，请稍后重试。",
      );
    }
  }

  return (
    <div className="spec-layout">
      <aside className="spec-reference-panel">
        <div className="spec-panel-label">
          <span>REFERENCE SET</span>
          <strong>{images.length} images</strong>
        </div>
        <div className="spec-reference-grid">
          {images.map((image, index) => (
            <figure key={image.id}>
              {image.signedUrl ? (
                <Image
                  src={image.signedUrl}
                  alt={image.fileName}
                  fill
                  unoptimized
                />
              ) : (
                <div className="image-unavailable">预览暂不可用</div>
              )}
              <figcaption>
                {image.isPrimary ? "PRIMARY" : `VIEW ${index + 1}`}
              </figcaption>
            </figure>
          ))}
        </div>
        {images.length < 3 ? (
          <label className="spec-reference-upload">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={imageStatus === "uploading"}
              onChange={(event) => {
                void uploadReferenceImages(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <strong>
              {imageStatus === "uploading"
                ? "正在上传参考图…"
                : images.length
                  ? "＋ 添加参考图"
                  : "＋ 绑定商品参考图"}
            </strong>
            <small>最多 3 张，单张不超过 10MB</small>
          </label>
        ) : null}
        {imageMessage ? (
          <p className="spec-reference-message" role="status">
            {imageMessage}
          </p>
        ) : null}
        <div className="anchor-summary">
          <span>ANCHOR SENTENCE</span>
          <p>{spec.anchorSentence}</p>
        </div>
      </aside>

      <div className="spec-editor">
        <div className="spec-editor-status">
          <div>
            <span>EDITABLE PRODUCT IDENTITY</span>
            <strong>v{version}</strong>
          </div>
          <p>所有字段都可以修正；保存时会再次执行完整条件校验。</p>
        </div>

        <section className="spec-section">
          <div className="spec-section-heading">
            <span>01</span>
            <h2>基本身份</h2>
          </div>
          <div className="field-grid">
            <label>
              商品名称
              <input
                value={spec.productIdentity.name}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    productIdentity: {
                      ...current.productIdentity,
                      name: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label>
              商品品类
              <input
                value={spec.productIdentity.category}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    productIdentity: {
                      ...current.productIdentity,
                      category: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label className="field-span">
              一句话外观描述
              <input
                value={spec.productIdentity.oneLine}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    productIdentity: {
                      ...current.productIdentity,
                      oneLine: event.target.value,
                    },
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section className="spec-section">
          <div className="spec-section-heading">
            <span>02</span>
            <h2>视觉锚点</h2>
          </div>
          <div className="field-grid">
            <label>
              主色名称
              <input
                value={spec.visualAnchor.primaryColor.name}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      primaryColor: {
                        ...current.visualAnchor.primaryColor,
                        name: event.target.value,
                      },
                    },
                  }))
                }
              />
            </label>
            <label>
              主色色值
              <input
                value={spec.visualAnchor.primaryColor.hex}
                placeholder="#RRGGBB 或 未知"
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      primaryColor: {
                        ...current.visualAnchor.primaryColor,
                        hex: event.target.value,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="field-span">
              材质
              <textarea
                rows={2}
                value={spec.visualAnchor.material}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      material: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label>
              轮廓
              <textarea
                rows={3}
                value={spec.visualAnchor.silhouette}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      silhouette: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label>
              比例
              <textarea
                rows={3}
                value={spec.visualAnchor.proportions}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      proportions: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <label className="field-span">
              独特细节（每行一项，最多 8 项）
              <textarea
                rows={5}
                value={spec.visualAnchor.distinctiveDetails.join("\n")}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      distinctiveDetails: linesToArray(event.target.value, 8),
                    },
                  }))
                }
              />
            </label>
          </div>

          <div className="nested-editor">
            <div className="nested-editor-title">
              <h3>辅助色</h3>
              <button
                className="text-button"
                type="button"
                disabled={spec.visualAnchor.secondaryColors.length >= 6}
                onClick={() =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      secondaryColors: [
                        ...current.visualAnchor.secondaryColors,
                        { name: "未知", hex: "未知" },
                      ],
                    },
                  }))
                }
              >
                ＋ 添加颜色
              </button>
            </div>
            {spec.visualAnchor.secondaryColors.length ? (
              spec.visualAnchor.secondaryColors.map((color, index) => (
                <div className="repeater-row color-row" key={`${index}-${color.name}`}>
                  <input
                    aria-label={`辅助色 ${index + 1} 名称`}
                    value={color.name}
                    onChange={(event) =>
                      setSpec((current) => {
                        const colors = [...current.visualAnchor.secondaryColors];
                        colors[index] = { ...colors[index], name: event.target.value };
                        return {
                          ...current,
                          visualAnchor: {
                            ...current.visualAnchor,
                            secondaryColors: colors,
                          },
                        };
                      })
                    }
                  />
                  <input
                    aria-label={`辅助色 ${index + 1} 色值`}
                    value={color.hex}
                    onChange={(event) =>
                      setSpec((current) => {
                        const colors = [...current.visualAnchor.secondaryColors];
                        colors[index] = { ...colors[index], hex: event.target.value };
                        return {
                          ...current,
                          visualAnchor: {
                            ...current.visualAnchor,
                            secondaryColors: colors,
                          },
                        };
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`删除辅助色 ${index + 1}`}
                    onClick={() =>
                      setSpec((current) => ({
                        ...current,
                        visualAnchor: {
                          ...current.visualAnchor,
                          secondaryColors:
                            current.visualAnchor.secondaryColors.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                        },
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))
            ) : (
              <p className="nested-empty">未识别到辅助色。</p>
            )}
          </div>
        </section>

        <section className="spec-section">
          <div className="spec-section-heading">
            <span>03</span>
            <h2>品牌标识</h2>
          </div>
          <div className="field-grid">
            <label>
              标识类型
              <select
                value={spec.visualAnchor.brandMarking.markType}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      brandMarking: {
                        ...current.visualAnchor.brandMarking,
                        markType: event.target.value as ProductSpec["visualAnchor"]["brandMarking"]["markType"],
                      },
                    },
                  }))
                }
              >
                <option value="none">无标识</option>
                <option value="wordmark">文字标</option>
                <option value="graphic_mark">图形标</option>
                <option value="combined_mark">图文组合</option>
                <option value="unreadable">不可读标识</option>
              </select>
            </label>
            <label>
              保留等级
              <select
                value={spec.visualAnchor.brandMarking.preservationLevel}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualAnchor: {
                      ...current.visualAnchor,
                      brandMarking: {
                        ...current.visualAnchor.brandMarking,
                        preservationLevel:
                          event.target.value as ProductSpec["visualAnchor"]["brandMarking"]["preservationLevel"],
                      },
                    },
                  }))
                }
              >
                <option value="required">必须保留</option>
                <option value="best_effort">尽力保留</option>
                <option value="omit_if_unclear">不清晰时省略</option>
              </select>
            </label>
            {[
              ["textContent", "文字内容"],
              ["graphicDescription", "图形描述"],
              ["position", "位置"],
              ["applicationMethod", "工艺"],
              ["appearance", "可见表现"],
            ].map(([field, label]) => (
              <label key={field} className={field === "appearance" ? "field-span" : ""}>
                {label}
                <input
                  value={
                    spec.visualAnchor.brandMarking[
                      field as keyof typeof spec.visualAnchor.brandMarking
                    ]
                  }
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      visualAnchor: {
                        ...current.visualAnchor,
                        brandMarking: {
                          ...current.visualAnchor.brandMarking,
                          [field]: event.target.value,
                        },
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <p className="validation-note">
            条件校验已启用：例如“无标识”时其余描述必须全部填写“无”。
          </p>
        </section>

        <section className="spec-section">
          <div className="spec-section-heading">
            <span>04</span>
            <h2>卖点与禁忌</h2>
          </div>
          <div className="nested-editor selling-points-editor">
            <div className="nested-editor-title">
              <h3>核心卖点</h3>
              <button
                className="text-button"
                type="button"
                disabled={spec.sellingPoints.length >= 4}
                onClick={() =>
                  setSpec((current) => ({
                    ...current,
                    sellingPoints: [
                      ...current.sellingPoints,
                      {
                        point: "",
                        priority: Math.min(current.sellingPoints.length + 1, 4),
                      },
                    ],
                  }))
                }
              >
                ＋ 添加卖点
              </button>
            </div>
            {spec.sellingPoints.map((sellingPoint, index) => (
              <div className="repeater-row selling-point-row" key={index}>
                <input
                  aria-label={`卖点 ${index + 1}`}
                  maxLength={20}
                  value={sellingPoint.point}
                  onChange={(event) =>
                    setSpec((current) => {
                      const sellingPoints = [...current.sellingPoints];
                      sellingPoints[index] = {
                        ...sellingPoints[index],
                        point: event.target.value,
                      };
                      return { ...current, sellingPoints };
                    })
                  }
                />
                <select
                  aria-label={`卖点 ${index + 1} 优先级`}
                  value={sellingPoint.priority}
                  onChange={(event) =>
                    setSpec((current) => {
                      const sellingPoints = [...current.sellingPoints];
                      sellingPoints[index] = {
                        ...sellingPoints[index],
                        priority: Number(event.target.value),
                      };
                      return { ...current, sellingPoints };
                    })
                  }
                >
                  {[1, 2, 3, 4].map((priority) => (
                    <option value={priority} key={priority}>
                      P{priority}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`删除卖点 ${index + 1}`}
                  disabled={spec.sellingPoints.length === 1}
                  onClick={() =>
                    setSpec((current) => ({
                      ...current,
                      sellingPoints: current.sellingPoints.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    }))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="field-grid spec-text-groups">
            <label className="field-span">
              品牌调性（逗号分隔，最多 5 项）
              <input
                value={spec.brandTone.join("，")}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    brandTone: commaToArray(event.target.value, 5),
                  }))
                }
              />
            </label>
            <label className="field-span">
              视觉禁忌（每行一项，最多 6 项）
              <textarea
                rows={5}
                value={spec.visualTaboos.join("\n")}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    visualTaboos: linesToArray(event.target.value, 6),
                  }))
                }
              />
            </label>
            <label className="field-span anchor-field">
              身份锚定句（最多 60 字）
              <textarea
                rows={3}
                maxLength={60}
                value={spec.anchorSentence}
                onChange={(event) =>
                  setSpec((current) => ({
                    ...current,
                    anchorSentence: event.target.value,
                  }))
                }
              />
              <small>{spec.anchorSentence.length}/60</small>
            </label>
          </div>
        </section>

        <div className="spec-savebar">
          <div>
            <strong>Human-confirmed source</strong>
            <span>保存后，这份 Spec 才能进入 Phase 2 的多市场创意流程。</span>
          </div>
          <div className="spec-save-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={status === "saving"}
              onClick={saveSpec}
            >
              {status === "saving" ? "正在保存…" : "保存 Spec"}
              <span aria-hidden="true">→</span>
            </button>
            <Link
              className="button phase-two-button"
              href={`/products/${productId}/campaigns/new`}
            >
              进入市场创意 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        {message ? (
          <p
            className="form-message spec-message"
            data-tone={status === "error" ? "error" : "success"}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

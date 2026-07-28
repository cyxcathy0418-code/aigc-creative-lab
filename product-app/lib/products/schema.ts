import { z } from "zod";

export const SUPPORTED_MARKETS = [
  "美国",
  "欧洲",
  "日本",
  "韩国",
  "东南亚",
] as const;

// ASCII codes for generated filenames. Supabase Storage's signed-URL
// `download` option and some ZIP tools mishandle non-ASCII filenames, so
// downloaded files use these instead of the Chinese market label.
export const MARKET_FILE_CODES: Record<(typeof SUPPORTED_MARKETS)[number], string> =
  {
    美国: "US",
    欧洲: "EU",
    日本: "JP",
    韩国: "KR",
    东南亚: "SEA",
  };

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const ColorSpecSchema = z.object({
  name: z.string().trim().min(1, "颜色名称不能为空"),
  hex: z
    .string()
    .trim()
    .refine(
      (value) => value === "未知" || /^#[0-9A-Fa-f]{6}$/.test(value),
      "色值必须是 #RRGGBB 或“未知”",
    ),
});

export const BrandMarkingSpecSchema = z
  .object({
    markType: z.enum([
      "none",
      "wordmark",
      "graphic_mark",
      "combined_mark",
      "unreadable",
    ]),
    textContent: z.string().trim().min(1),
    graphicDescription: z.string().trim().min(1),
    position: z.string().trim().min(1),
    applicationMethod: z.string().trim().min(1),
    appearance: z.string().trim().min(1),
    preservationLevel: z.enum([
      "required",
      "best_effort",
      "omit_if_unclear",
    ]),
  })
  .superRefine((data, context) => {
    const addIssue = (path: keyof typeof data, message: string) => {
      context.addIssue({
        code: "custom",
        path: [path],
        message,
      });
    };

    if (data.markType === "none") {
      for (const field of [
        "textContent",
        "graphicDescription",
        "position",
        "applicationMethod",
        "appearance",
      ] as const) {
        if (data[field] !== "无") {
          addIssue(field, "无品牌标识时，此字段必须填写“无”");
        }
      }
    }

    if (data.markType === "wordmark") {
      if (["无", "未知"].includes(data.textContent)) {
        addIssue("textContent", "文字标必须填写可读的品牌文字");
      }
      if (data.graphicDescription !== "无") {
        addIssue("graphicDescription", "纯文字标的图形描述必须填写“无”");
      }
    }

    if (data.markType === "graphic_mark") {
      if (data.textContent !== "无") {
        addIssue("textContent", "纯图形标的文字内容必须填写“无”");
      }
      if (["无", "未知"].includes(data.graphicDescription)) {
        addIssue("graphicDescription", "图形标必须描述可见图形");
      }
    }

    if (data.markType === "combined_mark") {
      if (["无", "未知"].includes(data.textContent)) {
        addIssue("textContent", "图文组合标必须填写可读文字");
      }
      if (["无", "未知"].includes(data.graphicDescription)) {
        addIssue("graphicDescription", "图文组合标必须描述图形");
      }
    }

    if (data.markType === "unreadable" && data.textContent !== "未知") {
      addIssue("textContent", "文字不可读时，文字内容必须填写“未知”");
    }
  });

export const SellingPointSchema = z.object({
  point: z.string().trim().min(1).max(20, "单条卖点不能超过 20 个字符"),
  priority: z.number().int().min(1).max(4),
});

export const ProductSpecSchema = z
  .object({
    productIdentity: z.object({
      name: z.string().trim().min(1),
      category: z.string().trim().min(1),
      oneLine: z.string().trim().min(1),
    }),
    visualAnchor: z.object({
      primaryColor: ColorSpecSchema,
      secondaryColors: z.array(ColorSpecSchema).max(6),
      material: z.string().trim().min(1),
      silhouette: z.string().trim().min(1),
      brandMarking: BrandMarkingSpecSchema,
      distinctiveDetails: z.array(z.string().trim().min(1)).max(8),
      proportions: z.string().trim().min(1),
    }),
    sellingPoints: z.array(SellingPointSchema).min(1).max(4),
    brandTone: z.array(z.string().trim().min(1).max(6)).max(5),
    visualTaboos: z.array(z.string().trim().min(1)).max(6),
    anchorSentence: z.string().trim().min(1).max(60),
  })
  .superRefine((data, context) => {
    const priorities = data.sellingPoints.map((item) => item.priority);
    if (new Set(priorities).size !== priorities.length) {
      context.addIssue({
        code: "custom",
        path: ["sellingPoints"],
        message: "卖点优先级不能重复",
      });
    }
  });

export const ProductBriefSchema = z.object({
  name: z.string().trim().min(1, "请填写商品名称").max(120),
  sellingPoints: z
    .string()
    .trim()
    .min(1, "请填写至少一个核心卖点")
    .max(1200),
  brandTone: z.string().trim().min(1, "请填写品牌调性").max(600),
  targetMarkets: z
    .array(z.enum(SUPPORTED_MARKETS))
    .min(1, "请至少选择一个目标市场")
    .max(5)
    .refine(
      (markets) => new Set(markets).size === markets.length,
      "目标市场不能重复",
    ),
  platform: z.string().trim().min(1, "请填写投放平台").max(80),
  stylePreference: z.string().trim().min(1, "请填写风格倾向").max(300),
  materialHint: z.string().trim().max(300).optional().default(""),
});

export type ProductSpec = z.infer<typeof ProductSpecSchema>;
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

export function formatZodError(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("；");
}

export function parseProductFormData(formData: FormData) {
  const targetMarkets = [
    ...formData.getAll("targetMarkets"),
    ...formData.getAll("targetMarkets[]"),
  ].filter((value): value is string => typeof value === "string");

  const images = [
    ...formData.getAll("images"),
    ...formData.getAll("images[]"),
  ].filter((value): value is File => value instanceof File && value.size > 0);

  const brief = ProductBriefSchema.parse({
    name: formData.get("name"),
    sellingPoints: formData.get("sellingPoints"),
    brandTone: formData.get("brandTone"),
    targetMarkets,
    platform: formData.get("platform"),
    stylePreference: formData.get("stylePreference"),
    materialHint: formData.get("materialHint") ?? "",
  });

  if (images.length < 1 || images.length > 3) {
    throw new Error("请上传 1–3 张商品参考图");
  }

  for (const image of images) {
    if (
      !SUPPORTED_IMAGE_TYPES.includes(
        image.type as (typeof SUPPORTED_IMAGE_TYPES)[number],
      )
    ) {
      throw new Error("图片仅支持 JPEG、PNG 或 WebP");
    }
    if (image.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error("单张图片不能超过 10MB");
    }
  }

  return { brief, images };
}

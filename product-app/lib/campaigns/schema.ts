import { z } from "zod";
import { SUPPORTED_MARKETS } from "../products/schema.ts";

export const CAMPAIGN_IMAGE_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;

export const CAMPAIGN_IMAGE_QUALITIES = ["low", "medium", "high"] as const;

export const StoryboardShotSchema = z
  .object({
    sequence: z.number().int().min(1).max(4),
    durationSeconds: z.number().int().min(1).max(10),
    visual: z.string().trim().min(1),
    onScreenCopy: z.string().trim().min(1),
    onScreenCopyZh: z.string().trim().min(1),
    voiceover: z.string().trim().min(1),
    voiceoverZh: z.string().trim().min(1),
  })
  .strict();

export const MarketCreativeDraftSchema = z
  .object({
    market: z.enum(SUPPORTED_MARKETS),
    language: z.string().trim().min(1).max(80),
    localizationFocus: z.string().trim().min(1).max(500),
    complianceNote: z.string().trim().min(1).max(500),
    hook: z.string().trim().min(1).max(240),
    hookZh: z.string().trim().min(1).max(240),
    bodyCopy: z.string().trim().min(1).max(800),
    bodyCopyZh: z.string().trim().min(1).max(800),
    cta: z.string().trim().min(1).max(160),
    ctaZh: z.string().trim().min(1).max(160),
    storyboard: z.array(StoryboardShotSchema).min(3).max(4),
    imagePromptDraft: z.string().trim().min(1).max(6000),
  })
  .strict()
  .superRefine((creative, context) => {
    const placeholderPattern =
      /\bthe product\b|\[(?:the\s+)?product\]|<(?:the\s+)?product>/i;
    const userFacingCopy = [
      ["hook", creative.hook],
      ["hookZh", creative.hookZh],
      ["bodyCopy", creative.bodyCopy],
      ["bodyCopyZh", creative.bodyCopyZh],
      ["cta", creative.cta],
      ["ctaZh", creative.ctaZh],
      ...creative.storyboard.flatMap((shot, index) => [
        [`storyboard.${index}.onScreenCopy`, shot.onScreenCopy],
        [`storyboard.${index}.onScreenCopyZh`, shot.onScreenCopyZh],
        [`storyboard.${index}.voiceover`, shot.voiceover],
        [`storyboard.${index}.voiceoverZh`, shot.voiceoverZh],
      ]),
    ] as const;

    for (const [path, value] of userFacingCopy) {
      if (placeholderPattern.test(value)) {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: "面向用户的广告文案不能包含商品占位词",
        });
      }
    }

    if (
      /Chinese translation.{0,40}overlay|bilingual.{0,20}overlay|中文.{0,20}(叠加|画面|overlay)/i.test(
        creative.imagePromptDraft,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["imagePromptDraft"],
        message: "海外市场图片 Prompt 不能要求叠加中文审阅译文",
      });
    }

    const sequences = creative.storyboard.map((shot) => shot.sequence);
    const expected = creative.storyboard.map((_, index) => index + 1);
    if (sequences.some((value, index) => value !== expected[index])) {
      context.addIssue({
        code: "custom",
        path: ["storyboard"],
        message: "分镜必须从 1 连续编号",
      });
    }

    const duration = creative.storyboard.reduce(
      (total, shot) => total + shot.durationSeconds,
      0,
    );
    if (duration !== 15) {
      context.addIssue({
        code: "custom",
        path: ["storyboard"],
        message: "分镜总时长必须恰好为 15 秒",
      });
    }
  });

export const MarketCreativeDraftSetSchema = z
  .object({
    creatives: z.array(MarketCreativeDraftSchema).min(2).max(5),
  })
  .strict();

export const CampaignCreateSchema = z
  .object({
    productId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    targetMarkets: z
      .array(z.enum(SUPPORTED_MARKETS))
      .min(2, "请至少选择两个市场")
      .max(5)
      .refine(
        (markets) => new Set(markets).size === markets.length,
        "市场不能重复",
      ),
  })
  .strict();

export const CampaignGenerateSchema = z
  .object({
    marketsToGenerate: z
      .array(z.enum(SUPPORTED_MARKETS))
      .min(1, "请至少选择一个市场")
      .max(5)
      .refine(
        (markets) => new Set(markets).size === markets.length,
        "市场不能重复",
      ),
    size: z.enum(CAMPAIGN_IMAGE_SIZES).default("1024x1536"),
    quality: z.enum(CAMPAIGN_IMAGE_QUALITIES).default("medium"),
  })
  .strict();

export type StoryboardShot = z.infer<typeof StoryboardShotSchema>;
export type MarketCreativeDraft = z.infer<typeof MarketCreativeDraftSchema>;
export type CampaignCreateInput = z.infer<typeof CampaignCreateSchema>;
export type CampaignGenerateInput = z.infer<typeof CampaignGenerateSchema>;
export type CampaignImageSize = (typeof CAMPAIGN_IMAGE_SIZES)[number];
export type CampaignImageQuality =
  (typeof CAMPAIGN_IMAGE_QUALITIES)[number];

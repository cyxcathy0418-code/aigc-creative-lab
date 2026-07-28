import OpenAI from "openai";
import { z } from "zod";
import type { ProductSpec } from "../products/schema.ts";
import {
  buildAnchorBlock,
  buildCreativeDerivationPrompt,
  buildFinalImagePrompt,
  MARKET_LOCALIZATION_POLICIES,
} from "./prompt.ts";
import {
  MarketCreativeDraftSetSchema,
  type MarketCreativeDraft,
} from "./schema.ts";

export type DerivationUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CreativeDerivationRequest = {
  spec: ProductSpec;
  targetMarkets: Array<keyof typeof MARKET_LOCALIZATION_POLICIES>;
  platform: string;
  stylePreference: string;
  previousError?: string;
};

export interface CreativeDerivationProvider {
  readonly name: string;
  readonly model: string;
  derive(request: CreativeDerivationRequest): Promise<{
    rawOutput: string;
    parsed?: unknown;
    usage?: DerivationUsage;
  }>;
}

export type FinalizedMarketCreative = MarketCreativeDraft & {
  anchorBlock: string;
  imagePromptFinal: string;
};

export type CreativeDerivationResult = {
  creatives: FinalizedMarketCreative[];
  rawOutput: string;
  attempts: number;
  usage?: DerivationUsage;
};

export class CreativeDerivationError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "CreativeDerivationError";
    this.attempts = attempts;
  }
}

export class OpenAICreativeDerivationProvider
  implements CreativeDerivationProvider
{
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options?: { apiKey?: string; model?: string }) {
    const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY 尚未配置");
    }

    this.client = new OpenAI({ apiKey });
    this.model =
      options?.model ??
      process.env.OPENAI_CREATIVE_MODEL?.trim() ??
      process.env.OPENAI_MODEL?.trim() ??
      "gpt-5-mini";
  }

  async derive(request: CreativeDerivationRequest) {
    const prompt = buildCreativeDerivationPrompt(request);
    const schema = z.toJSONSchema(MarketCreativeDraftSetSchema, {
      target: "draft-7",
      unrepresentable: "any",
    });
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: 8000,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "brand_anchor_market_creatives",
          strict: true,
          schema,
        },
      },
    });

    if (!response.output_text) {
      throw new Error("模型没有返回可解析的市场创意");
    }

    return {
      rawOutput: response.output_text,
      parsed: JSON.parse(response.output_text),
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}

function finalizeCreatives(
  drafts: MarketCreativeDraft[],
  request: CreativeDerivationRequest,
) {
  const byMarket = new Map(drafts.map((creative) => [creative.market, creative]));
  if (byMarket.size !== drafts.length) {
    throw new Error("每个市场只能生成一套创意");
  }

  const missing = request.targetMarkets.filter((market) => !byMarket.has(market));
  const unexpected = drafts
    .map((creative) => creative.market)
    .filter((market) => !request.targetMarkets.includes(market));
  if (missing.length || unexpected.length) {
    throw new Error(
      `市场覆盖不一致：缺少 ${missing.join("、") || "无"}；额外 ${
        unexpected.join("、") || "无"
      }`,
    );
  }

  const anchorBlock = buildAnchorBlock(request.spec);
  return request.targetMarkets.map((market) => {
    const creative = byMarket.get(market);
    if (!creative) {
      throw new Error(`缺少 ${market} 创意`);
    }
    return {
      ...creative,
      anchorBlock,
      imagePromptFinal: buildFinalImagePrompt(
        anchorBlock,
        creative.imagePromptDraft,
      ),
    };
  });
}

export async function deriveMarketCreatives(
  request: Omit<CreativeDerivationRequest, "previousError">,
  provider: CreativeDerivationProvider = new OpenAICreativeDerivationProvider(),
  maxAttempts = Number(process.env.OPENAI_CREATIVE_MAX_ATTEMPTS ?? "2"),
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<CreativeDerivationResult> {
  const boundedAttempts = Math.max(1, Math.min(3, maxAttempts));
  let previousError = "";

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      const response = await provider.derive({
        ...request,
        previousError: previousError || undefined,
      });
      const parsed = MarketCreativeDraftSetSchema.parse(
        response.parsed ?? JSON.parse(response.rawOutput),
      );
      const creatives = finalizeCreatives(parsed.creatives, request);
      return {
        creatives,
        rawOutput: response.rawOutput,
        attempts: attempt,
        usage: response.usage,
      };
    } catch (error) {
      previousError =
        error instanceof Error ? error.message : "未知的市场创意派生错误";
      if (attempt < boundedAttempts) {
        await sleep(Math.min(2 ** (attempt - 1), 6) * 1000);
      }
    }
  }

  throw new CreativeDerivationError(
    `市场创意在 ${boundedAttempts} 次尝试后仍未通过：${previousError}`,
    boundedAttempts,
  );
}

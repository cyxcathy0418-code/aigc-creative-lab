import OpenAI from "openai";
import { z } from "zod";
import { buildSpecExtractorPrompt } from "./prompt.ts";
import {
  formatZodError,
  ProductSpecSchema,
  type ProductBrief,
  type ProductSpec,
} from "./schema.ts";

export type ProductImageInput = {
  mimeType: string;
  bytes: Uint8Array;
};

export type ExtractionResult = {
  spec: ProductSpec;
  rawOutput: string;
  attempts: number;
};

export type SpecExtractionRequest = {
  brief: ProductBrief;
  images: ProductImageInput[];
  previousError?: string;
};

export interface SpecExtractionProvider {
  extract(request: SpecExtractionRequest): Promise<{
    rawOutput: string;
    parsed?: unknown;
  }>;
}

export class SpecExtractionError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "SpecExtractionError";
    this.attempts = attempts;
  }
}

export class OpenAISpecExtractionProvider implements SpecExtractionProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY 尚未配置");
    }

    this.client = new OpenAI({ apiKey });
    this.model = options?.model ?? process.env.OPENAI_MODEL?.trim() ?? "gpt-5-mini";
  }

  async extract(request: SpecExtractionRequest) {
    const prompt = buildSpecExtractorPrompt(
      request.brief,
      request.previousError,
    );
    const jsonSchema = z.toJSONSchema(ProductSpecSchema, {
      target: "draft-7",
      unrepresentable: "any",
    });

    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: 2500,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...request.images.map((image) => ({
              type: "input_image" as const,
              image_url: `data:${image.mimeType};base64,${Buffer.from(
                image.bytes,
              ).toString("base64")}`,
              detail: "high" as const,
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "brand_anchor_product_spec",
          strict: true,
          schema: jsonSchema,
        },
      },
    });

    const rawOutput = response.output_text;
    if (!rawOutput) {
      throw new Error("模型没有返回可解析的 Spec");
    }

    return {
      rawOutput,
      parsed: JSON.parse(rawOutput),
    };
  }
}

export async function extractProductSpec(
  request: Omit<SpecExtractionRequest, "previousError">,
  provider: SpecExtractionProvider = new OpenAISpecExtractionProvider(),
  maxAttempts = 3,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<ExtractionResult> {
  let previousError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await provider.extract({
        ...request,
        previousError: previousError || undefined,
      });
      const parsed =
        result.parsed ??
        (result.rawOutput ? JSON.parse(result.rawOutput) : undefined);
      const validated = ProductSpecSchema.safeParse(parsed);

      if (!validated.success) {
        previousError = formatZodError(validated.error);
        throw new Error(previousError);
      }

      return {
        spec: validated.data,
        rawOutput: result.rawOutput,
        attempts: attempt,
      };
    } catch (error) {
      previousError =
        error instanceof Error ? error.message : "未知的 Spec 抽取错误";
      if (attempt < maxAttempts) {
        await sleep(Math.min(2 ** (attempt - 1), 6) * 1000);
      }
    }
  }

  throw new SpecExtractionError(
    `Spec 抽取在 ${maxAttempts} 次尝试后仍未通过：${previousError}`,
    maxAttempts,
  );
}

import OpenAI, { toFile } from "openai";
import type {
  CampaignImageQuality,
  CampaignImageSize,
} from "../campaigns/schema.ts";

export type GenerationRequest = {
  prompt: string;
  market: string;
  size: CampaignImageSize;
  quality: CampaignImageQuality;
  referenceImages: Array<{
    bytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    fileName: string;
  }>;
  endUserId?: string;
};

export type GenerationResult = {
  bytes: Uint8Array;
  mimeType: "image/webp";
  width: number;
  height: number;
  usage?: {
    inputTokens: number;
    inputImageTokens: number;
    inputTextTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export interface GenerationProvider {
  readonly name: string;
  readonly model: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export class OpenAIImageGenerationProvider implements GenerationProvider {
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
      process.env.OPENAI_IMAGE_MODEL?.trim() ??
      "gpt-image-2";
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!request.referenceImages.length) {
      throw new Error("参考图不能为空");
    }

    const images = await Promise.all(
      request.referenceImages.map((image) =>
        toFile(image.bytes, image.fileName, { type: image.mimeType }),
      ),
    );
    const response = await this.client.images.edit({
      model: this.model,
      image: images,
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      output_format: "webp",
      output_compression: 92,
      background: "opaque",
      n: 1,
      user: request.endUserId,
    });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) {
      throw new Error("图像模型没有返回图片");
    }

    const [width, height] = request.size.split("x").map(Number);
    const usage = response.usage;
    return {
      bytes: new Uint8Array(Buffer.from(encoded, "base64")),
      mimeType: "image/webp",
      width,
      height,
      usage: usage
        ? {
            inputTokens: usage.input_tokens,
            inputImageTokens: usage.input_tokens_details.image_tokens,
            inputTextTokens: usage.input_tokens_details.text_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
    };
  }
}

export class ImageGenerationError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "ImageGenerationError";
    this.attempts = attempts;
  }
}

export async function generateImageWithRetries(
  request: GenerationRequest,
  provider: GenerationProvider = new OpenAIImageGenerationProvider(),
  maxAttempts = Number(process.env.OPENAI_IMAGE_MAX_ATTEMPTS ?? "1"),
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const boundedAttempts = Math.max(1, Math.min(3, maxAttempts));
  let lastError = "";

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      const result = await provider.generate(request);
      return { result, attempts: attempt };
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "未知的图像生成错误";
      if (attempt < boundedAttempts) {
        await sleep(Math.min(2 ** (attempt - 1), 6) * 1000);
      }
    }
  }

  throw new ImageGenerationError(
    `图片生成在 ${boundedAttempts} 次尝试后失败：${lastError}`,
    boundedAttempts,
  );
}

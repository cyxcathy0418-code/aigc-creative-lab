import { NextResponse } from "next/server";
import { z } from "zod";
import { CampaignGenerateSchema } from "@/lib/campaigns/schema";
import {
  generateImageWithRetries,
  ImageGenerationError,
  OpenAIImageGenerationProvider,
} from "@/lib/generation/provider";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorResponse(message: string, status: number, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return errorResponse("Supabase 尚未配置", 503);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAuthorizedProductUser(user)) {
    return errorResponse("请先登录", 401);
  }

  let input: z.infer<typeof CampaignGenerateSchema>;
  try {
    input = CampaignGenerateSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("；")
        : "生成参数格式不正确";
    return errorResponse(message, 400);
  }

  if (process.env.OPENAI_IMAGE_GENERATION_ENABLED !== "true") {
    return errorResponse(
      "真实图片生成尚未启用，以避免产生 OpenAI 费用。确认单张费用后再开启。",
      503,
    );
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return errorResponse("OPENAI_API_KEY 尚未配置", 503);
  }

  const { id } = await params;
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,product_id,status,target_markets")
    .eq("id", id)
    .single();
  if (campaignError || !campaign) {
    return errorResponse("未找到该创意任务", 404);
  }
  if (!["creatives_ready", "completed", "failed"].includes(campaign.status)) {
    return errorResponse("市场创意尚未准备好", 409);
  }

  const { data: creatives, error: creativeError } = await supabase
    .from("market_creatives")
    .select("id,market,image_prompt_final")
    .eq("campaign_id", id)
    .in("market", input.marketsToGenerate);
  if (creativeError || !creatives) {
    return errorResponse("无法读取市场创意", 500);
  }
  if (creatives.length !== input.marketsToGenerate.length) {
    return errorResponse("部分所选市场没有可用创意", 400);
  }

  const { data: imageRecords, error: imageError } = await supabase
    .from("product_reference_images")
    .select("id,object_path,file_name,mime_type,sort_order")
    .eq("product_id", campaign.product_id)
    .order("sort_order");
  if (imageError || !imageRecords?.length) {
    return errorResponse("该商品没有可用的参考图", 409);
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";
  const referenceImages = [];
  for (const image of imageRecords) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(image.object_path);
    if (error || !data) {
      return errorResponse("无法读取商品参考图", 500);
    }
    referenceImages.push({
      bytes: new Uint8Array(await data.arrayBuffer()),
      mimeType: image.mime_type as "image/jpeg" | "image/png" | "image/webp",
      fileName: image.file_name,
    });
  }

  const provider = new OpenAIImageGenerationProvider();
  await supabase
    .from("campaigns")
    .update({ status: "generating" })
    .eq("id", id);

  const results: Array<{
    market: string;
    status: "completed" | "failed";
    assetId?: string;
    error?: string;
  }> = [];

  for (const market of input.marketsToGenerate) {
    const creative = creatives.find((item) => item.market === market);
    if (!creative) continue;

    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .insert({
        campaign_id: id,
        creative_id: creative.id,
        provider: provider.name,
        model: provider.model,
        size: input.size,
        quality: input.quality,
        status: "generating",
        reference_image_ids: imageRecords.map((image) => image.id),
        prompt_snapshot: creative.image_prompt_final,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      results.push({
        market,
        status: "failed",
        error: "无法创建生成记录",
      });
      continue;
    }

    try {
      const { result, attempts } = await generateImageWithRetries(
        {
          prompt: creative.image_prompt_final,
          market,
          size: input.size,
          quality: input.quality,
          referenceImages,
          endUserId: user.id,
        },
        provider,
      );
      const objectPath = `${user.id}/${campaign.product_id}/campaigns/${id}/${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(objectPath, result.bytes, {
          contentType: result.mimeType,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) {
        throw new Error("图片已生成，但保存到私有存储失败");
      }

      const { data: asset, error: assetError } = await supabase
        .from("generated_assets")
        .insert({
          job_id: job.id,
          campaign_id: id,
          creative_id: creative.id,
          object_path: objectPath,
          mime_type: result.mimeType,
          size_bytes: result.bytes.byteLength,
          width: result.width,
          height: result.height,
        })
        .select("id")
        .single();
      if (assetError || !asset) {
        await supabase.storage.from(bucket).remove([objectPath]);
        throw new Error("图片已生成，但资产记录保存失败");
      }

      await supabase
        .from("generation_jobs")
        .update({
          status: "completed",
          attempt_count: attempts,
          usage: result.usage ?? null,
          error_message: null,
        })
        .eq("id", job.id);
      results.push({ market, status: "completed", assetId: asset.id });
    } catch (error) {
      const attempts = error instanceof ImageGenerationError ? error.attempts : 0;
      const message =
        error instanceof Error ? error.message : "图片生成失败";
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          attempt_count: attempts,
          error_message: message.slice(0, 2000),
        })
        .eq("id", job.id);
      results.push({ market, status: "failed", error: message });
    }
  }

  const completed = results.filter((result) => result.status === "completed");
  await supabase
    .from("campaigns")
    .update({ status: completed.length ? "completed" : "failed" })
    .eq("id", id);

  if (!completed.length) {
    return errorResponse("所选市场均未生成成功，未创建任何资产。", 502, {
      results,
    });
  }

  return NextResponse.json(
    {
      campaignId: id,
      completed: completed.length,
      failed: results.length - completed.length,
      results,
    },
    { status: completed.length === results.length ? 201 : 207 },
  );
}


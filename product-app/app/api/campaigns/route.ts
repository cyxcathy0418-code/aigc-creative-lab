import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CreativeDerivationError,
  deriveMarketCreatives,
  OpenAICreativeDerivationProvider,
} from "@/lib/campaigns/derivation";
import { CampaignCreateSchema } from "@/lib/campaigns/schema";
import { ProductSpecSchema } from "@/lib/products/schema";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorResponse(message: string, status: number, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(request: Request) {
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

  let input: z.infer<typeof CampaignCreateSchema>;
  try {
    input = CampaignCreateSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("；")
        : "创意任务信息格式不正确";
    return errorResponse(message, 400);
  }

  if (process.env.OPENAI_CREATIVE_DERIVATION_ENABLED !== "true") {
    return errorResponse(
      "真实市场创意派生尚未启用，以避免产生 OpenAI 费用。确认费用后再开启。",
      503,
    );
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return errorResponse("OPENAI_API_KEY 尚未配置", 503);
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select(
      "id,platform,style_preference,status,product_specs(spec,version)",
    )
    .eq("id", input.productId)
    .single();
  if (productError || !product) {
    return errorResponse("未找到该商品", 404);
  }

  const specRelation = product.product_specs;
  const specRecord = Array.isArray(specRelation)
    ? specRelation[0]
    : specRelation;
  const parsedSpec = ProductSpecSchema.safeParse(specRecord?.spec);
  if (!parsedSpec.success || product.status !== "ready") {
    return errorResponse("请先确认并保存商品 Spec", 409);
  }

  const provider = new OpenAICreativeDerivationProvider();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      product_id: product.id,
      name: input.name,
      target_markets: input.targetMarkets,
      platform: product.platform,
      style_preference: product.style_preference,
      spec_version: specRecord.version,
      status: "deriving",
      derivation_model: provider.model,
    })
    .select("id")
    .single();
  if (campaignError || !campaign) {
    return errorResponse(
      "无法创建创意任务。请先确认 Phase 2 数据库迁移已经应用。",
      500,
    );
  }

  try {
    const derivation = await deriveMarketCreatives(
      {
        spec: parsedSpec.data,
        targetMarkets: input.targetMarkets,
        platform: product.platform,
        stylePreference: product.style_preference,
      },
      provider,
    );
    const { data: creatives, error: creativeError } = await supabase
      .from("market_creatives")
      .insert(
        derivation.creatives.map((creative) => ({
          campaign_id: campaign.id,
          market: creative.market,
          language: creative.language,
          content: {
            market: creative.market,
            language: creative.language,
            localizationFocus: creative.localizationFocus,
            complianceNote: creative.complianceNote,
            hook: creative.hook,
            hookZh: creative.hookZh,
            bodyCopy: creative.bodyCopy,
            bodyCopyZh: creative.bodyCopyZh,
            cta: creative.cta,
            ctaZh: creative.ctaZh,
            storyboard: creative.storyboard,
            imagePromptDraft: creative.imagePromptDraft,
          },
          image_prompt_final: creative.imagePromptFinal,
          anchor_block: creative.anchorBlock,
        })),
      )
      .select("id,market");

    if (creativeError || !creatives) {
      throw new Error("创意已生成，但保存失败");
    }

    await supabase
      .from("campaigns")
      .update({
        status: "creatives_ready",
        derivation_attempts: derivation.attempts,
        derivation_error: null,
        derivation_usage: derivation.usage ?? null,
      })
      .eq("id", campaign.id);

    return NextResponse.json(
      {
        campaignId: campaign.id,
        creativeCount: creatives.length,
        markets: creatives.map((creative) => creative.market),
        derivationAttempts: derivation.attempts,
      },
      { status: 201 },
    );
  } catch (error) {
    const attempts =
      error instanceof CreativeDerivationError ? error.attempts : 0;
    const message =
      error instanceof Error ? error.message : "市场创意派生失败";
    await supabase
      .from("campaigns")
      .update({
        status: "failed",
        derivation_attempts: attempts,
        derivation_error: message.slice(0, 2000),
      })
      .eq("id", campaign.id);

    return errorResponse(message, attempts ? 502 : 500, {
      campaignId: campaign.id,
      derivationAttempts: attempts,
    });
  }
}


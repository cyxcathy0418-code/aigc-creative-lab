import { NextResponse } from "next/server";
import { z } from "zod";
import {
  formatZodError,
  type ProductBrief,
} from "@/lib/products/schema";
import {
  extractProductSpec,
  SpecExtractionError,
} from "@/lib/products/extractor";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { saveProductSpec, SpecSaveError } from "@/lib/products/spec-save";

function errorResponse(message: string, status: number, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(
  _request: Request,
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

  if (process.env.OPENAI_SPEC_EXTRACTION_ENABLED !== "true") {
    return errorResponse(
      "真实 Spec 抽取尚未启用，以避免产生 OpenAI 费用。确认费用后再开启。",
      503,
    );
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return errorResponse("OPENAI_API_KEY 尚未配置", 503);
  }

  const { id } = await params;
  const { data: product, error: productError } = await supabase
    .from("products")
    .select(
      "id,name,status,selling_points_input,brand_tone_input,target_markets,platform,style_preference,material_hint,product_reference_images(object_path,mime_type,sort_order),product_specs(id)",
    )
    .eq("id", id)
    .single();

  if (productError || !product) {
    return errorResponse("未找到该商品", 404);
  }

  const existingSpecs = product.product_specs;
  if (
    (Array.isArray(existingSpecs) && existingSpecs.length > 0) ||
    (!Array.isArray(existingSpecs) && Boolean(existingSpecs))
  ) {
    return errorResponse("该商品已经存在可编辑的 Spec", 409);
  }

  const imageRecords = [...(product.product_reference_images ?? [])].sort(
    (left, right) => left.sort_order - right.sort_order,
  );
  if (!imageRecords.length) {
    return errorResponse("该商品没有可用于重试的参考图", 400);
  }

  const brief: ProductBrief = {
    name: product.name,
    sellingPoints: product.selling_points_input,
    brandTone: product.brand_tone_input,
    targetMarkets: product.target_markets,
    platform: product.platform,
    stylePreference: product.style_preference,
    materialHint: product.material_hint ?? "",
  };
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";

  await supabase
    .from("products")
    .update({
      status: "extracting",
      extraction_attempts: 0,
      extraction_error: null,
    })
    .eq("id", id);

  try {
    const imageInputs = [];
    for (const image of imageRecords) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(image.object_path);
      if (error || !data) {
        throw new Error("无法读取已保存的商品参考图");
      }
      imageInputs.push({
        mimeType: image.mime_type,
        bytes: new Uint8Array(await data.arrayBuffer()),
      });
    }

    const extraction = await extractProductSpec({
      brief,
      images: imageInputs,
    });

    const { error: specError } = await supabase.from("product_specs").insert({
      product_id: id,
      spec: extraction.spec,
      raw_extraction_output: extraction.rawOutput,
    });
    if (specError) {
      throw new Error("Spec 已抽取，但保存失败");
    }

    await supabase
      .from("products")
      .update({
        status: "ready",
        extraction_attempts: extraction.attempts,
        extraction_error: null,
      })
      .eq("id", id);

    return NextResponse.json({
      productId: id,
      spec: extraction.spec,
      extractionAttempts: extraction.attempts,
    });
  } catch (error) {
    const attempts = error instanceof SpecExtractionError ? error.attempts : 0;
    const message =
      error instanceof Error ? error.message : "Spec 重试过程中发生未知错误";

    await supabase
      .from("products")
      .update({
        status: "failed",
        extraction_attempts: attempts,
        extraction_error: message.slice(0, 2000),
      })
      .eq("id", id);

    return errorResponse(message, attempts ? 502 : 500, {
      productId: id,
      extractionAttempts: attempts,
    });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase 尚未配置" },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAuthorizedProductUser(user)) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  try {
    return NextResponse.json(await saveProductSpec(supabase, id, await request.json()));
  } catch (error) {
    if (error instanceof SpecSaveError) return errorResponse(error.message, error.status);
    const message = error instanceof z.ZodError ? formatZodError(error) : "提交的 Spec 格式不正确";
    return errorResponse(message, 400);
  }
}

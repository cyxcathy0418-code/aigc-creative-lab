import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import {
  extractProductSpec,
  SpecExtractionError,
} from "@/lib/products/extractor";
import {
  formatZodError,
  parseProductFormData,
} from "@/lib/products/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET() {
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

  const { data, error } = await supabase
    .from("products")
    .select(
      "id,name,status,extraction_attempts,extraction_error,target_markets,platform,updated_at,product_reference_images(id,object_path,is_primary,sort_order)",
    )
    .order("updated_at", { ascending: false });

  if (error) {
    return errorResponse("暂时无法读取商品列表", 500);
  }

  return NextResponse.json({ products: data ?? [] });
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

  let parsedForm: ReturnType<typeof parseProductFormData>;
  try {
    parsedForm = parseProductFormData(await request.formData());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? formatZodError(error)
        : error instanceof Error
          ? error.message
          : "商品信息格式不正确";
    return errorResponse(message, 400);
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

  const { brief, images } = parsedForm;
  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({
      user_id: user.id,
      name: brief.name,
      selling_points_input: brief.sellingPoints,
      brand_tone_input: brief.brandTone,
      target_markets: brief.targetMarkets,
      platform: brief.platform,
      style_preference: brief.stylePreference,
      material_hint: brief.materialHint || null,
      status: "extracting",
    })
    .select("id")
    .single();

  if (productError || !product) {
    return errorResponse("无法创建商品档案，请稍后重试", 500);
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";
  const uploadedPaths: string[] = [];

  try {
    const imageInputs = [];
    for (const [index, file] of images.entries()) {
      const extension =
        file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : "jpg";
      const objectPath = `${user.id}/${product.id}/${crypto.randomUUID()}.${extension}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(objectPath, bytes, {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`第 ${index + 1} 张图片上传失败`);
      }

      uploadedPaths.push(objectPath);
      const { error: metadataError } = await supabase
        .from("product_reference_images")
        .insert({
          product_id: product.id,
          object_path: objectPath,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          is_primary: index === 0,
          sort_order: index,
        });

      if (metadataError) {
        throw new Error(`第 ${index + 1} 张图片记录保存失败`);
      }

      imageInputs.push({ mimeType: file.type, bytes });
    }

    const extraction = await extractProductSpec({
      brief,
      images: imageInputs,
    });

    const { error: specError } = await supabase.from("product_specs").insert({
      product_id: product.id,
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
      .eq("id", product.id);

    return NextResponse.json(
      {
        productId: product.id,
        spec: extraction.spec,
        extractionAttempts: extraction.attempts,
      },
      { status: 201 },
    );
  } catch (error) {
    const attempts = error instanceof SpecExtractionError ? error.attempts : 0;
    const message =
      error instanceof Error ? error.message : "商品创建过程中发生未知错误";

    if (attempts === 0) {
      if (uploadedPaths.length) {
        await supabase.storage.from(bucket).remove(uploadedPaths);
      }
      await supabase.from("products").delete().eq("id", product.id);
      return errorResponse(message, 500);
    }

    await supabase
      .from("products")
      .update({
        status: "failed",
        extraction_attempts: attempts,
        extraction_error: message.slice(0, 2000),
      })
      .eq("id", product.id);

    return errorResponse(message, 502, {
      productId: product.id,
      extractionAttempts: attempts,
    });
  }
}

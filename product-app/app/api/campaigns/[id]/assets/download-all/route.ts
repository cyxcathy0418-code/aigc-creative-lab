import { NextResponse } from "next/server";
import { buildZipArchive, type ZipEntry } from "@/lib/generation/zipArchive";
import { MARKET_FILE_CODES } from "@/lib/products/schema";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function extensionFor(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "webp";
}

function sanitizeForFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "").trim() || "asset";
}

export async function GET(
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

  const { id } = await params;
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,products(name)")
    .eq("id", id)
    .single();
  if (campaignError || !campaign) {
    return errorResponse("未找到该创意任务", 404);
  }

  const { data: assets, error: assetError } = await supabase
    .from("generated_assets")
    .select("object_path,mime_type,market_creatives(market)")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  if (assetError) {
    return errorResponse("暂时无法读取生成资产", 500);
  }
  if (!assets?.length) {
    return errorResponse("该创意任务还没有已生成的图片", 404);
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";
  const productRelation = campaign.products;
  const product = Array.isArray(productRelation)
    ? productRelation[0]
    : productRelation;
  const productName = sanitizeForFilename(product?.name ?? "product");

  const usedNames = new Map<string, number>();
  const entries: ZipEntry[] = [];

  for (const asset of assets) {
    const creativeRelation = asset.market_creatives;
    const creative = Array.isArray(creativeRelation)
      ? creativeRelation[0]
      : creativeRelation;
    const marketLabel = creative?.market;
    const market =
      MARKET_FILE_CODES[marketLabel as keyof typeof MARKET_FILE_CODES] ??
      "asset";

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(asset.object_path);
    if (error || !data) {
      return errorResponse("无法读取部分生成图片，请稍后重试", 500);
    }

    const occurrence = usedNames.get(market) ?? 0;
    usedNames.set(market, occurrence + 1);
    const suffix = occurrence > 0 ? `-${occurrence + 1}` : "";
    const name = `${market}${suffix}.${extensionFor(asset.mime_type)}`;

    entries.push({
      name,
      bytes: new Uint8Array(await data.arrayBuffer()),
    });
  }

  const zip = buildZipArchive(entries);
  const fileName = `${productName}-${sanitizeForFilename(campaign.name)}.zip`;
  const asciiFallback = /^[\x20-\x7e]+$/.test(fileName)
    ? fileName
    : "brand-anchor-assets.zip";

  return new NextResponse(Buffer.from(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(zip.byteLength),
    },
  });
}

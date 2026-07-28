import { NextResponse } from "next/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 3;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

  const { id } = await params;
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", id)
    .single();
  if (productError || !product) {
    return errorResponse("未找到该商品", 404);
  }

  const { data: existingImages, error: existingError } = await supabase
    .from("product_reference_images")
    .select("id,sort_order")
    .eq("product_id", id)
    .order("sort_order");
  if (existingError) {
    return errorResponse("无法读取商品参考图", 500);
  }

  const formData = await request.formData();
  const files = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File);
  const remainingSlots =
    MAX_REFERENCE_IMAGES - (existingImages?.length ?? 0);

  if (!files.length) {
    return errorResponse("请至少选择一张商品参考图", 400);
  }
  if (remainingSlots < 1 || files.length > remainingSlots) {
    return errorResponse(`商品参考图最多 ${MAX_REFERENCE_IMAGES} 张`, 400);
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return errorResponse("仅支持 JPEG、PNG 或 WebP 图片", 400);
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      return errorResponse("单张图片大小必须在 10MB 以内", 400);
    }
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";
  const uploadedPaths: string[] = [];
  const insertedIds: string[] = [];
  const existingCount = existingImages?.length ?? 0;

  try {
    for (const [index, file] of files.entries()) {
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
        throw new Error("商品参考图上传失败");
      }
      uploadedPaths.push(objectPath);

      const { data: image, error: metadataError } = await supabase
        .from("product_reference_images")
        .insert({
          product_id: product.id,
          object_path: objectPath,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          is_primary: existingCount === 0 && index === 0,
          sort_order: existingCount + index,
        })
        .select("id")
        .single();
      if (metadataError || !image) {
        throw new Error("商品参考图记录保存失败");
      }
      insertedIds.push(image.id);
    }

    return NextResponse.json(
      { uploaded: insertedIds.length },
      { status: 201 },
    );
  } catch (error) {
    if (insertedIds.length) {
      await supabase
        .from("product_reference_images")
        .delete()
        .in("id", insertedIds);
    }
    if (uploadedPaths.length) {
      await supabase.storage.from(bucket).remove(uploadedPaths);
    }

    return errorResponse(
      error instanceof Error ? error.message : "商品参考图上传失败",
      500,
    );
  }
}

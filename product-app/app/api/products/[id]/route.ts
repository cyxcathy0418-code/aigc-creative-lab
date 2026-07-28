import { NextResponse } from "next/server";
import { addSignedImageUrls } from "@/lib/products/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
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
  const { data: product, error } = await supabase
    .from("products")
    .select(
      "*,product_reference_images(*),product_specs(product_id,spec,version,updated_at)",
    )
    .eq("id", id)
    .single();

  if (error || !product) {
    return NextResponse.json({ error: "未找到该商品" }, { status: 404 });
  }

  const images = await addSignedImageUrls(
    supabase,
    product.product_reference_images ?? [],
  );

  return NextResponse.json({
    product: {
      ...product,
      product_reference_images: images,
      product_spec: product.product_specs?.[0] ?? null,
    },
  });
}

import { NextResponse } from "next/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  const { data: jobs, error } = await supabase
    .from("generation_jobs")
    .select(
      "id,status,provider,model,size,quality,attempt_count,usage,error_message,created_at,market_creatives(market),generated_assets(id,object_path,mime_type,width,height,created_at)",
    )
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: "暂时无法读取生成资产" },
      { status: 500 },
    );
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";
  const signedJobs = await Promise.all(
    (jobs ?? []).map(async (job) => {
      const assetRelation = job.generated_assets;
      const asset = Array.isArray(assetRelation)
        ? assetRelation[0]
        : assetRelation;
      if (!asset?.object_path) return { ...job, asset: null };
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrl(asset.object_path, 60 * 60);
      return {
        ...job,
        asset: { ...asset, signedUrl: data?.signedUrl ?? null },
      };
    }),
  );

  return NextResponse.json({ jobs: signedJobs });
}

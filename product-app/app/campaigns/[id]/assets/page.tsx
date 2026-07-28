import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { addSignedImageUrls } from "@/lib/products/data";
import { MARKET_FILE_CODES } from "@/lib/products/schema";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "生成资产",
};

export const dynamic = "force-dynamic";

function estimateImageCost(model: string, usage: unknown) {
  if (
    model !== "gpt-image-2" ||
    !usage ||
    typeof usage !== "object" ||
    Array.isArray(usage)
  ) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const inputTextTokens = Number(record.inputTextTokens ?? 0);
  const inputImageTokens = Number(record.inputImageTokens ?? 0);
  const outputTokens = Number(record.outputTokens ?? 0);
  if (
    !Number.isFinite(inputTextTokens) ||
    !Number.isFinite(inputImageTokens) ||
    !Number.isFinite(outputTokens)
  ) {
    return null;
  }

  return (
    (inputTextTokens * 5 +
      inputImageTokens * 8 +
      outputTokens * 30) /
    1_000_000
  );
}

export default async function CampaignAssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  if (!supabase || !isAuthorizedProductUser(user)) {
    redirect("/login");
  }

  const { id } = await params;
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id,name,product_id,status,products(name,product_reference_images(*))")
    .eq("id", id)
    .single();
  if (error || !campaign) {
    notFound();
  }

  const productRelation = campaign.products;
  const product = Array.isArray(productRelation)
    ? productRelation[0]
    : productRelation;
  const referenceImages = await addSignedImageUrls(
    supabase,
    product?.product_reference_images ?? [],
  );
  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select(
      "id,status,provider,model,size,quality,attempt_count,usage,error_message,created_at,market_creatives(market),generated_assets(id,object_path,mime_type,width,height,created_at)",
    )
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets";
  const preparedJobs = await Promise.all(
    (jobs ?? []).map(async (job) => {
      const creativeRelation = job.market_creatives;
      const creative = Array.isArray(creativeRelation)
        ? creativeRelation[0]
        : creativeRelation;
      const assetRelation = job.generated_assets;
      const asset = Array.isArray(assetRelation)
        ? assetRelation[0]
        : assetRelation;
      const market = creative?.market ?? "未知市场";
      const marketCode =
        MARKET_FILE_CODES[market as keyof typeof MARKET_FILE_CODES] ??
        "asset";
      const extension = asset?.mime_type === "image/png" ? "png" : "webp";
      const { data } = asset
        ? await supabase.storage
            .from(bucket)
            .createSignedUrl(asset.object_path, 60 * 60, {
              download: `${marketCode}.${extension}`,
            })
        : { data: null };
      return {
        ...job,
        market,
        asset,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
  const hasCompletedAssets = preparedJobs.some((job) => job.signedUrl);

  return (
    <main className="dashboard-shell">
      <WorkspaceHeader email={user.email} />
      <div className="dashboard-main product-flow">
        <div className="flow-heading asset-heading">
          <div>
            <p className="section-kicker">05 / GENERATED ASSETS</p>
            <h1>Reference in. Campaign out.</h1>
            <p>
              {campaign.name}。左侧始终是原始商品参考，右侧是各市场生成结果，方便直接检查商品有没有被画错。
            </p>
          </div>
          <div className="asset-heading-actions">
            {hasCompletedAssets ? (
              <a
                className="button button-dark"
                href={`/api/campaigns/${id}/assets/download-all`}
              >
                打包下载全部
              </a>
            ) : null}
            <Link className="text-link" href={`/campaigns/${id}/creatives`}>
              ← 返回市场创意
            </Link>
          </div>
        </div>

        {preparedJobs.length ? (
          <section className="asset-comparison-list">
            {preparedJobs.map((job) => (
              <article className="asset-comparison" key={job.id}>
                <header>
                  <div>
                    <span>{job.market}</span>
                    <strong>{job.status === "completed" ? "已生成" : "生成失败"}</strong>
                  </div>
                  <small>
                    {job.size} · {job.quality} · {job.model} ·{" "}
                    {job.attempt_count} attempt
                    {job.usage &&
                    typeof job.usage === "object" &&
                    "totalTokens" in job.usage
                      ? ` · ${String(job.usage.totalTokens)} tokens`
                      : ""}
                    {estimateImageCost(job.model, job.usage) !== null
                      ? ` · ~$${estimateImageCost(job.model, job.usage)?.toFixed(4)}`
                      : ""}
                  </small>
                </header>
                <div className="asset-pair">
                  <figure>
                    {referenceImages[0]?.signedUrl ? (
                      <Image
                        src={referenceImages[0].signedUrl}
                        alt={`${product?.name ?? "商品"} 原始参考图`}
                        fill
                        unoptimized
                      />
                    ) : null}
                    <figcaption>SOURCE / 原始参考</figcaption>
                  </figure>
                  <figure data-status={job.status}>
                    {job.signedUrl ? (
                      <Image
                        src={job.signedUrl}
                        alt={`${job.market} 广告生成结果`}
                        fill
                        unoptimized
                      />
                    ) : (
                      <div className="asset-failure">
                        <strong>没有生成资产</strong>
                        <p>{job.error_message ?? "生成任务没有返回图片。"}</p>
                      </div>
                    )}
                    <figcaption>
                      OUTPUT / {job.market}
                      {job.signedUrl ? (
                        <a
                          className="text-link asset-download-link"
                          href={job.signedUrl}
                        >
                          下载
                        </a>
                      ) : null}
                    </figcaption>
                  </figure>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="asset-empty">
            <span>NO GENERATION YET</span>
            <h2>先用一个市场验证商品一致性。</h2>
            <p>
              这里不会用占位图冒充结果。完成一次真实参考图生成后，原图和结果会并排出现。
            </p>
            <Link className="button button-dark" href={`/campaigns/${id}/creatives`}>
              选择第一个市场 <span aria-hidden="true">→</span>
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}

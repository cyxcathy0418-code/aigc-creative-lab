import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { MarketCreativeDraftSchema } from "@/lib/campaigns/schema";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { GenerationPanel } from "./GenerationPanel";

export const metadata: Metadata = {
  title: "市场创意",
};

export const dynamic = "force-dynamic";

export default async function CampaignCreativesPage({
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
    .select("id,name,product_id,status,target_markets,platform,spec_version,products(name)")
    .eq("id", id)
    .single();
  if (error || !campaign) {
    notFound();
  }

  const { data: creativeRows } = await supabase
    .from("market_creatives")
    .select("id,market,language,content,image_prompt_final")
    .eq("campaign_id", id);
  const creativeParseResults = (creativeRows ?? []).map((row) => ({
    row,
    parsed: MarketCreativeDraftSchema.safeParse(row.content),
  }));
  creativeParseResults.forEach(({ row, parsed }) => {
    if (!parsed.success) {
      console.error("Stored market creative failed validation", {
        creativeId: row.id,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
  });
  const parsedCreatives = creativeParseResults
    .filter((entry) => entry.parsed.success)
    .sort(
      (left, right) =>
        campaign.target_markets.indexOf(left.row.market) -
        campaign.target_markets.indexOf(right.row.market),
    );
  const productRelation = campaign.products;
  const product = Array.isArray(productRelation)
    ? productRelation[0]
    : productRelation;

  return (
    <main className="dashboard-shell">
      <WorkspaceHeader email={user.email} />
      <div className="dashboard-main product-flow">
        <div className="flow-heading creative-heading">
          <div>
            <p className="section-kicker">04 / CREATIVE ROUTES</p>
            <h1>{campaign.name}</h1>
            <p>
              {product?.name ?? "商品"} · {campaign.platform} · Spec v
              {campaign.spec_version}。先检查市场差异，再决定生成哪一张。
            </p>
          </div>
          <div className="heading-links">
            <Link
              className="text-link"
              href={`/products/${campaign.product_id}/campaigns/new`}
            >
              新建另一轮
            </Link>
            <Link className="text-link" href={`/campaigns/${id}/assets`}>
              查看生成资产 →
            </Link>
          </div>
        </div>

        {!parsedCreatives.length ? (
          <section className="spec-error">
            <span>CAMPAIGN {campaign.status.toUpperCase()}</span>
            <h2>市场创意尚未准备好。</h2>
            <p>请返回商品页重新创建一轮，或检查 Phase 2 数据库和模型开关。</p>
          </section>
        ) : (
          <>
            <section className="creative-grid" aria-label="市场创意">
              {parsedCreatives.map(({ row, parsed }, index) => {
                if (!parsed.success) return null;
                const creative = parsed.data;
                return (
                  <article className="creative-card" key={row.id}>
                    <header>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{creative.market}</strong>
                        <small>{creative.language}</small>
                      </div>
                    </header>
                    <div className="creative-hook">
                      <span>HOOK</span>
                      <h2>{creative.hook}</h2>
                      <p>{creative.hookZh}</p>
                    </div>
                    <dl>
                      <div>
                        <dt>正文</dt>
                        <dd>{creative.bodyCopy}</dd>
                        <dd className="translation">{creative.bodyCopyZh}</dd>
                      </div>
                      <div>
                        <dt>CTA</dt>
                        <dd>{creative.cta}</dd>
                        <dd className="translation">{creative.ctaZh}</dd>
                      </div>
                      <div>
                        <dt>本地化重点</dt>
                        <dd>{creative.localizationFocus}</dd>
                      </div>
                      <div>
                        <dt>合规边界</dt>
                        <dd>{creative.complianceNote}</dd>
                      </div>
                    </dl>
                    <details>
                      <summary>查看 15 秒分镜与最终 Prompt</summary>
                      <ol className="storyboard-list">
                        {creative.storyboard.map((shot) => (
                          <li key={shot.sequence}>
                            <span>{shot.durationSeconds}s</span>
                            <p>{shot.visual}</p>
                            <small>{shot.onScreenCopy}</small>
                          </li>
                        ))}
                      </ol>
                      <pre>{row.image_prompt_final}</pre>
                    </details>
                  </article>
                );
              })}
            </section>
            <GenerationPanel
              campaignId={campaign.id}
              markets={parsedCreatives.map(({ row }) => row.market)}
            />
          </>
        )}
      </div>
    </main>
  );
}

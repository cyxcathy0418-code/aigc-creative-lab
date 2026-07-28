import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CampaignForm } from "./CampaignForm";

export const metadata: Metadata = {
  title: "创建市场创意",
};

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
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
  const { data: product, error } = await supabase
    .from("products")
    .select("id,name,status,target_markets,platform,style_preference,product_specs(id)")
    .eq("id", id)
    .single();
  if (error || !product) {
    notFound();
  }

  const specRelation = product.product_specs;
  const hasSpec = Array.isArray(specRelation)
    ? specRelation.length > 0
    : Boolean(specRelation);
  if (!hasSpec || product.status !== "ready") {
    redirect(`/products/${id}/spec`);
  }

  return (
    <main className="dashboard-shell">
      <WorkspaceHeader email={user.email} />
      <div className="dashboard-main product-flow">
        <div className="flow-heading campaign-heading">
          <div>
            <p className="section-kicker">03 / MARKET DIRECTIONS</p>
            <h1>One source. Distinct markets.</h1>
            <p>
              以已确认的 {product.name} Spec 为边界，为每个市场建立不同的广告语境。
              商品本身仍由同一套视觉锚点和参考图控制。
            </p>
          </div>
          <Link className="text-link" href={`/products/${id}/spec`}>
            ← 返回商品 Spec
          </Link>
        </div>
        <div className="campaign-context-strip">
          <div>
            <span>PRODUCT</span>
            <strong>{product.name}</strong>
          </div>
          <div>
            <span>PLATFORM</span>
            <strong>{product.platform}</strong>
          </div>
          <div>
            <span>STYLE</span>
            <strong>{product.style_preference}</strong>
          </div>
        </div>
        <CampaignForm
          productId={product.id}
          productName={product.name}
          suggestedMarkets={product.target_markets}
        />
      </div>
    </main>
  );
}


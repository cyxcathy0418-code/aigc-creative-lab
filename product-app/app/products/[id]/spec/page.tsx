import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { addSignedImageUrls } from "@/lib/products/data";
import { ProductSpecSchema } from "@/lib/products/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { RetryExtractionButton } from "./RetryExtractionButton";
import { SpecEditor } from "./SpecEditor";

export const metadata: Metadata = {
  title: "商品 Spec",
};

export const dynamic = "force-dynamic";

export default async function ProductSpecPage({
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

  if (!supabase || !user) {
    redirect("/login");
  }

  const { id } = await params;
  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id,name,status,extraction_attempts,extraction_error,product_reference_images(*),product_specs(spec,version,updated_at)",
    )
    .eq("id", id)
    .single();

  if (error || !product) {
    notFound();
  }

  const images = await addSignedImageUrls(
    supabase,
    product.product_reference_images ?? [],
  );
  const specRelation = product.product_specs;
  const specRecord = Array.isArray(specRelation)
    ? specRelation[0]
    : specRelation;
  const parsedSpec = ProductSpecSchema.safeParse(specRecord?.spec);

  return (
    <main className="dashboard-shell">
      <WorkspaceHeader email={user.email} />
      <div className="dashboard-main product-flow">
        <div className="spec-topbar">
          <div>
            <p className="section-kicker">02 / PRODUCT SPEC</p>
            <h1>{product.name}</h1>
            <p>
              这是后续所有市场创意共享的商品身份。先检查，再确认。
            </p>
          </div>
          <Link className="text-link" href="/dashboard">
            ← 返回商品中心
          </Link>
        </div>

        {!parsedSpec.success ? (
          <section className="spec-error">
            <span>EXTRACTION {product.status.toUpperCase()}</span>
            <h2>Spec 尚未准备好。</h2>
            <p>
              {product.extraction_error ??
                "当前商品没有可编辑的 Spec。请返回后重新创建。"}
            </p>
            <p>已尝试：{product.extraction_attempts}/3</p>
            <div className="spec-retry-actions">
              <RetryExtractionButton productId={product.id} />
              <Link className="text-link" href="/products/new">
                或新建另一件商品
              </Link>
            </div>
          </section>
        ) : (
          <SpecEditor
            productId={product.id}
            initialSpec={parsedSpec.data}
            initialVersion={specRecord.version}
            images={images.map((image) => ({
              id: image.id,
              signedUrl: image.signedUrl,
              fileName: image.file_name,
              isPrimary: image.is_primary,
            }))}
          />
        )}
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { hasSupabaseEnv } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "商品中心",
};

export const dynamic = "force-dynamic";

type DashboardImage = {
  object_path: string;
  is_primary: boolean;
  sort_order: number;
};

type DashboardProduct = {
  id: string;
  name: string;
  status: "extracting" | "ready" | "failed";
  target_markets: string[];
  platform: string;
  updated_at: string;
  product_reference_images: DashboardImage[];
};

export default async function DashboardPage() {
  const configured = hasSupabaseEnv();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (configured && !user) {
    redirect("/login?next=/dashboard");
  }

  let products: Array<DashboardProduct & { imageUrl: string | null }> = [];
  let listError = "";

  if (supabase && user) {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id,name,status,target_markets,platform,updated_at,product_reference_images(object_path,is_primary,sort_order)",
      )
      .order("updated_at", { ascending: false });

    if (error) {
      listError = "商品列表暂时无法载入，请刷新重试。";
    } else {
      products = await Promise.all(
        ((data ?? []) as DashboardProduct[]).map(async (product) => {
          const image = [...product.product_reference_images].sort(
            (left, right) =>
              Number(right.is_primary) - Number(left.is_primary) ||
              left.sort_order - right.sort_order,
          )[0];
          const { data: signedData } = image
            ? await supabase.storage
                .from(process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets")
                .createSignedUrl(image.object_path, 60 * 60)
            : { data: null };

          return {
            ...product,
            imageUrl: signedData?.signedUrl ?? null,
          };
        }),
      );
    }
  }

  return (
    <main className="dashboard-shell">
      <WorkspaceHeader email={user?.email} />
      <div className="dashboard-main">
        <div className="dashboard-titlebar">
          <div>
            <p className="section-kicker">WORKSPACE / 商品中心</p>
            <h1>我的商品</h1>
          </div>
          <Link className="button button-primary" href="/products/new">
            <span>新建商品</span>
            <span aria-hidden="true">＋</span>
          </Link>
        </div>

        {!configured ? (
          <div className="config-notice" role="status">
            <strong>Supabase 尚未配置。</strong>{" "}
            请先连接项目环境变量，再进入真实商品工作流。
          </div>
        ) : null}

        {listError ? (
          <p className="form-message" data-tone="error" role="alert">
            {listError}
          </p>
        ) : null}

        {products.length ? (
          <section className="product-grid" aria-label="商品列表">
            {products.map((product) => (
              <Link
                className="product-card"
                href={`/products/${product.id}/spec`}
                key={product.id}
              >
                <div className="product-card-image">
                  {product.imageUrl ? (
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      fill
                      unoptimized
                    />
                  ) : (
                    <span aria-hidden="true">A</span>
                  )}
                  <em data-status={product.status}>
                    {product.status === "ready"
                      ? "SPEC READY"
                      : product.status === "failed"
                        ? "NEEDS ATTENTION"
                        : "EXTRACTING"}
                  </em>
                </div>
                <div className="product-card-copy">
                  <span>{product.platform}</span>
                  <h2>{product.name}</h2>
                  <p>{product.target_markets.join(" / ")}</p>
                  <small>
                    更新于{" "}
                    {new Intl.DateTimeFormat("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                    }).format(new Date(product.updated_at))}
                  </small>
                </div>
              </Link>
            ))}
          </section>
        ) : (
          <section className="empty-workspace">
            <div className="empty-copy">
              <h2>Every campaign needs a source.</h2>
              <p>
                从一个真实 SKU 开始：上传参考图、提取商品身份，再由你亲自确认。
              </p>
              <ul>
                <li>私有保存 1–3 张商品参考图</li>
                <li>提取可编辑的结构化视觉 Spec</li>
                <li>为 Phase 2 多市场创意建立统一来源</li>
              </ul>
              <Link className="button button-dark empty-action" href="/products/new">
                创建第一个商品 <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="empty-visual" aria-hidden="true">
              <div className="empty-frame">
                <span className="empty-anchor">A</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

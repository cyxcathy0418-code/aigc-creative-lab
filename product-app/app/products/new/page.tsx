import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { ProductForm } from "./ProductForm";

export const metadata: Metadata = {
  title: "新建商品",
};

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!isAuthorizedProductUser(user)) {
    redirect("/login?next=/products/new");
  }

  return (
    <main className="dashboard-shell">
      <WorkspaceHeader email={user.email} />
      <div className="dashboard-main product-flow">
        <div className="flow-heading">
          <div>
            <p className="section-kicker">01 / SOURCE</p>
            <h1>Build the source of truth.</h1>
            <p>
              上传真实商品图和已知信息。系统会先提取可编辑的视觉身份，而不是直接开始生成广告。
            </p>
          </div>
          <span className="phase-tag">PRIVATE BY DEFAULT</span>
        </div>
        <ProductForm />
      </div>
    </main>
  );
}

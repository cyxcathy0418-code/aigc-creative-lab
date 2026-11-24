import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProductSpecSchema, type ProductSpec } from "./schema.ts";

export class SpecSaveError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function mergeSpec(
  current: ProductSpec,
  patch: Record<string, unknown>,
): unknown {
  const mergeValue = (base: unknown, next: unknown): unknown => {
    if (
      base &&
      next &&
      typeof base === "object" &&
      typeof next === "object" &&
      !Array.isArray(base) &&
      !Array.isArray(next)
    ) {
      const merged = { ...(base as Record<string, unknown>) };
      for (const [key, value] of Object.entries(
        next as Record<string, unknown>,
      )) {
        merged[key] = mergeValue(merged[key], value);
      }
      return merged;
    }
    return next;
  };

  return mergeValue(current, patch);
}

const SpecSaveRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  spec: z.record(z.string(), z.unknown()),
}).strict();

export async function saveProductSpec(
  client: SupabaseClient,
  productId: string,
  payload: unknown,
) {
  const parsed = SpecSaveRequestSchema.safeParse(payload);
  if (!parsed.success) throw new SpecSaveError("请提交正在编辑的版本号和 Spec 内容", 400);
  const request = parsed.data;
  const { data: existing, error: readError } = await client
    .from("product_specs").select("spec,version").eq("product_id", productId).maybeSingle();
  if (readError) throw new SpecSaveError("Spec 读取失败", 500);
  if (!existing) throw new SpecSaveError("未找到该商品 Spec", 404);
  const conflict = () => new SpecSaveError("Spec 已在其他页面更新。请刷新页面，核对最新内容后再编辑保存。", 409);
  if (existing.version !== request.expectedVersion) throw conflict();
  const spec = ProductSpecSchema.parse(mergeSpec(ProductSpecSchema.parse(existing.spec), request.spec));
  const { data, error } = await client.from("product_specs")
    .update({ spec, version: request.expectedVersion + 1 })
    .eq("product_id", productId).eq("version", request.expectedVersion)
    .select("spec,version,updated_at").maybeSingle();
  if (error) throw new SpecSaveError("Spec 保存失败，请稍后重试", 500);
  if (!data) throw conflict();
  return { spec: data.spec, version: data.version, updatedAt: data.updated_at };
}

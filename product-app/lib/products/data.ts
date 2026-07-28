import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductRow = {
  id: string;
  name: string;
  selling_points_input: string;
  brand_tone_input: string;
  target_markets: string[];
  platform: string;
  style_preference: string;
  material_hint: string | null;
  status: "extracting" | "ready" | "failed";
  extraction_attempts: number;
  extraction_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductImageRow = {
  id: string;
  product_id: string;
  object_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  is_primary: boolean;
  sort_order: number;
};

export type ProductSpecRow = {
  product_id: string;
  spec: unknown;
  version: number;
  updated_at: string;
};

export async function addSignedImageUrls(
  supabase: SupabaseClient,
  images: ProductImageRow[],
) {
  return Promise.all(
    images.map(async (image) => {
      const { data } = await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET ?? "product-assets")
        .createSignedUrl(image.object_path, 60 * 60);

      return {
        ...image,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
}

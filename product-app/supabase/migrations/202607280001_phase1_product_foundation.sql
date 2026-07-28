-- Brand Anchor Studio Phase 1: private product records, editable specs,
-- and user-scoped reference images.

create extension if not exists pgcrypto;

create or replace function public.text_array_is_unique(values_to_check text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select cardinality(values_to_check) = (
    select count(distinct value)
    from unnest(values_to_check) as value
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  selling_points_input text not null check (char_length(trim(selling_points_input)) between 1 and 1200),
  brand_tone_input text not null check (char_length(trim(brand_tone_input)) between 1 and 600),
  target_markets text[] not null,
  platform text not null check (char_length(trim(platform)) between 1 and 80),
  style_preference text not null check (char_length(trim(style_preference)) between 1 and 300),
  material_hint text,
  status text not null default 'extracting'
    check (status in ('extracting', 'ready', 'failed')),
  extraction_attempts integer not null default 0
    check (extraction_attempts between 0 and 3),
  extraction_error text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint products_target_markets_count
    check (cardinality(target_markets) between 1 and 5),
  constraint products_target_markets_supported
    check (
      target_markets <@ array['美国', '欧洲', '日本', '韩国', '东南亚']::text[]
    ),
  constraint products_target_markets_unique
    check (public.text_array_is_unique(target_markets))
);

create table if not exists public.product_reference_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  object_path text not null unique,
  file_name text not null check (char_length(trim(file_name)) between 1 and 255),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  is_primary boolean not null default false,
  sort_order smallint not null default 0 check (sort_order between 0 and 2),
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (product_id, sort_order)
);

create unique index if not exists product_reference_images_one_primary
  on public.product_reference_images(product_id)
  where is_primary;

create table if not exists public.product_specs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  raw_extraction_output text not null default '',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists products_user_updated_idx
  on public.products(user_id, updated_at desc);

create index if not exists product_reference_images_product_idx
  on public.product_reference_images(product_id, sort_order);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists product_specs_set_updated_at on public.product_specs;
create trigger product_specs_set_updated_at
before update on public.product_specs
for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.product_reference_images enable row level security;
alter table public.product_specs enable row level security;

drop policy if exists "products_select_own" on public.products;
create policy "products_select_own"
on public.products for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own"
on public.products for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own"
on public.products for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own"
on public.products for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "product_images_select_own" on public.product_reference_images;
create policy "product_images_select_own"
on public.product_reference_images for select
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_reference_images.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_images_insert_own" on public.product_reference_images;
create policy "product_images_insert_own"
on public.product_reference_images for insert
to authenticated
with check (
  exists (
    select 1
    from public.products
    where products.id = product_reference_images.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_images_update_own" on public.product_reference_images;
create policy "product_images_update_own"
on public.product_reference_images for update
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_reference_images.product_id
      and products.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.products
    where products.id = product_reference_images.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_images_delete_own" on public.product_reference_images;
create policy "product_images_delete_own"
on public.product_reference_images for delete
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_reference_images.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_specs_select_own" on public.product_specs;
create policy "product_specs_select_own"
on public.product_specs for select
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_specs.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_specs_insert_own" on public.product_specs;
create policy "product_specs_insert_own"
on public.product_specs for insert
to authenticated
with check (
  exists (
    select 1
    from public.products
    where products.id = product_specs.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_specs_update_own" on public.product_specs;
create policy "product_specs_update_own"
on public.product_specs for update
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_specs.product_id
      and products.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.products
    where products.id = product_specs.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "product_specs_delete_own" on public.product_specs;
create policy "product_specs_delete_own"
on public.product_specs for delete
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_specs.product_id
      and products.user_id = (select auth.uid())
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-assets',
  'product-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_assets_select_own" on storage.objects;
create policy "product_assets_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "product_assets_insert_own" on storage.objects;
create policy "product_assets_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "product_assets_delete_own" on storage.objects;
create policy "product_assets_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

comment on table public.products is
  'User-owned product briefs and extraction lifecycle for Brand Anchor Studio.';
comment on table public.product_reference_images is
  'Private Supabase Storage object metadata. object_path is stored instead of a public URL.';
comment on table public.product_specs is
  'Versioned, Zod-validated ProductSpec JSON for Phase 1.';

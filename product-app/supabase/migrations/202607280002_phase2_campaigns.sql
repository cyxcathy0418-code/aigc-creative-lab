-- Brand Anchor Studio Phase 2: market-localized campaigns, generation jobs,
-- and private generated assets. Billing is intentionally out of scope.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  target_markets text[] not null,
  platform text not null check (char_length(trim(platform)) between 1 and 80),
  style_preference text not null check (char_length(trim(style_preference)) between 1 and 300),
  spec_version integer not null check (spec_version > 0),
  status text not null default 'deriving'
    check (status in ('deriving', 'creatives_ready', 'generating', 'completed', 'failed')),
  derivation_model text,
  derivation_attempts integer not null default 0
    check (derivation_attempts between 0 and 3),
  derivation_error text,
  derivation_usage jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint campaigns_target_markets_count
    check (cardinality(target_markets) between 2 and 5),
  constraint campaigns_target_markets_supported
    check (
      target_markets <@ array['美国', '欧洲', '日本', '韩国', '东南亚']::text[]
    ),
  constraint campaigns_target_markets_unique
    check (public.text_array_is_unique(target_markets))
);

create table if not exists public.market_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  market text not null
    check (market in ('美国', '欧洲', '日本', '韩国', '东南亚')),
  language text not null check (char_length(trim(language)) between 1 and 80),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  image_prompt_final text not null check (char_length(trim(image_prompt_final)) > 0),
  anchor_block text not null check (char_length(trim(anchor_block)) > 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (campaign_id, market)
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creative_id uuid not null references public.market_creatives(id) on delete cascade,
  provider text not null check (char_length(trim(provider)) between 1 and 80),
  model text not null check (char_length(trim(model)) between 1 and 120),
  size text not null check (size in ('1024x1024', '1024x1536', '1536x1024')),
  quality text not null check (quality in ('low', 'medium', 'high')),
  status text not null default 'generating'
    check (status in ('generating', 'completed', 'failed')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 3),
  reference_image_ids uuid[] not null,
  prompt_snapshot text not null check (char_length(trim(prompt_snapshot)) > 0),
  usage jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.generated_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.generation_jobs(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creative_id uuid not null references public.market_creatives(id) on delete cascade,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists campaigns_user_updated_idx
  on public.campaigns(user_id, updated_at desc);

create index if not exists campaigns_product_updated_idx
  on public.campaigns(product_id, updated_at desc);

create index if not exists market_creatives_campaign_idx
  on public.market_creatives(campaign_id, created_at);

create index if not exists generation_jobs_campaign_idx
  on public.generation_jobs(campaign_id, created_at desc);

create index if not exists generated_assets_campaign_idx
  on public.generated_assets(campaign_id, created_at desc);

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

drop trigger if exists market_creatives_set_updated_at on public.market_creatives;
create trigger market_creatives_set_updated_at
before update on public.market_creatives
for each row execute function public.set_updated_at();

drop trigger if exists generation_jobs_set_updated_at on public.generation_jobs;
create trigger generation_jobs_set_updated_at
before update on public.generation_jobs
for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;
alter table public.market_creatives enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generated_assets enable row level security;

drop policy if exists "campaigns_all_own" on public.campaigns;
create policy "campaigns_all_own"
on public.campaigns for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.products
    where products.id = campaigns.product_id
      and products.user_id = (select auth.uid())
  )
);

drop policy if exists "market_creatives_all_own" on public.market_creatives;
create policy "market_creatives_all_own"
on public.market_creatives for all
to authenticated
using (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = market_creatives.campaign_id
      and campaigns.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = market_creatives.campaign_id
      and campaigns.user_id = (select auth.uid())
  )
);

drop policy if exists "generation_jobs_all_own" on public.generation_jobs;
create policy "generation_jobs_all_own"
on public.generation_jobs for all
to authenticated
using (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = generation_jobs.campaign_id
      and campaigns.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = generation_jobs.campaign_id
      and campaigns.user_id = (select auth.uid())
  )
);

drop policy if exists "generated_assets_all_own" on public.generated_assets;
create policy "generated_assets_all_own"
on public.generated_assets for all
to authenticated
using (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = generated_assets.campaign_id
      and campaigns.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = generated_assets.campaign_id
      and campaigns.user_id = (select auth.uid())
  )
);

comment on table public.campaigns is
  'A product campaign pinned to a confirmed Spec version and two to five markets.';
comment on table public.market_creatives is
  'Validated localized copy and final anchored image prompt for one campaign market.';
comment on table public.generation_jobs is
  'Auditable image request lifecycle. Failed jobs never create generated assets.';
comment on table public.generated_assets is
  'Private generated-image metadata; object_path is stored instead of a public URL.';

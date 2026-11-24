-- Additive foundation only. Legacy campaigns remain creative batches, never
-- TikTok Campaigns. Apply after backing up the target database; no live writes
-- are performed by the application merely because this file exists.
begin;

create function public.normalize_legacy_market(label text)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare code text; language_tag text;
begin
  case label
    when '美国' then code := 'US'; language_tag := 'en-US';
    when '墨西哥' then code := 'MX'; language_tag := 'es-MX';
    when '日本' then code := 'JP'; language_tag := 'ja-JP';
    when '韩国' then code := 'KR'; language_tag := 'ko-KR';
    when '欧洲', '东南亚' then code := null; language_tag := null;
    else raise exception 'Unsupported legacy market: %', label;
  end case;
  return jsonb_build_object('legacyLabel',label,'marketCode',code,'locale',language_tag,
    'mappingStatus',case when code is null then 'needs_confirmation' else 'mapped' end);
end;
$$;

create function public.normalize_legacy_markets(labels text[])
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(public.normalize_legacy_market(value) order by ordinal), '[]'::jsonb)
  from unnest(labels) with ordinality as labels(value, ordinal);
$$;

alter table public.products drop constraint products_target_markets_supported;
alter table public.products add constraint products_target_markets_supported
  check (target_markets <@ array['美国','墨西哥','欧洲','日本','韩国','东南亚']::text[]);
alter table public.products drop constraint products_target_markets_count;
alter table public.products add constraint products_target_markets_count check (cardinality(target_markets) between 1 and 6);
alter table public.products add constraint products_id_user_unique unique(id,user_id);
alter table public.products add column market_contexts jsonb not null default '[]';

alter table public.campaigns drop constraint campaigns_target_markets_supported;
alter table public.campaigns add constraint campaigns_target_markets_supported
  check (target_markets <@ array['美国','墨西哥','欧洲','日本','韩国','东南亚']::text[]);
alter table public.campaigns drop constraint campaigns_target_markets_count;
alter table public.campaigns add constraint campaigns_target_markets_count check (cardinality(target_markets) between 1 and 6);
alter table public.campaigns add constraint campaigns_id_product_user_unique unique(id,product_id,user_id);
alter table public.campaigns add column market_contexts jsonb not null default '[]';

create function public.sync_legacy_markets()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.market_contexts := public.normalize_legacy_markets(new.target_markets);
  return new;
end;
$$;
create trigger products_normalize_markets before insert or update on public.products
  for each row execute function public.sync_legacy_markets();
create trigger campaigns_normalize_markets before insert or update on public.campaigns
  for each row execute function public.sync_legacy_markets();
-- Preserve original timestamps while backfilling derived metadata.
alter table public.products disable trigger products_set_updated_at;
update public.products set market_contexts=public.normalize_legacy_markets(target_markets);
alter table public.products enable trigger products_set_updated_at;
alter table public.campaigns disable trigger campaigns_set_updated_at;
update public.campaigns set market_contexts=public.normalize_legacy_markets(target_markets);
alter table public.campaigns enable trigger campaigns_set_updated_at;

alter table public.market_creatives drop constraint market_creatives_market_check;
alter table public.market_creatives add constraint market_creatives_market_check
  check (market in ('美国','墨西哥','欧洲','日本','韩国','东南亚'));
alter table public.market_creatives add column market_code text;
alter table public.market_creatives add column locale text;
alter table public.market_creatives add column mapping_status text not null default 'needs_confirmation'
  check(mapping_status in ('mapped','needs_confirmation'));
create function public.sync_legacy_creative_market()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare context jsonb;
begin
  context := public.normalize_legacy_market(new.market);
  new.market_code := context->>'marketCode'; new.locale := context->>'locale';
  new.mapping_status := context->>'mappingStatus'; return new;
end;
$$;
create trigger market_creatives_normalize_market before insert or update on public.market_creatives
  for each row execute function public.sync_legacy_creative_market();
alter table public.market_creatives disable trigger market_creatives_set_updated_at;
update public.market_creatives set market_code=public.normalize_legacy_market(market)->>'marketCode',
  locale=public.normalize_legacy_market(market)->>'locale',
  mapping_status=public.normalize_legacy_market(market)->>'mappingStatus';
alter table public.market_creatives enable trigger market_creatives_set_updated_at;

create table public.product_spec_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check(version>0),
  spec jsonb not null check(jsonb_typeof(spec)='object'),
  origin text not null check(origin in ('legacy_current','captured')),
  captured_at timestamptz not null default now(),
  unique(product_id,version), unique(id,product_id,user_id),
  foreign key(product_id,user_id) references public.products(id,user_id) on delete cascade
);
-- Only currently available JSON is known. Never invent missing version 1..N-1.
insert into public.product_spec_versions(product_id,user_id,version,spec,origin,captured_at)
select s.product_id,p.user_id,s.version,s.spec,'legacy_current',s.updated_at
from public.product_specs s join public.products p on p.id=s.product_id;

create function public.guard_spec_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.version<>1 then raise exception 'New Spec must start at version 1'; end if;
    if exists(select 1 from public.product_spec_versions where product_id=new.product_id)
       or exists(select 1 from public.campaigns where product_id=new.product_id) then
      raise exception 'Existing Spec history cannot restart; restore the original record or create a new product';
    end if;
  else
    if new.product_id<>old.product_id then raise exception 'Spec product cannot change'; end if;
    if (new.spec is distinct from old.spec or new.version<>old.version)
       and new.version<>old.version+1 then raise exception 'Spec revision conflict'; end if;
  end if;
  return new;
end;
$$;
create function public.capture_spec_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' or new.version<>old.version then
    insert into public.product_spec_versions(product_id,user_id,version,spec,origin)
    select new.product_id,p.user_id,new.version,new.spec,'captured'
    from public.products p where p.id=new.product_id;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_spec_revision() from public,anon,authenticated;
-- Standalone removal would allow history to be lost/reused. Parent cascades
-- still execute through PostgreSQL referential actions.
revoke delete on public.product_specs from authenticated,anon;
create trigger product_specs_guard_revision before insert or update on public.product_specs
  for each row execute function public.guard_spec_revision();
create trigger product_specs_capture_revision after insert or update on public.product_specs
  for each row execute function public.capture_spec_revision();
create function public.reject_snapshot_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Spec snapshots are immutable'; end;
$$;
create trigger product_spec_versions_immutable before update on public.product_spec_versions
  for each row execute function public.reject_snapshot_update();
alter table public.product_spec_versions enable row level security;
create policy spec_versions_select_own on public.product_spec_versions for select to authenticated using(user_id=(select auth.uid()));
revoke insert,update,delete on public.product_spec_versions from authenticated,anon;
grant select on public.product_spec_versions to authenticated;

create view public.legacy_creative_batches with(security_invoker=true) as
select c.*, case when exists(select 1 from public.product_spec_versions v where v.product_id=c.product_id and v.version=c.spec_version)
  then 'available' else 'unavailable' end as spec_history_status from public.campaigns c;
grant select on public.legacy_creative_batches to authenticated;
comment on table public.campaigns is 'Legacy single-product creative batch. NOT a TikTok advertising Campaign. Existing IDs/routes retained.';

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  currency text not null default 'USD' check(currency='USD'),
  account_timezone text not null default 'Etc/UTC' check(length(trim(account_timezone))>0),
  account_context_source text not null default 'local_assumption' check(account_context_source='local_assumption'),
  created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.project_products (
  project_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), primary key(project_id,product_id),
  unique(project_id,product_id,user_id),
  foreign key(project_id,user_id) references public.projects(id,user_id) on delete cascade,
  foreign key(product_id,user_id) references public.products(id,user_id) on delete cascade
);
create table public.product_sources (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(),
  kind text not null check(kind in ('merchant_text','uploaded_asset','market_reference','interview')),
  excerpt text not null check(length(trim(excerpt))>0), source_url text,
  created_at timestamptz not null default now(), unique(id,project_id,product_id,user_id),
  foreign key(project_id,product_id,user_id) references public.project_products(project_id,product_id,user_id) on delete cascade
);
create table public.product_facts (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), source_id uuid not null,
  statement text not null check(length(trim(statement))>0),
  confirmation_status text not null default 'draft' check(confirmation_status in ('draft','confirmed')),
  confirmed_by uuid references auth.users(id) deferrable initially deferred, confirmed_at timestamptz,
  created_at timestamptz not null default now(), unique(id,project_id,product_id,user_id),
  foreign key(project_id,product_id,user_id) references public.project_products(project_id,product_id,user_id) on delete cascade,
  foreign key(source_id,project_id,product_id,user_id) references public.product_sources(id,project_id,product_id,user_id) deferrable initially deferred,
  check((confirmation_status='draft' and confirmed_by is null and confirmed_at is null)
     or (confirmation_status='confirmed' and confirmed_by is not null and confirmed_at is not null))
);
create function public.guard_fact_confirmation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare source_kind text;
begin
  if tg_op='UPDATE' and old.confirmation_status='confirmed' then
    raise exception 'Confirmed facts are immutable; create a new fact';
  end if;
  if new.confirmation_status='confirmed' then
    if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Human owner confirmation required'; end if;
    select s.kind into source_kind from public.product_sources s where s.id=new.source_id;
    if source_kind not in ('merchant_text','uploaded_asset') then raise exception 'Market references cannot prove product claims'; end if;
    new.confirmed_by:=auth.uid(); new.confirmed_at:=now();
  end if;
  return new;
end;
$$;
create trigger product_facts_confirmation before insert or update on public.product_facts
  for each row execute function public.guard_fact_confirmation();
-- Raw evidence is append-only, including before confirmation. An edited
-- source becomes a new record; source changes cannot race fact confirmation.
create function public.guard_confirmed_source()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Source records are immutable; create a new source'; end;
$$;
create trigger product_sources_confirmed before update on public.product_sources
  for each row execute function public.guard_confirmed_source();

create table public.market_locales (
  market_code text not null, locale text not null, primary key(market_code,locale)
);
insert into public.market_locales values ('US','en-US'),('MX','es-MX'),('JP','ja-JP'),('KR','ko-KR');
revoke insert,update,delete on public.market_locales from authenticated,anon;
grant select on public.market_locales to authenticated;
create table public.market_briefs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null,
  user_id uuid not null default auth.uid(), market_code text not null, locale text not null,
  audience_description text not null check(length(trim(audience_description))>0),
  scenario_hypothesis text not null default '', references_json jsonb not null default '[]' check(jsonb_typeof(references_json)='array'),
  created_at timestamptz not null default now(), unique(project_id,market_code,locale),
  foreign key(project_id,user_id) references public.projects(id,user_id) on delete cascade,
  foreign key(market_code,locale) references public.market_locales(market_code,locale)
);

create table public.creative_variants (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), spec_version_id uuid not null,
  legacy_batch_id uuid, market_code text not null, locale text not null,
  variant_kind text not null check(variant_kind in ('B0','B1')),
  parent_id uuid, lineage_id uuid not null default gen_random_uuid(), revision integer not null default 1 check(revision>0),
  status text not null default 'draft' check(status in ('draft','script_confirmed','needs_review','candidate')),
  evidence_locked boolean not null default false,
  direction text not null default '', script jsonb not null default '{}' check(jsonb_typeof(script)='object'),
  shots jsonb not null default '[]' check(jsonb_typeof(shots)='array'),
  created_at timestamptz not null default now(), unique(id,project_id,product_id,user_id), unique(lineage_id,revision),
  unique(id,project_id,product_id,user_id,market_code,locale),
  foreign key(project_id,product_id,user_id) references public.project_products(project_id,product_id,user_id) on delete cascade,
  foreign key(spec_version_id,product_id,user_id) references public.product_spec_versions(id,product_id,user_id) deferrable initially deferred,
  foreign key(legacy_batch_id,product_id,user_id) references public.campaigns(id,product_id,user_id) deferrable initially deferred,
  foreign key(parent_id,project_id,product_id,user_id) references public.creative_variants(id,project_id,product_id,user_id) deferrable initially deferred,
  foreign key(market_code,locale) references public.market_locales(market_code,locale)
);
create function public.guard_creative_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare parent public.creative_variants;
begin
  if tg_op='UPDATE' then
    new.evidence_locked := old.evidence_locked or new.status in ('script_confirmed','candidate');
    if (to_jsonb(new)-'status'-'evidence_locked') is distinct from (to_jsonb(old)-'status'-'evidence_locked') then
      raise exception 'Creative content is immutable; insert a revision';
    end if;
    return new;
  end if;
  new.evidence_locked := new.status in ('script_confirmed','candidate');
  if new.parent_id is null then
    if new.revision<>1 then raise exception 'Root creative must start at revision 1'; end if;
    new.lineage_id:=new.id;
  else
    select * into parent from public.creative_variants where id=new.parent_id;
    if parent.id is null or parent.project_id<>new.project_id or parent.product_id<>new.product_id
      or parent.market_code<>new.market_code or parent.locale<>new.locale or parent.variant_kind<>new.variant_kind
      or new.revision<>parent.revision+1 then raise exception 'Invalid creative revision parent'; end if;
    new.lineage_id:=parent.lineage_id;
  end if;
  return new;
end;
$$;
create trigger creative_variants_revision before insert or update on public.creative_variants
  for each row execute function public.guard_creative_revision();
create table public.creative_variant_facts (
  variant_id uuid not null, fact_id uuid not null, project_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), primary key(variant_id,fact_id),
  foreign key(variant_id,project_id,product_id,user_id) references public.creative_variants(id,project_id,product_id,user_id) on delete cascade,
  foreign key(fact_id,project_id,product_id,user_id) references public.product_facts(id,project_id,product_id,user_id) deferrable initially deferred
);
create function public.require_confirmed_fact()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare old_id uuid; new_id uuid; variant public.creative_variants;
begin
  if tg_op<>'INSERT' then old_id:=old.variant_id; end if;
  if tg_op<>'DELETE' then new_id:=new.variant_id; end if;
  -- Serialize evidence changes with confirmation on each individual variant.
  for variant in select * from public.creative_variants where id in (old_id,new_id) order by id for update loop
    if variant.evidence_locked
       and exists(select 1 from public.projects where id=variant.project_id)
       and exists(select 1 from public.products where id=variant.product_id) then
      raise exception 'Confirmed creative evidence is immutable; insert a revision';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  if not exists(select 1 from public.product_facts where id=new.fact_id and confirmation_status='confirmed') then
    raise exception 'Creative claims require confirmed facts';
  end if; return new;
end;
$$;
create trigger creative_variant_facts_confirmed before insert or update or delete on public.creative_variant_facts
  for each row execute function public.require_confirmed_fact();

create table public.ad_campaign_drafts (
  id uuid primary key default gen_random_uuid(), project_id uuid not null,
  user_id uuid not null default auth.uid(), name text not null check(length(trim(name))>0),
  objective text not null default 'TRAFFIC' check(objective='TRAFFIC'),
  destination_type text not null default 'WEBSITE' check(destination_type='WEBSITE'),
  budget_strategy text not null default 'AD_GROUP' check(budget_strategy in ('CAMPAIGN','AD_GROUP')),
  budget_mode text check(budget_mode in ('DAILY','LIFETIME')), budget_amount numeric(18,4),
  currency text not null default 'USD' check(currency='USD'),
  validation_status text not null default 'incomplete' check(validation_status in ('incomplete','needs_review','local_valid','incompatible')),
  platform_status text not null default 'not_connected' check(platform_status in ('not_connected','pending')),
  created_at timestamptz not null default now(), unique(id,project_id,user_id),
  foreign key(project_id,user_id) references public.projects(id,user_id) on delete cascade,
  check((budget_mode is null and budget_amount is null) or (budget_mode is not null and budget_amount is not null and budget_amount>0 and budget_amount<>'NaN'::numeric)),
  check(budget_strategy='CAMPAIGN' or budget_mode is null)
);
create table public.ad_group_drafts (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, campaign_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), name text not null check(length(trim(name))>0),
  market_code text not null check(market_code in ('US','MX')), locale text not null,
  audience jsonb not null default '{}' check(jsonb_typeof(audience)='object'),
  placement text not null default 'TIKTOK' check(placement='TIKTOK'),
  optimization_goal text not null default 'CLICK' check(optimization_goal='CLICK'),
  bid_strategy text not null default 'MAXIMUM_DELIVERY' check(bid_strategy='MAXIMUM_DELIVERY'),
  budget_mode text check(budget_mode in ('DAILY','LIFETIME')), budget_amount numeric(18,4),
  starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(),
  unique(id,project_id,product_id,user_id), unique(id,project_id,product_id,user_id,market_code,locale),
  foreign key(project_id,product_id,user_id) references public.project_products(project_id,product_id,user_id) on delete cascade,
  foreign key(campaign_id,project_id,user_id) references public.ad_campaign_drafts(id,project_id,user_id) on delete cascade,
  foreign key(market_code,locale) references public.market_locales(market_code,locale),
  check((budget_mode is null and budget_amount is null) or (budget_mode is not null and budget_amount is not null and budget_amount>0 and budget_amount<>'NaN'::numeric)),
  check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create function public.guard_draft_budget_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare strategy text;
begin
  if tg_table_name='ad_group_drafts' then
    select budget_strategy into strategy from public.ad_campaign_drafts where id=new.campaign_id for update;
    if new.budget_mode is not null and strategy='CAMPAIGN' then
      raise exception 'Campaign budget cannot be duplicated at ad-group scope';
    end if;
  elsif new.budget_strategy='CAMPAIGN' and exists(select 1 from public.ad_group_drafts where campaign_id=new.id and budget_mode is not null) then
    raise exception 'Review and clear active group budgets before switching strategy';
  end if; return new;
end;
$$;
create trigger ad_groups_budget_scope before insert or update on public.ad_group_drafts
  for each row execute function public.guard_draft_budget_scope();
create trigger ad_campaign_budget_scope before update on public.ad_campaign_drafts
  for each row execute function public.guard_draft_budget_scope();
create table public.ad_drafts (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, ad_group_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), name text not null check(length(trim(name))>0),
  market_code text not null, locale text not null,
  identity_details jsonb not null default '{}' check(jsonb_typeof(identity_details)='object'),
  copy text not null default '', cta text not null default '', destination_url text,
  tracking jsonb not null default '{}' check(jsonb_typeof(tracking)='object'),
  created_at timestamptz not null default now(), unique(id,project_id,product_id,user_id),
  unique(id,project_id,product_id,user_id,market_code,locale),
  foreign key(ad_group_id,project_id,product_id,user_id,market_code,locale) references public.ad_group_drafts(id,project_id,product_id,user_id,market_code,locale) on delete cascade deferrable initially deferred
);
create table public.ad_asset_bindings (
  ad_id uuid not null, variant_id uuid not null, project_id uuid not null, product_id uuid not null,
  user_id uuid not null default auth.uid(), primary key(ad_id,variant_id),
  market_code text not null, locale text not null,
  foreign key(ad_id,project_id,product_id,user_id,market_code,locale) references public.ad_drafts(id,project_id,product_id,user_id,market_code,locale) on delete cascade deferrable initially deferred,
  foreign key(variant_id,project_id,product_id,user_id,market_code,locale) references public.creative_variants(id,project_id,product_id,user_id,market_code,locale) deferrable initially deferred
);
create function public.sync_ad_market()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name='ad_drafts' then
    select market_code,locale into new.market_code,new.locale from public.ad_group_drafts where id=new.ad_group_id;
  else
    select market_code,locale into new.market_code,new.locale from public.ad_drafts where id=new.ad_id;
  end if; return new;
end;
$$;
create trigger ad_drafts_market before insert or update on public.ad_drafts
  for each row execute function public.sync_ad_market();
create trigger ad_asset_bindings_market before insert or update on public.ad_asset_bindings
  for each row execute function public.sync_ad_market();

-- All writable objects carry owner IDs and composite FKs, so even privileged
-- inserts cannot accidentally cross ownership/project/product boundaries.
do $$
declare table_name text;
begin
  foreach table_name in array array['projects','project_products','product_sources','product_facts','market_briefs',
    'creative_variants','creative_variant_facts','ad_campaign_drafts','ad_group_drafts','ad_drafts','ad_asset_bindings'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I on public.%I for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',table_name||'_own',table_name);
    execute format('create index %I on public.%I(user_id)',table_name||'_owner_idx',table_name);
    execute format('grant select,insert,update,delete on public.%I to authenticated',table_name);
  end loop;
end;
$$;
commit;

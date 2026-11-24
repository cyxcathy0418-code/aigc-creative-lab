import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";

export const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  otherUser: "22222222-2222-4222-8222-222222222222",
  product: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherProduct: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  batch: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

export async function createDatabase({ missingSpec = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/'); $$;
    grant usage on schema public, auth, storage to authenticated;
    alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
  `);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names.filter((name) => name.startsWith("202607"))) {
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${ids.user}'), ('${ids.otherUser}');
    insert into products(id,user_id,name,selling_points_input,brand_tone_input,target_markets,platform,style_preference,status)
    values ('${ids.product}','${ids.user}','Cup','便携','克制',array['美国','欧洲'],'TikTok','Neutral','ready'),
           ('${ids.otherProduct}','${ids.otherUser}','Other','便携','克制',array['美国'],'TikTok','Neutral','ready');
    insert into product_specs(product_id,spec,version) values ('${ids.product}','{"label":"version3"}',3);
    insert into campaigns(id,user_id,product_id,name,target_markets,platform,style_preference,spec_version,status)
    values ('${ids.batch}','${ids.user}','${ids.product}','Legacy batch',array['美国','欧洲'],'TikTok','Neutral',1,'creatives_ready');
    insert into market_creatives(campaign_id,market,language,content,image_prompt_final,anchor_block)
    values ('${ids.batch}','欧洲','English (international)','{"legacy":true}','saved prompt','saved anchor');
  `);
  if (missingSpec) await db.exec("delete from product_specs");
  for (const name of names.filter((name) => name.startsWith("202611"))) {
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  }
  return db;
}

export async function asUser(db, user, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

export async function ownerProject(db, name = "Pilot") {
  return asUser(db, ids.user, async () => {
    const project = (await db.query("insert into projects(name) values ($1) returning id", [name])).rows[0].id;
    await db.query("insert into project_products(project_id,product_id) values ($1,$2)", [project, ids.product]);
    return project;
  });
}

export async function populatedGraph(db) {
  const project = await ownerProject(db);
  return asUser(db, ids.user, async () => {
    const source = (await db.query("insert into product_sources(project_id,product_id,kind,excerpt) values ($1,$2,'merchant_text','Portable') returning id", [project,ids.product])).rows[0].id;
    const fact = (await db.query("insert into product_facts(project_id,product_id,source_id,statement,confirmation_status) values ($1,$2,$3,'Portable','confirmed') returning id", [project,ids.product,source])).rows[0].id;
    const snapshot = (await db.query("select id from product_spec_versions where product_id=$1", [ids.product])).rows[0].id;
    const variant = (await db.query("insert into creative_variants(project_id,product_id,spec_version_id,market_code,locale,variant_kind) values ($1,$2,$3,'US','en-US','B1') returning id", [project,ids.product,snapshot])).rows[0].id;
    await db.query("insert into creative_variant_facts(variant_id,fact_id,project_id,product_id) values ($1,$2,$3,$4)", [variant,fact,project,ids.product]);
    const campaign = (await db.query("insert into ad_campaign_drafts(project_id,name) values ($1,'US_TRAFFIC_CUP') returning id", [project])).rows[0].id;
    const group = (await db.query("insert into ad_group_drafts(project_id,campaign_id,product_id,name,market_code,locale) values ($1,$2,$3,'US','US','en-US') returning id", [project,campaign,ids.product])).rows[0].id;
    const ad = (await db.query("insert into ad_drafts(project_id,ad_group_id,product_id,name) values ($1,$2,$3,'Ad') returning id", [project,group,ids.product])).rows[0].id;
    await db.query("insert into ad_asset_bindings(ad_id,variant_id,project_id,product_id) values ($1,$2,$3,$4)", [ad,variant,project,ids.product]);
    return { project,source,fact,variant,campaign,group,ad };
  });
}

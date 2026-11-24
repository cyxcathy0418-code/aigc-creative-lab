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

export async function createDatabase() {
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

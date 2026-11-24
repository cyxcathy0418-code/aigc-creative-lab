import assert from "node:assert/strict";
import { test } from "node:test";
import { asUser, createDatabase, ids, ownerProject, populatedGraph } from "./helpers/passport-db.mjs";

test("migration preserves legacy rows and marks missing historical snapshots honestly", async () => {
  const db = await createDatabase();
  try {
    const old = (await db.query("select id,name,spec_version,market_contexts from campaigns where id=$1", [ids.batch])).rows[0];
    assert.equal(old.name, "Legacy batch");
    assert.equal(old.spec_version, 1);
    assert.deepEqual(old.market_contexts[1], { legacyLabel: "欧洲", marketCode: null, locale: null, mappingStatus: "needs_confirmation" });
    const versions = (await db.query("select version,origin,spec from product_spec_versions where product_id=$1", [ids.product])).rows;
    assert.deepEqual(versions, [{ version: 3, origin: "legacy_current", spec: { label: "version3" } }]);
    assert.equal((await db.query("select spec_history_status from legacy_creative_batches where id=$1", [ids.batch])).rows[0].spec_history_status, "unavailable");
    assert.equal((await db.query("select content from market_creatives where campaign_id=$1", [ids.batch])).rows[0].content.legacy, true);
  } finally { await db.close(); }
});

test("Spec edits create immutable snapshots and reject stale version writes", async () => {
  const db = await createDatabase();
  try {
    await asUser(db, ids.user, async () => {
      await db.query("update product_specs set spec=$1,version=4 where product_id=$2 and version=3", [{ label: "version4" }, ids.product]);
      const stale = await db.query("update product_specs set spec=$1,version=4 where product_id=$2 and version=3 returning id", [{ label: "stale" }, ids.product]);
      assert.equal(stale.rows.length, 0);
      assert.deepEqual((await db.query("select version,spec from product_spec_versions order by version")).rows, [
        { version: 3, spec: { label: "version3" } }, { version: 4, spec: { label: "version4" } },
      ]);
      await assert.rejects(() => db.query("update product_specs set spec='{}',version=4 where product_id=$1", [ids.product]));
      await assert.rejects(() => db.query("update product_spec_versions set spec='{}'"));
    });
    await assert.rejects(() => db.exec("update product_spec_versions set spec='{}'"));
  } finally { await db.close(); }
});

test("new single-market Mexico batches normalize country/locale without losing regions", async () => {
  const db = await createDatabase();
  try {
    await asUser(db, ids.user, async () => {
      const row = (await db.query(`insert into campaigns(user_id,product_id,name,target_markets,platform,style_preference,spec_version)
        values ($1,$2,'Mexico',array['墨西哥'],'TikTok','Neutral',3) returning market_contexts`, [ids.user, ids.product])).rows[0];
      assert.deepEqual(row.market_contexts, [{ legacyLabel: "墨西哥", marketCode: "MX", locale: "es-MX", mappingStatus: "mapped" }]);
    });
    const row = (await db.query("select market_code,locale,mapping_status from market_creatives where campaign_id=$1", [ids.batch])).rows[0];
    assert.deepEqual(row, { market_code: null, locale: null, mapping_status: "needs_confirmation" });
  } finally { await db.close(); }
});

test("project membership and sources cannot attach another user's product", async () => {
  const db = await createDatabase();
  try {
    const project = await ownerProject(db);
    await asUser(db, ids.user, async () => {
      await assert.rejects(() => db.query("insert into project_products(project_id,product_id) values ($1,$2)", [project, ids.otherProduct]));
      await db.query("insert into product_sources(project_id,product_id,kind,excerpt) values ($1,$2,'merchant_text','Approved data')", [project, ids.product]);
    });
    await asUser(db, ids.otherUser, async () => {
      assert.equal((await db.query("select * from projects")).rows.length, 0);
      assert.equal((await db.query("select * from product_sources")).rows.length, 0);
      await assert.rejects(() => db.query("insert into product_sources(project_id,product_id,kind,excerpt) values ($1,$2,'merchant_text','Other')", [project, ids.product]));
    });
  } finally { await db.close(); }
});

test("facts require matching source provenance and cannot silently rewrite confirmation", async () => {
  const db = await createDatabase();
  try {
    const p1 = await ownerProject(db, "One"); const p2 = await ownerProject(db, "Two");
    await asUser(db, ids.user, async () => {
      const source = (await db.query("insert into product_sources(project_id,product_id,kind,excerpt) values ($1,$2,'merchant_text','Portable') returning id", [p1, ids.product])).rows[0].id;
      await assert.rejects(() => db.query("insert into product_facts(project_id,product_id,source_id,statement) values ($1,$2,$3,'Portable')", [p2, ids.product, source]));
      const fact = (await db.query("insert into product_facts(project_id,product_id,source_id,statement,confirmation_status) values ($1,$2,$3,'Portable','confirmed') returning id,confirmed_by", [p1, ids.product, source])).rows[0];
      assert.equal(fact.confirmed_by, ids.user);
      await assert.rejects(() => db.query("update product_facts set statement='New claim' where id=$1", [fact.id]));
      await assert.rejects(() => db.query("update product_sources set excerpt='Changed evidence' where id=$1", [source]));
    });
  } finally { await db.close(); }
});

test("B0/B1 and revisions coexist; ad bindings reject wrong market or project", async () => {
  const db = await createDatabase();
  try {
    const project = await ownerProject(db);
    await asUser(db, ids.user, async () => {
      const snapshot = (await db.query("select id from product_spec_versions where product_id=$1 and version=3", [ids.product])).rows[0].id;
      const make = async (kind, market = "US", locale = "en-US") => (await db.query(`insert into creative_variants(project_id,product_id,spec_version_id,market_code,locale,variant_kind)
        values ($1,$2,$3,$4,$5,$6) returning id`, [project, ids.product, snapshot, market, locale, kind])).rows[0].id;
      const b0 = await make("B0"); const b1 = await make("B1");
      assert.notEqual(b0, b1);
      await assert.rejects(() => make("B1", "MX", "en-US"));
      const revision = (await db.query(`insert into creative_variants(project_id,product_id,spec_version_id,market_code,locale,variant_kind,parent_id,revision)
        values ($1,$2,$3,'US','en-US','B1',$4,2) returning id`, [project, ids.product, snapshot, b1])).rows[0].id;
      assert.notEqual(revision, b1);
      await db.query("update creative_variants set status='needs_review' where id=$1", [revision]);
      assert.equal((await db.query("select status from creative_variants where id=$1", [revision])).rows[0].status, "needs_review");
      await assert.rejects(() => db.query("update creative_variants set script='{}',direction='Overwrite' where id=$1", [revision]));
      const campaign = (await db.query("insert into ad_campaign_drafts(project_id,name) values ($1,'US_TRAFFIC_COFFEE') returning id", [project])).rows[0].id;
      const group = (await db.query("insert into ad_group_drafts(project_id,campaign_id,product_id,market_code,locale,name) values ($1,$2,$3,'MX','es-MX','MX') returning id", [project,campaign,ids.product])).rows[0].id;
      const ad = (await db.query("insert into ad_drafts(project_id,ad_group_id,product_id,name) values ($1,$2,$3,'B1') returning id", [project,group,ids.product])).rows[0].id;
      await assert.rejects(() => db.query("insert into ad_asset_bindings(project_id,product_id,ad_id,variant_id) values ($1,$2,$3,$4)", [project,ids.product,ad,b1]));
      const mx = await make("B1", "MX", "es-MX");
      await db.query("insert into ad_asset_bindings(project_id,product_id,ad_id,variant_id) values ($1,$2,$3,$4)", [project,ids.product,ad,mx]);
      await assert.rejects(() => db.query("update ad_group_drafts set market_code='US',locale='en-US' where id=$1", [group]));
      const otherGroup = (await db.query("insert into ad_group_drafts(project_id,campaign_id,product_id,market_code,locale,name) values ($1,$2,$3,'US','en-US','US') returning id", [project,campaign,ids.product])).rows[0].id;
      await assert.rejects(() => db.query("update ad_drafts set ad_group_id=$1 where id=$2", [otherGroup,ad]));
      assert.equal((await db.query("select count(*)::int as n from campaigns where id=$1", [ids.batch])).rows[0].n, 1);
    });
  } finally { await db.close(); }
});

test("budget type, amount, scope and schedule cannot contradict each other", async () => {
  const db = await createDatabase();
  try {
    const project = await ownerProject(db);
    await asUser(db, ids.user, async () => {
      await assert.rejects(() => db.query("insert into ad_campaign_drafts(project_id,name,budget_amount) values ($1,'Bad',100)", [project]));
      await assert.rejects(() => db.query("insert into ad_campaign_drafts(project_id,name,budget_strategy,budget_mode) values ($1,'Missing amount','CAMPAIGN','DAILY')", [project]));
      await assert.rejects(() => db.query("insert into ad_campaign_drafts(project_id,name,budget_strategy,budget_mode,budget_amount) values ($1,'NaN','CAMPAIGN','DAILY','NaN')", [project]));
      const campaign = (await db.query(`insert into ad_campaign_drafts(project_id,name,budget_strategy,budget_mode,budget_amount)
        values ($1,'CBO','CAMPAIGN','DAILY',100) returning id`, [project])).rows[0].id;
      await assert.rejects(() => db.query(`insert into ad_group_drafts(project_id,campaign_id,product_id,name,market_code,locale,budget_mode,budget_amount)
        values ($1,$2,$3,'Bad','US','en-US','DAILY',30)`, [project,campaign,ids.product]));
      await assert.rejects(() => db.query(`insert into ad_group_drafts(project_id,campaign_id,product_id,name,market_code,locale,starts_at,ends_at)
        values ($1,$2,$3,'Bad','US','en-US','2026-12-02T00:00:00Z','2026-12-01T00:00:00Z')`, [project,campaign,ids.product]));
    });
  } finally { await db.close(); }
});


test("a live Spec cannot be removed and re-created as an old missing version", async () => {
  const db = await createDatabase();
  try {
    await asUser(db, ids.user, async () => {
      await assert.rejects(() => db.query("delete from product_specs where product_id=$1", [ids.product]));
    });
    // Even a privileged manual deletion must never allow version-number reuse.
    await db.query("delete from product_specs where product_id=$1", [ids.product]);
    await asUser(db, ids.user, async () => {
      await assert.rejects(() => db.query("insert into product_specs(product_id,spec,version) values ($1,'{\"unrelated\":true}',1)", [ids.product]));
      assert.equal((await db.query("select spec_history_status from legacy_creative_batches where id=$1", [ids.batch])).rows[0].spec_history_status, "unavailable");
    });
  } finally { await db.close(); }
});

test("legacy batches cannot acquire fabricated v1 when the live Spec was already missing", async () => {
  const db = await createDatabase({ missingSpec: true });
  try {
    await asUser(db, ids.user, async () => {
      await assert.rejects(() => db.query("insert into product_specs(product_id,spec,version) values ($1,'{}',1)", [ids.product]));
      assert.equal((await db.query("select spec_history_status from legacy_creative_batches where id=$1", [ids.batch])).rows[0].spec_history_status, "unavailable");
    });
  } finally { await db.close(); }
});

test("raw source records are append-only even before fact confirmation", async () => {
  const db = await createDatabase();
  try {
    const project = await ownerProject(db);
    await asUser(db, ids.user, async () => {
      const source = (await db.query("insert into product_sources(project_id,product_id,kind,excerpt) values ($1,$2,'merchant_text','Original') returning id", [project,ids.product])).rows[0].id;
      await assert.rejects(() => db.query("update product_sources set kind='market_reference',excerpt='Different' where id=$1", [source]));
    });
  } finally { await db.close(); }
});

test("confirmed creative evidence stays frozen after a status downgrade", async () => {
  const db = await createDatabase();
  try {
    const graph = await populatedGraph(db);
    await asUser(db, ids.user, async () => {
      // Draft evidence is editable.
      await db.query("delete from creative_variant_facts where variant_id=$1", [graph.variant]);
      await db.query("insert into creative_variant_facts(variant_id,fact_id,project_id,product_id) values ($1,$2,$3,$4)", [graph.variant,graph.fact,graph.project,ids.product]);
      await db.query("update creative_variants set status='script_confirmed' where id=$1", [graph.variant]);
      await db.query("update creative_variants set status='draft' where id=$1", [graph.variant]);
      await assert.rejects(() => db.query("delete from creative_variant_facts where variant_id=$1", [graph.variant]));
      await assert.rejects(() => db.query("update creative_variant_facts set variant_id=gen_random_uuid() where variant_id=$1", [graph.variant]));
    });
  } finally { await db.close(); }
});

for (const parent of ["project", "product", "account"]) {
  test(`deleting a populated ${parent} completes all dependent cascades`, async () => {
    const db = await createDatabase();
    try {
      const graph = await populatedGraph(db);
      await asUser(db, ids.user, async () => {
        await db.query("update creative_variants set status='script_confirmed' where id=$1", [graph.variant]);
        if (parent === "project") await db.query("delete from projects where id=$1", [graph.project]);
        if (parent === "product") await db.query("delete from products where id=$1", [ids.product]);
      });
      if (parent === "account") await db.query("delete from auth.users where id=$1", [ids.user]);
      for (const table of ["product_sources", "product_facts", "creative_variants", "creative_variant_facts", "ad_group_drafts", "ad_drafts", "ad_asset_bindings"]) {
        assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0, table);
      }
      assert.equal((await db.query("select count(*)::int as n from products where id=$1", [ids.product])).rows[0].n, parent === "project" ? 1 : 0);
      assert.equal((await db.query("select count(*)::int as n from products where id=$1", [ids.otherProduct])).rows[0].n, 1);
    } finally { await db.close(); }
  });
}

test("market consistency survives bypass of procedural checks via relational keys", async () => {
  const db = await createDatabase();
  try {
    const graph = await populatedGraph(db);
    // A privileged path can bypass user triggers; actual relational keys still protect joins.
    await db.exec("alter table ad_asset_bindings disable trigger user; alter table ad_drafts disable trigger user; alter table ad_group_drafts disable trigger user");
    const row = (await db.query("select market_code,locale from ad_drafts where id=$1", [graph.ad])).rows[0];
    assert.deepEqual(row, { market_code: "US", locale: "en-US" });
    await assert.rejects(() => db.query("update ad_drafts set market_code='MX',locale='es-MX' where id=$1", [graph.ad]));
    await assert.rejects(() => db.query("update ad_group_drafts set market_code='MX',locale='es-MX' where id=$1", [graph.group]));
    await assert.rejects(() => db.query("update ad_asset_bindings set market_code='MX',locale='es-MX' where ad_id=$1", [graph.ad]));
  } finally { await db.close(); }
});

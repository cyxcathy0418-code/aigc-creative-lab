import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { saveProductSpec } from "../lib/products/spec-save.ts";
import { asUser, createDatabase, ids } from "./helpers/passport-db.mjs";
import { validSpec } from "./helpers/valid-spec.mjs";

// Only the external PostgREST transport is replaced. The production Supabase
// client, request contract, merge/validation, version conditions and SQL execute.
function sqlTransport(db, afterRead = async () => {}) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.pathname, "/rest/v1/product_specs");
    assert.equal(url.searchParams.get("product_id"), `eq.${ids.product}`);
    let rows;
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      const expected = url.searchParams.get("version")?.replace("eq.", "");
      try {
        rows = expected ? (await db.query("update product_specs set spec=$1,version=$2 where product_id=$3 and version=$4 returning spec,version,updated_at", [body.spec,body.version,ids.product,expected])).rows
          : (await db.query("update product_specs set spec=$1,version=$2 where product_id=$3 returning spec,version,updated_at", [body.spec,body.version,ids.product])).rows;
      } catch (error) { return Response.json({ message: error.message, code: error.code }, { status: 400 }); }
    } else {
      rows = (await db.query("select spec,version,updated_at from product_specs where product_id=$1", [ids.product])).rows;
      await afterRead();
    }
    const object = new Headers(init.headers).get("accept")?.includes("object+json");
    if (object && rows.length === 0) return Response.json({ code: "PGRST116", details: "The result contains 0 rows", message: "Cannot coerce the result to a single JSON object" }, { status: 406 });
    return Response.json(object ? rows[0] : rows);
  };
}
function clientFor(db, afterRead) {
  return createClient("https://test.invalid", "test-anon", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: sqlTransport(db, afterRead) } });
}
async function initialized() {
  const db = await createDatabase();
  await asUser(db, ids.user, () => db.query("update product_specs set spec=$1,version=4 where product_id=$2", [validSpec,ids.product]));
  return db;
}

test("the save contract rejects a stale editor without overwriting newer fields", async () => {
  const db = await initialized();
  try {
    await asUser(db, ids.user, async () => {
      const client = clientFor(db);
      const first = await saveProductSpec(client, ids.product, { expectedVersion: 4, spec: { ...validSpec, brandTone: ["新调性"] } });
      assert.equal(first.version, 5);
      await assert.rejects(() => saveProductSpec(client, ids.product, { expectedVersion: 4, spec: validSpec }), (error) => error.status === 409);
      assert.deepEqual((await db.query("select spec from product_specs where product_id=$1", [ids.product])).rows[0].spec.brandTone, ["新调性"]);
      await assert.rejects(() => saveProductSpec(client, ids.product, { spec: validSpec }), (error) => error.status === 400);
    });
  } finally { await db.close(); }
});

test("two saves after the same read atomically accept only one revision", async () => {
  const db = await initialized();
  try {
    let reads = 0; let release;
    const bothRead = new Promise((resolve) => { release = resolve; });
    const client = clientFor(db, async () => { if (++reads === 2) release(); await bothRead; });
    await asUser(db, ids.user, async () => {
      const results = await Promise.allSettled([
        saveProductSpec(client, ids.product, { expectedVersion: 4, spec: { ...validSpec, brandTone: ["A"] } }),
        saveProductSpec(client, ids.product, { expectedVersion: 4, spec: { ...validSpec, brandTone: ["B"] } }),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
      assert.deepEqual((await db.query("select version from product_spec_versions order by version")).rows.map((row) => row.version), [3,4,5]);
    });
  } finally { await db.close(); }
});

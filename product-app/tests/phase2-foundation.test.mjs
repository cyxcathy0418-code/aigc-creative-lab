import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("paid Phase 2 capabilities are off by default and use reference-image editing", async () => {
  const [envExample, campaignRoute, generationRoute, provider] =
    await Promise.all([
      readFile(new URL("../.env.example", import.meta.url), "utf8"),
      readFile(new URL("../app/api/campaigns/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/campaigns/[id]/generate/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../lib/generation/provider.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(envExample, /OPENAI_CREATIVE_DERIVATION_ENABLED=false/);
  assert.match(envExample, /OPENAI_IMAGE_GENERATION_ENABLED=false/);
  assert.match(envExample, /OPENAI_IMAGE_MAX_ATTEMPTS=1/);
  assert.match(campaignRoute, /OPENAI_CREATIVE_DERIVATION_ENABLED/);
  assert.match(generationRoute, /OPENAI_IMAGE_GENERATION_ENABLED/);
  assert.match(provider, /client\.images\.edit/);
  assert.doesNotMatch(provider, /client\.images\.generate/);
  assert.match(provider, /referenceImages/);
});

test("Phase 2 migration scopes every table to its owning user without billing", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202607280002_phase2_campaigns.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const table of [
    "campaigns",
    "market_creatives",
    "generation_jobs",
    "generated_assets",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /campaigns_target_markets_count/);
  assert.match(migration, /reference_image_ids uuid\[\] not null/);
  assert.doesNotMatch(migration, /credits|stripe|payment/i);
});


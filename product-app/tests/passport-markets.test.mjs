import assert from "node:assert/strict";
import { test } from "node:test";
import * as product from "../lib/products/schema.ts";
import { CampaignCreateSchema, MarketCreativeDraftSetSchema } from "../lib/campaigns/schema.ts";
import { deriveMarketCreatives } from "../lib/campaigns/derivation.ts";

test("a single Mexico market can enter the legacy batch workflow", () => {
  const result = CampaignCreateSchema.safeParse({
    productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Mexico pilot", targetMarkets: ["墨西哥"],
  });
  assert.equal(result.success, true, result.error?.message);
  assert.equal(product.MARKET_FILE_CODES["墨西哥"], "MX");
});

test("normalization does not turn broad regions into a country or language", () => {
  assert.equal(typeof product.normalizeMarket, "function");
  assert.deepEqual(product.normalizeMarket("墨西哥"), {
    legacyLabel: "墨西哥", marketCode: "MX", locale: "es-MX", mappingStatus: "mapped",
  });
  assert.deepEqual(product.normalizeMarket("欧洲"), {
    legacyLabel: "欧洲", marketCode: null, locale: null, mappingStatus: "needs_confirmation",
  });
  assert.equal(product.normalizeMarket("东南亚").locale, null);
  assert.throws(() => product.normalizeMarket("Atlantis"));
});

test("duplicate and unknown markets remain rejected", () => {
  const base = { productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "pilot" };
  assert.equal(CampaignCreateSchema.safeParse({ ...base, targetMarkets: ["墨西哥", "墨西哥"] }).success, false);
  assert.equal(CampaignCreateSchema.safeParse({ ...base, targetMarkets: ["Atlantis"] }).success, false);
});

test("one-market output is finalized through the real derivation path", async () => {
  const spec = {
    productIdentity: { name: "Cup", category: "杯", oneLine: "blue cup" },
    visualAnchor: {
      primaryColor: { name: "blue", hex: "#0000FF" }, secondaryColors: [],
      material: "steel", silhouette: "cylinder", proportions: "2:1",
      brandMarking: { markType: "none", textContent: "无", graphicDescription: "无", position: "无", applicationMethod: "无", appearance: "无", preservationLevel: "omit_if_unclear" },
      distinctiveDetails: [],
    }, sellingPoints: [{ point: "便携", priority: 1 }], brandTone: [], visualTaboos: [], anchorSentence: "blue steel cup",
  };
  const creative = {
    market: "墨西哥", language: "Spanish (Mexico)", localizationFocus: "待验证使用场景", complianceNote: "No unsupported claims",
    hook: "Tu pausa", hookZh: "你的休息", bodyCopy: "Conoce Cup", bodyCopyZh: "了解 Cup", cta: "Ver detalles", ctaZh: "查看详情",
    storyboard: [3, 5, 7].map((durationSeconds, i) => ({ sequence: i + 1, durationSeconds, visual: "Cup on a desk", onScreenCopy: "Cup", onScreenCopyZh: "Cup", voiceover: "Cup", voiceoverZh: "Cup" })),
    imagePromptDraft: "Cup in a neutral setting, no invented features",
  };
  assert.equal(MarketCreativeDraftSetSchema.safeParse({ creatives: [creative] }).success, true);
  const result = await deriveMarketCreatives(
    { spec, targetMarkets: ["墨西哥"], platform: "TikTok", stylePreference: "Neutral" },
    { name: "fixture", model: "offline", async derive() { return { rawOutput: JSON.stringify({ creatives: [creative] }) }; } }, 1,
  );
  assert.equal(result.creatives.length, 1);
  assert.match(result.creatives[0].imagePromptFinal, /blue steel cup/);
});

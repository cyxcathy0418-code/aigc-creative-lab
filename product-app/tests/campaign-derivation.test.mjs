import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CreativeDerivationError,
  deriveMarketCreatives,
} from "../lib/campaigns/derivation.ts";
import {
  buildCreativeDerivationPrompt,
  buildSafeSpecView,
} from "../lib/campaigns/prompt.ts";

const spec = {
  productIdentity: {
    name: "TINTLOOP",
    category: "保温杯",
    oneLine: "深蓝色高挑直筒保温杯",
  },
  visualAnchor: {
    primaryColor: { name: "深蓝", hex: "#163A5F" },
    secondaryColors: [{ name: "白色", hex: "#FFFFFF" }],
    material: "不锈钢杯身与塑料杯盖",
    silhouette: "高挑直筒，圆角杯肩",
    brandMarking: {
      markType: "wordmark",
      textContent: "TINTLOOP",
      graphicDescription: "无",
      position: "杯身正面",
      applicationMethod: "丝印",
      appearance: "白色小号文字",
      preservationLevel: "required",
    },
    distinctiveDetails: ["窄长杯身", "正面白色文字标"],
    proportions: "高宽比约 3:1",
  },
  sellingPoints: [
    { point: "长效保温", priority: 1 },
    { point: "密封防漏", priority: 2 },
  ],
  brandTone: ["可靠", "现代"],
  visualTaboos: ["改变主色", "增加其他品牌"],
  anchorSentence:
    "深蓝色高挑直筒不锈钢杯身，正面带白色 TINTLOOP 文字标",
};

function creative(market, language) {
  return {
    market,
    language,
    localizationFocus: `${market} 本地日常`,
    complianceNote: "不使用绝对化功效承诺",
    hook: market === "美国" ? "Own your pace." : "오늘의 리듬을 지켜요.",
    hookZh: market === "美国" ? "掌握自己的节奏。" : "守住今天的节奏。",
    bodyCopy: market === "美国" ? "Made for the day ahead." : "하루를 위한 믿음직한 선택.",
    bodyCopyZh: "可靠陪伴一天。",
    cta: market === "美国" ? "Meet your everyday carry." : "지금 만나보세요.",
    ctaZh: "了解你的日常随行选择。",
    storyboard: [
      {
        sequence: 1,
        durationSeconds: 3,
        visual: "The product enters a morning routine.",
        onScreenCopy: "Start here",
        onScreenCopyZh: "从这里开始",
        voiceover: "Start here",
        voiceoverZh: "从这里开始",
      },
      {
        sequence: 2,
        durationSeconds: 5,
        visual: "A person carries the product through the day.",
        onScreenCopy: "Built for the day",
        onScreenCopyZh: "为日常而设",
        voiceover: "Keep moving",
        voiceoverZh: "继续前行",
      },
      {
        sequence: 3,
        durationSeconds: 7,
        visual: "The product rests in a clean final composition.",
        onScreenCopy: "Make it yours",
        onScreenCopyZh: "成为你的选择",
        voiceover: "Make it yours",
        voiceoverZh: "成为你的选择",
      },
    ],
    imagePromptDraft:
      "Editorial commercial image of the product in a localized morning scene, restrained light, concise clean overlay copy.",
  };
}

const request = {
  spec,
  targetMarkets: ["美国", "韩国"],
  platform: "Meta",
  stylePreference: "克制的编辑感产品摄影",
};

test("safe creative input excludes every product identity field", () => {
  const safeView = buildSafeSpecView(spec);
  const prompt = buildCreativeDerivationPrompt(request);

  assert.deepEqual(Object.keys(safeView), [
    "productCategory",
    "sellingPoints",
    "brandTone",
  ]);
  assert.doesNotMatch(prompt, /TINTLOOP|#163A5F|高挑直筒/);
  assert.match(prompt, /长效保温/);
  assert.match(prompt, /Chinese translations are review metadata/);
  assert.match(prompt, /must not contain "the product"/);
});

test("derives exact markets and adds the same verified anchor to each prompt", async () => {
  const provider = {
    name: "mock",
    model: "mock-creative",
    async derive() {
      const parsed = {
        creatives: [creative("美国", "English (US)"), creative("韩国", "Korean")],
      };
      return {
        rawOutput: JSON.stringify(parsed),
        parsed,
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      };
    },
  };

  const result = await deriveMarketCreatives(request, provider, 1);
  assert.deepEqual(
    result.creatives.map((item) => item.market),
    ["美国", "韩国"],
  );
  assert.equal(result.attempts, 1);
  assert.equal(
    result.creatives[0].anchorBlock,
    result.creatives[1].anchorBlock,
  );
  assert.match(result.creatives[0].imagePromptFinal, /TINTLOOP/);
  assert.match(result.creatives[0].imagePromptFinal, /reference images are authoritative/i);
});

test("rejects product placeholders in user-facing advertising copy", async () => {
  const provider = {
    name: "mock",
    model: "mock-creative",
    async derive() {
      const us = creative("美国", "English (US)");
      const korea = creative("韩国", "Korean");
      korea.hook = "the product — 작고 가벼워.";
      return {
        rawOutput: JSON.stringify({ creatives: [us, korea] }),
        parsed: { creatives: [us, korea] },
      };
    },
  };

  await assert.rejects(
    () => deriveMarketCreatives(request, provider, 1),
    (error) => {
      assert.equal(error instanceof CreativeDerivationError, true);
      assert.equal(error.attempts, 1);
      assert.match(error.message, /广告文案不能包含商品占位词/);
      return true;
    },
  );
});

test("rejects missing markets after a bounded retry", async () => {
  let calls = 0;
  const provider = {
    name: "mock",
    model: "mock-creative",
    async derive() {
      calls += 1;
      const parsed = {
        creatives: [creative("美国", "English (US)"), creative("日本", "Japanese")],
      };
      return { rawOutput: JSON.stringify(parsed), parsed };
    },
  };

  await assert.rejects(
    () => deriveMarketCreatives(request, provider, 2, async () => {}),
    (error) => {
      assert.equal(error instanceof CreativeDerivationError, true);
      assert.equal(error.attempts, 2);
      assert.match(error.message, /市场覆盖不一致/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

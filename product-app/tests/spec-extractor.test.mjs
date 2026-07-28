import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractProductSpec,
  SpecExtractionError,
} from "../lib/products/extractor.ts";

const brief = {
  name: "测试保温杯",
  sellingPoints: "防漏、长效保温",
  brandTone: "可靠、现代",
  targetMarkets: ["美国"],
  platform: "Meta",
  stylePreference: "干净的产品摄影",
  materialHint: "不锈钢",
};

const validSpec = {
  productIdentity: {
    name: "测试保温杯",
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

const images = [
  {
    mimeType: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71]),
  },
];

test("accepts parsed structured output on the first attempt", async () => {
  const provider = {
    async extract() {
      return {
        rawOutput: JSON.stringify(validSpec),
        parsed: validSpec,
      };
    },
  };

  const result = await extractProductSpec({ brief, images }, provider);

  assert.deepEqual(result.spec, validSpec);
  assert.equal(result.attempts, 1);
});

test("feeds validation errors into the next extraction attempt", async () => {
  const requests = [];
  const invalidSpec = structuredClone(validSpec);
  invalidSpec.visualAnchor.brandMarking.textContent = "未知";

  const provider = {
    async extract(request) {
      requests.push(request);
      const parsed = requests.length === 1 ? invalidSpec : validSpec;
      return {
        rawOutput: JSON.stringify(parsed),
        parsed,
      };
    },
  };

  const delays = [];
  const result = await extractProductSpec(
    { brief, images },
    provider,
    3,
    async (milliseconds) => {
      delays.push(milliseconds);
    },
  );

  assert.equal(result.attempts, 2);
  assert.equal(requests[0].previousError, undefined);
  assert.match(requests[1].previousError, /文字标必须填写可读的品牌文字/);
  assert.deepEqual(delays, [1000]);
});

test("returns a bounded final error after three failed attempts", async () => {
  let calls = 0;
  const provider = {
    async extract() {
      calls += 1;
      return {
        rawOutput: "{not-json",
      };
    },
  };

  const delays = [];

  await assert.rejects(
    () =>
      extractProductSpec(
        { brief, images },
        provider,
        3,
        async (milliseconds) => {
          delays.push(milliseconds);
        },
      ),
    (error) => {
      assert.equal(error instanceof SpecExtractionError, true);
      assert.equal(error.attempts, 3);
      assert.match(error.message, /3 次尝试后仍未通过/);
      return true;
    },
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

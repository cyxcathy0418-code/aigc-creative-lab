import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BrandMarkingSpecSchema,
  ProductSpecSchema,
} from "../lib/products/schema.ts";

const baseMarking = {
  markType: "wordmark",
  textContent: "TINTLOOP",
  graphicDescription: "无",
  position: "杯身正面",
  applicationMethod: "丝印",
  appearance: "白色小号文字",
  preservationLevel: "required",
};

const baseSpec = {
  productIdentity: {
    name: "测试商品",
    category: "保温杯",
    oneLine: "一款高挑直筒形保温杯",
  },
  visualAnchor: {
    primaryColor: { name: "深蓝", hex: "#163A5F" },
    secondaryColors: [{ name: "白色", hex: "#FFFFFF" }],
    material: "不锈钢杯身，塑料杯盖",
    silhouette: "高挑直筒，圆角杯肩",
    brandMarking: baseMarking,
    distinctiveDetails: ["窄长杯身", "正面白色文字标"],
    proportions: "高宽比约 3:1",
  },
  sellingPoints: [
    { point: "长效保温", priority: 1 },
    { point: "密封防漏", priority: 2 },
  ],
  brandTone: ["可靠", "现代"],
  visualTaboos: ["改变主色", "增加其他品牌"],
  anchorSentence: "深蓝色高挑直筒不锈钢杯身，正面带白色 TINTLOOP 文字标",
};

test("accepts a complete ProductSpec", () => {
  assert.equal(ProductSpecSchema.safeParse(baseSpec).success, true);
});

test("enforces all brand marking conditional branches", () => {
  const cases = [
    {
      value: {
        markType: "none",
        textContent: "无",
        graphicDescription: "无",
        position: "无",
        applicationMethod: "无",
        appearance: "无",
        preservationLevel: "omit_if_unclear",
      },
      valid: true,
    },
    {
      value: {
        ...baseMarking,
        markType: "wordmark",
        textContent: "未知",
      },
      valid: false,
    },
    {
      value: {
        ...baseMarking,
        markType: "graphic_mark",
        textContent: "无",
        graphicDescription: "两枚交叠圆环",
      },
      valid: true,
    },
    {
      value: {
        ...baseMarking,
        markType: "combined_mark",
        graphicDescription: "无",
      },
      valid: false,
    },
    {
      value: {
        ...baseMarking,
        markType: "unreadable",
        textContent: "未知",
      },
      valid: true,
    },
  ];

  for (const item of cases) {
    assert.equal(BrandMarkingSpecSchema.safeParse(item.value).success, item.valid);
  }
});

test("rejects invalid colors and duplicate selling-point priorities", () => {
  const invalid = structuredClone(baseSpec);
  invalid.visualAnchor.primaryColor.hex = "navy";
  invalid.sellingPoints[1].priority = 1;

  const result = ProductSpecSchema.safeParse(invalid);
  assert.equal(result.success, false);
  assert.match(
    result.error.issues.map((issue) => issue.message).join(" "),
    /色值|优先级/,
  );
});

test("enforces bounded ProductSpec arrays and anchor length", () => {
  const invalid = structuredClone(baseSpec);
  invalid.visualAnchor.distinctiveDetails = Array.from(
    { length: 9 },
    (_, index) => `细节${index}`,
  );
  invalid.anchorSentence = "锚".repeat(61);

  assert.equal(ProductSpecSchema.safeParse(invalid).success, false);
});

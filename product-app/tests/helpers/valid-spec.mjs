const baseMarking = {
  markType: "wordmark",
  textContent: "TINTLOOP",
  graphicDescription: "无",
  position: "杯身正面",
  applicationMethod: "丝印",
  appearance: "白色小号文字",
  preservationLevel: "required",
};

export const validSpec = {
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


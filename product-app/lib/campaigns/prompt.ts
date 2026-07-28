import type { ProductSpec } from "../products/schema.ts";

export const MARKET_LOCALIZATION_POLICIES = {
  美国: {
    language: "English (US)",
    scene: "An individual-led active lifestyle scene: training, a morning run, or an outdoor pursuit. Casting should feel self-directed, confident, and naturally diverse.",
    angle: "Lead with personal progress and self-expression. Make the first frame feel active and consequential.",
    voice: "Direct, energetic, conversational, and concise.",
    compliance: "Avoid absolute superiority, guaranteed outcomes, medical implications, and stereotyped casting.",
  },
  欧洲: {
    language: "English (international)",
    scene: "A quiet, design-aware daily setting with restrained styling, natural materials, and considered negative space.",
    angle: "Lead with considered design, durability, and long-term value without inventing sustainability claims.",
    voice: "Calm, understated, precise, and credible.",
    compliance: "Avoid unverified environmental, health, or performance claims and do not flatten Europe into one national stereotype.",
  },
  日本: {
    language: "Japanese",
    scene: "A compact, orderly home, commute, or desk environment where small practical details matter.",
    angle: "Lead with thoughtful everyday fit and refined details, using only the confirmed selling points.",
    voice: "Quiet, economical, observant, and never pushy.",
    compliance: "Avoid pressure selling, fabricated certifications, exaggerated comparisons, and anxiety-based messaging.",
  },
  韩国: {
    language: "Korean",
    scene: "A contemporary café, street-style, or social-sharing moment with editorial camera awareness.",
    angle: "Lead with how the confirmed benefit fits a design-conscious, shareable daily ritual.",
    voice: "Light, current, rhythmic, and socially fluent.",
    compliance: "Avoid appearance anxiety, unverified endorsements, exaggerated effects, and stereotyped casting.",
  },
  东南亚: {
    language: "English (Southeast Asia)",
    scene: "A lived-in household or everyday outing in a warm climate, with practical movement and more than one person where appropriate.",
    angle: "Lead with the most relevant confirmed practical benefit; do not invent cooling, price, or family-use claims.",
    voice: "Clear, warm, practical, and easy to understand.",
    compliance: "Avoid religious, ethnic, and regional clichés; keep clothing and settings respectful and never invent price or performance guarantees.",
  },
} as const;

export const ANCHOR_REFERENCE_FIELDS = [
  "productIdentity.name",
  "productIdentity.category",
  "visualAnchor.primaryColor",
  "visualAnchor.secondaryColors",
  "visualAnchor.material",
  "visualAnchor.silhouette",
  "visualAnchor.brandMarking",
  "visualAnchor.distinctiveDetails",
  "visualAnchor.proportions",
  "visualTaboos",
  "anchorSentence",
] as const;

export function buildSafeSpecView(spec: ProductSpec) {
  return {
    productCategory: spec.productIdentity.category,
    sellingPoints: spec.sellingPoints,
    brandTone: spec.brandTone,
  };
}

export function buildAnchorBlock(spec: ProductSpec) {
  const visual = spec.visualAnchor;
  const marking = visual.brandMarking;
  const clauses = [
    spec.anchorSentence.replace(/[。.]+$/u, ""),
    `主色为${visual.primaryColor.name}（${visual.primaryColor.hex}）${
      visual.secondaryColors.length
        ? `，辅以${visual.secondaryColors
            .map((color) => `${color.name}（${color.hex}）`)
            .join("、")}`
        : ""
    }`,
    `材质为${visual.material}`,
    `整体呈${visual.silhouette}，${visual.proportions}`,
  ];

  if (marking.markType === "wordmark") {
    clauses.push(
      `${marking.applicationMethod}呈现的文字品牌标识“${marking.textContent}”位于${marking.position}，视觉表现为${marking.appearance}`,
    );
  } else if (marking.markType === "graphic_mark") {
    clauses.push(
      `${marking.applicationMethod}呈现的图形品牌标识位于${marking.position}，图案为${marking.graphicDescription}，视觉表现为${marking.appearance}`,
    );
  } else if (marking.markType === "combined_mark") {
    clauses.push(
      `${marking.applicationMethod}呈现的图文品牌标识位于${marking.position}，文字为“${marking.textContent}”，图案为${marking.graphicDescription}，视觉表现为${marking.appearance}`,
    );
  } else if (marking.markType === "none") {
    clauses.push("商品表面没有品牌文字、图形徽标或装饰性商标");
  } else {
    clauses.push(
      `${marking.position}存在不可读的品牌标识，外观为${marking.appearance}`,
    );
  }

  if (visual.distinctiveDetails.length) {
    clauses.push(`保留${visual.distinctiveDetails.join("、")}`);
  }

  const lines = [
    "PRODUCT IDENTITY — the reference images are authoritative. Reproduce this exact product; do not redesign, substitute, or reinterpret it.",
    `${clauses.filter(Boolean).join("；")}。`,
    "Keep every visible part, color, material, proportion, and distinctive detail consistent with the reference images.",
  ];

  if (spec.visualTaboos.length) {
    lines.push(`Never depict: ${spec.visualTaboos.join("、")}。`);
  }

  if (marking.markType === "none") {
    lines.push(
      "Do not add a brand name, logo, badge, label, or trademark to the product.",
    );
  } else if (
    marking.markType === "wordmark" &&
    marking.preservationLevel === "required"
  ) {
    lines.push(
      `Reproduce the exact wordmark "${marking.textContent}" at the stated position. If exact text cannot be rendered, do not replace it with invented text or a graphic.`,
    );
  } else if (
    marking.markType === "unreadable" ||
    marking.preservationLevel === "omit_if_unclear"
  ) {
    lines.push(
      "Do not invent readable brand text or substitute an unrelated logo.",
    );
  } else {
    lines.push(
      "Keep the product's brand marking type, content, position, and finish exactly as shown in the references.",
    );
  }

  return lines.join("\n");
}

export function buildCreativeDerivationPrompt(options: {
  spec: ProductSpec;
  targetMarkets: Array<keyof typeof MARKET_LOCALIZATION_POLICIES>;
  platform: string;
  stylePreference: string;
  previousError?: string;
}) {
  const policies = options.targetMarkets
    .map((market) => {
      const policy = MARKET_LOCALIZATION_POLICIES[market];
      return [
        `MARKET: ${market}`,
        `Language: ${policy.language}`,
        `Scene: ${policy.scene}`,
        `Angle: ${policy.angle}`,
        `Voice: ${policy.voice}`,
        `Compliance: ${policy.compliance}`,
      ].join("\n");
    })
    .join("\n\n");

  return `You are a senior international performance-ad creative strategist.

Create exactly one distinct 15-second ad concept for every requested market.

CONFIRMED NON-VISUAL PRODUCT FACTS
${JSON.stringify(buildSafeSpecView(options.spec), null, 2)}

RESPONSIBILITY BOUNDARY
You have intentionally not received the product name, color, material, shape, proportions, logo, or distinctive visual details. Never guess or describe them. In every visual field, call it only "the product". A separate system will add the product identity and reference images later.
This visual placeholder is never advertising copy. Hooks, body copy, CTA, on-screen copy, and voiceover must not contain "the product", "[product]", a guessed product name, or any other placeholder. If no verified product name is available, write claim-led copy that does not name the item.

CAMPAIGN CONTEXT
Platform: ${options.platform}
Visual style: ${options.stylePreference}
Markets: ${options.targetMarkets.join(", ")}

LOCALIZATION POLICIES
${policies}

OUTPUT RULES
- Return exactly ${options.targetMarkets.length} creatives and cover every requested market once.
- The market field must be the exact Chinese market string supplied above.
- Hooks, body copy, CTA, on-screen copy, and voiceover use the market language. Put their concise Chinese translations only in the matching *Zh review fields.
- Chinese translations are review metadata for the workspace. Never place them in imagePromptDraft, never request a bilingual overlay, and never ask the image model to render Chinese unless Chinese is the selected market language.
- Use only the confirmed selling points. Never invent price, discount, certification, performance, health, sustainability, availability, or endorsement claims.
- Make the first scene, lead benefit, casting, and tone visibly different across markets. Do not merely translate one template.
- Create 3 or 4 consecutive shots whose durationSeconds total exactly 15. The hook must appear in the first 3 seconds.
- imagePromptDraft must be English and describe one finished key advertising image: scene, casting, action, composition, camera, lighting, visual style, and exact localized overlay copy.
- imagePromptDraft must refer to the product only as "the product". Do not state any product appearance.
- The exact overlay copy inside imagePromptDraft must contain only the selected market language and must never contain a product placeholder.
- Keep the overlay concise and ask for clean, legible typography without adding unconfirmed brand marks.
${options.previousError ? `\nCORRECT THE PREVIOUS INVALID OUTPUT\n${options.previousError}\n` : ""}`;
}

export function buildFinalImagePrompt(
  anchorBlock: string,
  imagePromptDraft: string,
) {
  return `${anchorBlock}

MARKET CREATIVE DIRECTION
${imagePromptDraft.trim()}

Use the supplied reference image(s) as the visual source of truth for the product. Change the surrounding campaign scene, people, lighting, composition, and copy treatment only. Produce one finished commercial advertising image, not a contact sheet, storyboard, mockup grid, or before/after comparison.`;
}

import { z } from "zod";

export const DEMO_PROVIDER = "demo-template-v1";
export const SHOT_DURATIONS = [3, 4, 5, 3] as const;
export const FactSchema = z.object({
  id: z.string().uuid(),
  statement: z.string().trim().min(1).max(220),
  source: z.string().trim().min(1).max(600),
  adCopy: z.string().trim().min(1).max(90),
  confirmed: z.boolean(),
});
export const ShotSchema = z.object({
  id: z.string().uuid(),
  duration: z.number().int().min(1).max(8),
  caption: z.string().trim().min(1).max(90),
  factIds: z.array(z.string()).max(5),
  locked: z.boolean(),
});
const imageSchema = z
  .string()
  .max(1_450_000)
  .refine(
    (v) =>
      v === "sample:coffee" ||
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(v),
    "Use a JPEG, PNG or WebP image, or the sample illustration.",
  );
export const DraftSchema = z
  .object({
    id: z.string().uuid(),
    productName: z.string().trim().min(1).max(70),
    market: z.enum(["US", "MX"]),
    locale: z.enum(["en-US", "es-MX"]),
    audience: z.string().trim().min(1).max(180),
    scenario: z.string().trim().min(1).max(240),
    brandTone: z.string().trim().min(1).max(100),
    imageDataUrl: imageSchema,
    theme: z.enum(["forest", "paper"]),
    facts: z.array(FactSchema).min(1).max(5),
    selectedDirection: z.enum(["scenario", "proof", "detail"]).nullable(),
    shots: z.array(ShotSchema).max(4),
    scriptConfirmed: z.boolean(),
    isSample: z.boolean(),
    narration: z
      .object({
        fileName: z.string().min(1).max(200),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        duration: z.number().positive().max(15),
      })
      .nullable()
      .default(null),
  })
  .superRefine((d, ctx) => {
    if (d.locale !== (d.market === "US" ? "en-US" : "es-MX"))
      ctx.addIssue({
        code: "custom",
        path: ["locale"],
        message: "Market and language must match.",
      });
    if (new Set(d.facts.map((f) => f.id)).size !== d.facts.length)
      ctx.addIssue({
        code: "custom",
        path: ["facts"],
        message: "Fact IDs must be unique.",
      });
    if (new Set(d.shots.map((s) => s.id)).size !== d.shots.length)
      ctx.addIssue({
        code: "custom",
        path: ["shots"],
        message: "Shot IDs must be unique.",
      });
  });
export type Draft = z.infer<typeof DraftSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Direction = {
  id: "scenario" | "proof" | "detail";
  title: string;
  hook: string;
  description: string;
  reason: string;
  factIds: string[];
  evidenceType: "creative_hypothesis";
};
export type Snapshot = {
  id: string;
  version: number;
  createdAt: string;
  hash: string;
  draft: Draft;
};
export type Workspace = {
  revision: number;
  draft: Draft | null;
  versions: Snapshot[];
};
export const emptyWorkspace = (): Workspace => ({
  revision: 0,
  draft: null,
  versions: [],
});

export function createSampleDraft(market: "US" | "MX" = "US"): Draft {
  const mx = market === "MX";
  return {
    id: crypto.randomUUID(),
    productName: "ROAM · Hand grinder",
    market,
    locale: mx ? "es-MX" : "en-US",
    audience: mx
      ? "Personas que disfrutan preparar su propio café"
      : "Coffee lovers who enjoy making their own cup",
    scenario: mx
      ? "Una pausa para café durante una escapada de fin de semana"
      : "A coffee break on a quiet weekend away",
    brandTone: "Thoughtful, clear, unhurried",
    imageDataUrl: "sample:coffee",
    theme: "forest",
    selectedDirection: null,
    shots: [],
    scriptConfirmed: false,
    isSample: true,
    narration: null,
    facts: [
      {
        id: crypto.randomUUID(),
        statement: "Manual hand grinder; does not require electricity.",
        source:
          "Fictional demo specification. This is a sample claim, not evidence about a real product.",
        adCopy: mx
          ? "Molido manual. Sin electricidad."
          : "Grind by hand. No outlet needed.",
        confirmed: false,
      },
      {
        id: crypto.randomUUID(),
        statement: "The grinder has a detachable collection cup.",
        source:
          "Fictional demo specification and sample illustration; replace with your own product evidence.",
        adCopy: mx
          ? "Un recipiente desmontable para tu café."
          : "A detachable cup for your coffee.",
        confirmed: false,
      },
    ],
  };
}
export function requireFacts(draft: Draft) {
  DraftSchema.parse(draft);
  if (!draft.facts.some((f) => f.confirmed))
    throw new Error(
      "Confirm at least one fact and its source before continuing.",
    );
  if (
    draft.facts.some(
      (f) => f.confirmed && (!f.source.trim() || !f.adCopy.trim()),
    )
  )
    throw new Error("Confirmed facts need a source and an advertising line.");
}
export function proposeDirections(draft: Draft): Direction[] {
  requireFacts(draft);
  const ids = draft.facts.filter((f) => f.confirmed).map((f) => f.id);
  const mx = draft.market === "MX";
  return [
    {
      id: "scenario",
      title: "A moment worth making",
      hook: mx ? "Un momento para ti." : "A moment, made yours.",
      description: mx
        ? "Abre con una pausa cotidiana y presenta el producto."
        : "Open with an everyday pause, then introduce the product.",
      reason: `Creative hypothesis based on your scenario: ${draft.scenario}. Validate it with people in this market.`,
      factIds: ids,
      evidenceType: "creative_hypothesis",
    },
    {
      id: "proof",
      title: "Let the details speak",
      hook: mx ? "Mira los detalles." : "Look a little closer.",
      description: mx
        ? "Presenta primero una característica confirmada, sin prometer resultados."
        : "Lead with a confirmed feature, without inventing performance claims.",
      reason:
        "Uses your confirmed product evidence. A real usage demonstration needs your own footage.",
      factIds: ids,
      evidenceType: "creative_hypothesis",
    },
    {
      id: "detail",
      title: "Less noise. More product.",
      hook: mx ? "Conoce tu próximo ritual." : "Meet your next ritual.",
      description: mx
        ? "Una presentación visual sencilla, con espacio para el producto."
        : "A quiet product-led story with space to notice the details.",
      reason: `A proposed expression of your brand tone: ${draft.brandTone}. This is not a claim about national preferences.`,
      factIds: ids,
      evidenceType: "creative_hypothesis",
    },
  ];
}
export interface CreativeProvider {
  readonly id: string;
  directions(draft: Draft): Promise<Direction[]>;
  storyboard(draft: Draft, direction: Direction["id"]): Promise<Draft>;
}
export const demoProvider: CreativeProvider = {
  id: DEMO_PROVIDER,
  async directions(d) {
    return proposeDirections(d);
  },
  async storyboard(d, id) {
    return makeStoryboard(d, id);
  },
};
export interface SpeechProvider {
  readonly id: string;
  synthesize(input: {
    text: string;
    locale: string;
    voice: string;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    estimatedCostMicros: number;
  }>;
}

export function makeStoryboard(
  draft: Draft,
  directionId: Direction["id"],
): Draft {
  const direction = proposeDirections(draft).find((d) => d.id === directionId);
  if (!direction) throw new Error("Choose a valid direction.");
  const facts = draft.facts.filter((f) => f.confirmed);
  const mx = draft.market === "MX";
  const entries = [
    { caption: direction.hook, factIds: [] as string[] },
    { caption: facts[0].adCopy, factIds: [facts[0].id] },
    facts[1]
      ? { caption: facts[1].adCopy, factIds: [facts[1].id] }
      : { caption: draft.productName, factIds: [] as string[] },
    {
      caption: mx ? "Conoce los detalles." : "Explore the details.",
      factIds: [] as string[],
    },
  ];
  return {
    ...draft,
    selectedDirection: directionId,
    scriptConfirmed: false,
    shots: entries.map((e, i) =>
      draft.shots[i]?.locked
        ? { ...draft.shots[i] }
        : {
            id: draft.shots[i]?.id ?? crypto.randomUUID(),
            duration: SHOT_DURATIONS[i],
            locked: false,
            ...e,
          },
    ),
  };
}
export function validateForRender(draft: Draft): Draft {
  requireFacts(draft);
  if (!draft.selectedDirection)
    throw new Error("Choose a direction before confirming the script.");
  if (
    draft.shots.length !== 4 ||
    draft.shots.reduce((s, x) => s + x.duration, 0) !== 15
  )
    throw new Error("Use four shots with a total duration of 15 seconds.");
  const facts = new Set(
    draft.facts.filter((f) => f.confirmed).map((f) => f.id),
  );
  for (const shot of draft.shots) {
    if (shot.factIds.some((id) => !facts.has(id)))
      throw new Error("A shot references an unknown or unconfirmed fact.");
    if (shot.caption.split(/\s+/u).some((word) => word.length > 28))
      throw new Error("A caption contains a word too long for the template.");
  }
  return draft;
}
export function canonicalDraft(draft: Draft): string {
  const { scriptConfirmed: _confirmed, ...content } = DraftSchema.parse(draft);
  void _confirmed;
  return JSON.stringify(content);
}
export async function draftHash(draft: Draft): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalDraft(draft)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function makeSrt(draft: Draft): string {
  validateForRender(draft);
  let start = 0;
  const time = (s: number) => `00:00:${String(s).padStart(2, "0")},000`;
  return draft.shots
    .map((shot, i) => {
      const end = start + shot.duration;
      const out = `${i + 1}\n${time(start)} --> ${time(end)}\n${shot.caption}\n`;
      start = end;
      return out;
    })
    .join("\n");
}

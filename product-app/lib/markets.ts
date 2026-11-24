// Legacy labels remain valid for existing records. Regions deliberately do not
// acquire a made-up country/locale when normalized.
export const SUPPORTED_MARKETS = ["美国", "欧洲", "日本", "韩国", "东南亚", "墨西哥"] as const;
export type LegacyMarket = (typeof SUPPORTED_MARKETS)[number];

const countryLocales = {
  美国: ["US", "en-US"], 墨西哥: ["MX", "es-MX"],
  日本: ["JP", "ja-JP"], 韩国: ["KR", "ko-KR"],
} as const;

export function normalizeMarket(label: string) {
  if (!SUPPORTED_MARKETS.includes(label as LegacyMarket)) {
    throw new Error(`Unsupported legacy market: ${label}`);
  }
  const country = countryLocales[label as keyof typeof countryLocales];
  return {
    legacyLabel: label,
    marketCode: country?.[0] ?? null,
    locale: country?.[1] ?? null,
    mappingStatus: country ? "mapped" : "needs_confirmation",
  };
}

// Region codes below are filename labels only, never delivery countries.
export const MARKET_FILE_CODES: Record<LegacyMarket, string> = {
  美国: "US", 墨西哥: "MX", 欧洲: "EU", 日本: "JP", 韩国: "KR", 东南亚: "SEA",
};

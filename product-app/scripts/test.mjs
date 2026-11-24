import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// The default suite must be reproducible without a private .env.local or
// billable API calls. Live integration is a separate, explicitly configured run.
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  OPENAI_API_KEY: "",
  OPENAI_SPEC_EXTRACTION_ENABLED: "false",
  OPENAI_CREATIVE_DERIVATION_ENABLED: "false",
  OPENAI_IMAGE_GENERATION_ENABLED: "false",
  DEV_LOGIN_ENABLED: "false",
};
for (const args of [
  ["node_modules/next/dist/bin/next", "build"],
  ["--experimental-strip-types", "--test", "--test-concurrency=1",
    ...readdirSync("tests").filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `tests/${name}`)],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

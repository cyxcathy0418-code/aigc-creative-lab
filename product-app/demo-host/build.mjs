import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = process.env.PASSPORT_DEMO_OUTPUT
  ? path.resolve(process.env.PASSPORT_DEMO_OUTPUT)
  : path.join(root, "demo-dist");
await mkdir(path.join(out, "client"), { recursive: true });
await build({
  entryPoints: [path.join(root, "demo-host/client.tsx")],
  outfile: path.join(out, "client/demo.js"),
  bundle: true,
  format: "iife",
  jsx: "automatic",
  target: ["chrome109", "safari17"],
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
});
const js = await readFile(path.join(out, "client/demo.js"), "utf8");
const css = await readFile(path.join(out, "client/demo.css"), "utf8");
await mkdir(path.join(root, "demo-host/.generated"), { recursive: true });
await writeFile(
  path.join(root, "demo-host/.generated/assets.ts"),
  `export const CLIENT_JS=${JSON.stringify(js)};\nexport const CLIENT_CSS=${JSON.stringify(css)};\n`,
);
await mkdir(path.join(out, "server"), { recursive: true });
await build({
  entryPoints: [path.join(root, "demo-host/worker.ts")],
  outfile: path.join(out, "server/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
console.log(`Built frontend + backend: ${out}/server/index.js`);

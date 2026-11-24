import { createServer } from "node:http";
import { fetchDemo } from "../demo-dist/server/index.js";
import { LocalWorkspaceStore } from "../lib/passport-demo/local-store.ts";
const port = Number(process.env.PORT ?? 4173);
const store = new LocalWorkspaceStore();
const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
      res.writeHead(403);
      res.end("Invalid host");
      return;
    }
    const origin = `http://${host}`;
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1_600_000) {
        res.writeHead(413);
        res.end("Too large");
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value)
        headers.set(name, Array.isArray(value) ? value.join(",") : value);
    const request = new Request(new URL(req.url ?? "/", origin), {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method ?? "GET")
        ? undefined
        : Buffer.concat(chunks),
    });
    const response = await fetchDemo(request, store, "localhost-demo-owner");
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "The local demo could not complete this request.",
      }),
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Creative Passport demo: http://127.0.0.1:${port}`),
);

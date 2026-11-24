import {
  handleDemoRequest,
  type WorkspaceStore,
} from "../lib/passport-demo/service";
import {
  R2WorkspaceStore,
  type ObjectBucket,
} from "../lib/passport-demo/stores";
import { CLIENT_JS, CLIENT_CSS } from "./.generated/assets";
const html =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Creative Passport: one product, a new creative direction, and a real 15-second video. An honest, no-paid-model demo."><title>Creative Passport · Demo</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/assets/demo.css"></head><body style="margin:0"><div id="root"></div><script src="/assets/demo.js" defer></script></body></html>';
const security = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site",
};
export async function fetchDemo(
  request: Request,
  store: WorkspaceStore,
  owner: string | null,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/demo/"))
    return handleDemoRequest(request, owner, store);
  const assets: Record<string, [string, string]> = {
    "/": [html, "text/html;charset=utf-8"],
    "/demo": [html, "text/html;charset=utf-8"],
    "/assets/demo.js": [CLIENT_JS, "text/javascript;charset=utf-8"],
    "/assets/demo.css": [CLIENT_CSS, "text/css;charset=utf-8"],
    "/favicon.svg": [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#173b2b"/><path d="m32 10 6 16 16 6-16 6-6 16-6-16-16-6 16-6Z" fill="#d9ed98"/></svg>',
      "image/svg+xml",
    ],
  };
  const asset = assets[path];
  return asset
    ? new Response(asset[0], {
        headers: {
          ...security,
          "content-type": asset[1],
          "cache-control": path.startsWith("/assets/")
            ? "public,max-age=300"
            : "no-cache",
        },
      })
    : new Response("Not found", { status: 404, headers: security });
}
const worker = {
  async fetch(request: Request, env: { BUCKET: ObjectBucket }) {
    if (!env.BUCKET && new URL(request.url).pathname.startsWith("/api/"))
      return Response.json(
        { error: "Workspace storage is not configured." },
        { status: 503 },
      );
    return fetchDemo(
      request,
      new R2WorkspaceStore(env.BUCKET),
      request.headers.get("oai-authenticated-user-id"),
    );
  },
};

export default worker;

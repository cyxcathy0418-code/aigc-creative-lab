import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

const port = 32147;
const origin = `http://127.0.0.1:${port}`;
const projectRoot = new URL("../", import.meta.url);
let server;
let serverOutput = "";

before(async () => {
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited early:\n${serverOutput}`);
    }

    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Next server did not become ready:\n${serverOutput}`);
});

after(() => {
  server?.kill();
});

test("server-renders the public product page", async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Brand Anchor Studio<\/title>/i);
  assert.match(html, /Built Around the Product\./);
  assert.match(html, /申请 Beta 使用权限/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("login is public and connected to Supabase", async () => {
  const response = await fetch(`${origin}/login`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /受邀邮箱/);
  assert.match(html, /未获邀请的邮箱不会创建新账号/);
  assert.match(html, /发送邮箱登录链接/);
  assert.doesNotMatch(html, /等待连接 Supabase/);
});

test("auth confirmation is a client page that can receive URL fragments", async () => {
  const response = await fetch(`${origin}/auth/confirm`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /正在建立登录会话/);
});

test("development login is unavailable in a production server", async () => {
  const loginHtml = await (await fetch(`${origin}/login`)).text();
  assert.doesNotMatch(loginHtml, /进入本地测试工作台/);
});

test("dashboard redirects unauthenticated visitors to login", async () => {
  const response = await fetch(`${origin}/dashboard`, { redirect: "manual" });
  assert.equal(response.status, 307);
  assert.match(
    response.headers.get("location") ?? "",
    /\/login\?next=%2Fdashboard/,
  );
});

test("product pages stay protected without an authenticated session", async () => {
  const response = await fetch(`${origin}/products/new`, { redirect: "manual" });
  assert.equal(response.status, 307);
  assert.match(
    response.headers.get("location") ?? "",
    /\/login\?next=%2Fproducts%2Fnew/,
  );
});

test("campaign pages stay protected without an authenticated session", async () => {
  const response = await fetch(`${origin}/campaigns/example/creatives`, {
    redirect: "manual",
  });
  assert.equal(response.status, 307);
  assert.match(
    response.headers.get("location") ?? "",
    /\/login\?next=%2Fcampaigns%2Fexample%2Fcreatives/,
  );
});

test("product API rejects unauthenticated access", async () => {
  const response = await fetch(`${origin}/api/products`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "请先登录" });
});

test("invite-only and protected-route rules are wired into the source", async () => {
  const [loginPage, loginForm, devLoginRoute, authorization, supabaseClient, authConfirm, proxy, gitignore] =
    await Promise.all([
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/LoginForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/dev-login/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/supabase/authorization.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/auth/confirm/ConfirmClient.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    ]);

  assert.match(loginForm, /shouldCreateUser:\s*false/);
  assert.match(loginForm, /createImplicitLoginClient/);
  assert.match(loginForm, /\/auth\/dev-login\?next=/);
  assert.match(
    devLoginRoute,
    /supabase\.auth\.signInAnonymously/,
  );
  assert.match(loginForm, /new URL\("\/auth\/confirm"/);
  assert.match(loginForm, /emailRedirectTo:\s*callbackUrl\.toString\(\)/);
  assert.doesNotMatch(loginForm, /supabase\.auth\.verifyOtp/);
  assert.match(loginPage, /process\.env\.NODE_ENV !== "production"/);
  assert.match(loginPage, /process\.env\.DEV_LOGIN_ENABLED === "true"/);
  assert.match(authorization, /process\.env\.NODE_ENV === "production"/);
  assert.match(authorization, /user\.is_anonymous/);
  assert.match(supabaseClient, /flowType:\s*"implicit"/);
  assert.match(authConfirm, /supabase\.auth\.setSession/);
  assert.match(authConfirm, /supabase\.auth\.verifyOtp/);
  assert.match(authConfirm, /token_hash:\s*tokenHash/);
  assert.match(authConfirm, /supabase\.auth\.exchangeCodeForSession/);
  assert.match(authConfirm, /window\.history\.replaceState/);
  assert.match(authConfirm, /window\.location\.replace\(next\)/);
  assert.match(proxy, /supabase\.auth\.getUser\(\)/);
  assert.match(proxy, /isAuthorizedProductUser\(user\)/);
  assert.match(proxy, /NextResponse\.redirect\(loginUrl\)/);
  assert.match(proxy, /"\/dashboard\/:path\*"/);
  assert.match(proxy, /"\/products\/:path\*"/);
  assert.match(proxy, /"\/campaigns\/:path\*"/);
  assert.match(gitignore, /\.env\*/);
  assert.match(gitignore, /\.next/);
});

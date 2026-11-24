import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSampleDraft,
  makeStoryboard,
} from "../lib/passport-demo/workflow.ts";
const mod = await import("../lib/passport-demo/service.ts").catch(() => null);
const store = () => {
  const data = new Map();
  return {
    async read(owner) {
      return structuredClone(
        data.get(owner) ?? {
          workspace: { revision: 0, draft: null, versions: [] },
          etag: null,
        },
      );
    },
    async compareAndSet(owner, etag, workspace) {
      if ((data.get(owner)?.etag ?? null) !== etag) return false;
      data.set(owner, {
        workspace: structuredClone(workspace),
        etag: crypto.randomUUID(),
      });
      return true;
    },
  };
};
const req = (path, method = "GET", body, origin = "https://demo.test") =>
  new Request(`https://demo.test/api/demo/${path}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const draft = () => {
  const d = createSampleDraft();
  d.facts.forEach((f) => (f.confirmed = true));
  return makeStoryboard(d, "scenario");
};
test("backend requires an owner and isolates saved projects", async () => {
  assert.ok(mod);
  const db = store();
  assert.equal(
    (await mod.handleDemoRequest(req("workspace"), null, db)).status,
    401,
  );
  assert.equal(
    (
      await mod.handleDemoRequest(
        req("workspace", "PUT", {
          expectedRevision: 0,
          draft: draft(),
          intent: "save",
        }),
        "alice",
        db,
      )
    ).status,
    200,
  );
  assert.ok(
    (await (await mod.handleDemoRequest(req("workspace"), "alice", db)).json())
      .draft,
  );
  assert.equal(
    (await (await mod.handleDemoRequest(req("workspace"), "bob", db)).json())
      .draft,
    null,
  );
});
test("confirmed snapshots survive edits; identical confirmations do not duplicate versions", async () => {
  assert.ok(mod);
  const db = store();
  const d = draft();
  let r = await mod.handleDemoRequest(
    req("workspace", "PUT", {
      expectedRevision: 0,
      draft: d,
      intent: "confirm",
    }),
    "alice",
    db,
  );
  let saved = await r.json();
  assert.equal(saved.versions.length, 1);
  r = await mod.handleDemoRequest(
    req("workspace", "PUT", {
      expectedRevision: 1,
      draft: d,
      intent: "confirm",
    }),
    "alice",
    db,
  );
  saved = await r.json();
  assert.equal(saved.versions.length, 1);
  d.shots[0].caption = "A revised opening";
  r = await mod.handleDemoRequest(
    req("workspace", "PUT", {
      expectedRevision: 2,
      draft: d,
      intent: "confirm",
    }),
    "alice",
    db,
  );
  saved = await r.json();
  assert.equal(saved.versions.length, 2);
  assert.notEqual(saved.versions[0].draft.shots[0].caption, d.shots[0].caption);
});
test("stale saves, missing facts and cross-origin writes fail", async () => {
  assert.ok(mod);
  const db = store();
  const d = draft();
  await mod.handleDemoRequest(
    req("workspace", "PUT", {
      expectedRevision: 0,
      draft: d,
      intent: "confirm",
    }),
    "alice",
    db,
  );
  assert.equal(
    (
      await mod.handleDemoRequest(
        req("workspace", "PUT", {
          expectedRevision: 0,
          draft: d,
          intent: "save",
        }),
        "alice",
        db,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await mod.handleDemoRequest(
        req(
          "workspace",
          "PUT",
          { expectedRevision: 1, draft: d, intent: "save" },
          "https://evil.test",
        ),
        "alice",
        db,
      )
    ).status,
    403,
  );
  d.shots[0].factIds = ["foreign"];
  assert.equal(
    (
      await mod.handleDemoRequest(
        req("workspace", "PUT", {
          expectedRevision: 1,
          draft: d,
          intent: "confirm",
        }),
        "alice",
        db,
      )
    ).status,
    400,
  );
});
test("a saved locked shot cannot change content or reference image while staying locked", async () => {
  const db = store();
  const d = draft();
  d.shots[0].locked = true;
  await mod.handleDemoRequest(
    req("workspace", "PUT", {
      expectedRevision: 0,
      draft: d,
      intent: "confirm",
    }),
    "alice",
    db,
  );
  d.shots[0].caption = "Changed behind the lock";
  assert.equal(
    (
      await mod.handleDemoRequest(
        req("workspace", "PUT", {
          expectedRevision: 1,
          draft: d,
          intent: "save",
        }),
        "alice",
        db,
      )
    ).status,
    422,
  );
});
test("ordinary saves cannot remove locked shots; explicit reset preserves history", async () => {
  const db = store();
  const d = draft();
  d.shots[0].locked = true;
  const confirmed = await (
    await mod.handleDemoRequest(
      req("workspace", "PUT", {
        expectedRevision: 0,
        draft: d,
        intent: "confirm",
      }),
      "alice",
      db,
    )
  ).json();
  d.shots = [];
  d.selectedDirection = null;
  assert.equal(
    (
      await mod.handleDemoRequest(
        req("workspace", "PUT", {
          expectedRevision: 1,
          draft: d,
          intent: "save",
        }),
        "alice",
        db,
      )
    ).status,
    422,
  );
  const reset = await mod.handleDemoRequest(
    req("workspace", "PUT", { expectedRevision: 1, draft: d, intent: "reset" }),
    "alice",
    db,
  );
  assert.equal(reset.status, 200);
  assert.deepEqual((await reset.json()).versions, confirmed.versions);
});

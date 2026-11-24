import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSampleDraft,
  makeStoryboard,
  draftHash,
} from "../lib/passport-demo/workflow.ts";
const cache = await import("../lib/passport-demo/artifact-cache.ts");
test("initial recovery waits for the cache and binds the video to the confirmed hash", async () => {
  assert.equal(typeof cache.recoverWorkspace, "function");
  const d = createSampleDraft();
  d.facts.forEach((f) => (f.confirmed = true));
  const draft = makeStoryboard(d, "scenario");
  draft.scriptConfirmed = true;
  const hash = await draftHash(draft);
  const workspace = {
    revision: 1,
    draft,
    versions: [
      {
        id: crypto.randomUUID(),
        version: 1,
        createdAt: new Date().toISOString(),
        hash,
        draft,
      },
    ],
  };
  let release;
  let cacheStarted;
  const started = new Promise((r) => {
    cacheStarted = r;
  });
  const deferred = new Promise((r) => {
    release = r;
  });
  let settled = false;
  const recovering = cache
    .recoverWorkspace(
      async () => workspace,
      async () => {
        cacheStarted();
        return deferred;
      },
    )
    .then((x) => {
      settled = true;
      return x;
    });
  await started;
  assert.equal(settled, false);
  const blob = new Blob(["video"]);
  release(blob);
  const result = await recovering;
  assert.equal(result.video, blob);
  assert.equal(result.videoHash, hash);
  draft.shots[0].caption = "A newer draft";
  const stale = await cache.recoverWorkspace(
    async () => workspace,
    async () => blob,
  );
  assert.equal(stale.video, null);
});

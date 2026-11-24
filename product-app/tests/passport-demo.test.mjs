import assert from "node:assert/strict";
import { test } from "node:test";
const mod = await import("../lib/passport-demo/workflow.ts").catch(() => null);
const confirmedSample = (market) => {
  const d = mod.createSampleDraft(market);
  d.facts.forEach((f) => (f.confirmed = true));
  return d;
};
test("demo provider preserves the chosen market, confirmed fact IDs and 15-second format", () => {
  assert.ok(mod, "workflow module must exist");
  const draft = confirmedSample("MX");
  const directions = mod.proposeDirections(draft);
  assert.equal(directions.length, 3);
  assert.ok(directions.every((d) => d.evidenceType === "creative_hypothesis"));
  const next = mod.makeStoryboard(draft, directions[0].id);
  assert.equal(next.market, "MX");
  assert.equal(next.locale, "es-MX");
  assert.equal(
    next.shots.reduce((s, x) => s + x.duration, 0),
    15,
  );
  assert.ok(
    next.shots
      .flatMap((x) => x.factIds)
      .every((id) => draft.facts.find((f) => f.id === id)?.confirmed),
  );
  assert.match(mod.makeSrt(next), /00:00:15,000/);
});
test("unconfirmed or unsourced product claims cannot enter production", () => {
  assert.ok(mod);
  const draft = mod.createSampleDraft("US");
  draft.facts.forEach((f) => (f.confirmed = false));
  assert.throws(() => mod.proposeDirections(draft), /confirm/i);
  draft.facts[0].confirmed = true;
  draft.facts[0].source = "";
  assert.throws(() => mod.proposeDirections(draft));
});
test("script validation rejects foreign facts, missing direction and overflow", () => {
  assert.ok(mod);
  const draft = mod.makeStoryboard(confirmedSample("US"), "scenario");
  draft.shots[1].factIds = ["unknown"];
  assert.throws(() => mod.validateForRender(draft), /fact/i);
  draft.shots[1].factIds = [];
  draft.selectedDirection = null;
  assert.throws(() => mod.validateForRender(draft), /direction/i);
  draft.selectedDirection = "scenario";
  draft.shots[0].caption = "a ".repeat(200);
  assert.throws(() => mod.validateForRender(draft));
});
test("a locked shot cannot be overwritten by a new direction", () => {
  assert.ok(mod);
  let draft = mod.makeStoryboard(confirmedSample("US"), "scenario");
  draft.shots[0].locked = true;
  draft.shots[0].caption = "My approved opening";
  const next = mod.makeStoryboard(draft, "detail");
  assert.equal(next.shots[0].caption, "My approved opening");
  assert.equal(next.shots[0].locked, true);
});
test("narration metadata is part of the version identity", async () => {
  assert.ok(mod);
  const d = mod.makeStoryboard(confirmedSample("US"), "scenario");
  const silent = await mod.draftHash(d);
  d.narration = { fileName: "voice.wav", sha256: "a".repeat(64), duration: 9 };
  assert.notEqual(await mod.draftHash(d), silent);
});

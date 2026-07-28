import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateImageWithRetries,
  ImageGenerationError,
} from "../lib/generation/provider.ts";

const request = {
  prompt: "A reference-grounded product advertisement.",
  market: "美国",
  size: "1024x1536",
  quality: "medium",
  referenceImages: [
    {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      fileName: "reference.png",
    },
  ],
};

test("returns one provider result without making any network call", async () => {
  const provider = {
    name: "mock",
    model: "mock-image",
    async generate(received) {
      assert.equal(received.referenceImages.length, 1);
      return {
        bytes: new Uint8Array([82, 73, 70, 70]),
        mimeType: "image/webp",
        width: 1024,
        height: 1536,
      };
    },
  };

  const output = await generateImageWithRetries(request, provider, 1);
  assert.equal(output.attempts, 1);
  assert.equal(output.result.mimeType, "image/webp");
  assert.equal(output.result.height, 1536);
});

test("supports bounded retries while keeping the default paid path at one attempt", async () => {
  let calls = 0;
  const delays = [];
  const provider = {
    name: "mock",
    model: "mock-image",
    async generate() {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return {
        bytes: new Uint8Array([1]),
        mimeType: "image/webp",
        width: 1024,
        height: 1536,
      };
    },
  };

  const output = await generateImageWithRetries(
    request,
    provider,
    2,
    async (milliseconds) => delays.push(milliseconds),
  );
  assert.equal(output.attempts, 2);
  assert.deepEqual(delays, [1000]);
});

test("reports a final failure without creating an asset", async () => {
  const provider = {
    name: "mock",
    model: "mock-image",
    async generate() {
      throw new Error("provider unavailable");
    },
  };

  await assert.rejects(
    () => generateImageWithRetries(request, provider, 1),
    (error) => {
      assert.equal(error instanceof ImageGenerationError, true);
      assert.equal(error.attempts, 1);
      assert.match(error.message, /provider unavailable/);
      return true;
    },
  );
});


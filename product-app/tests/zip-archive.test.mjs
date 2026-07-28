import assert from "node:assert/strict";
import { test } from "node:test";
import { buildZipArchive } from "../lib/generation/zipArchive.ts";

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

test("builds a ZIP with correct local headers, filenames and bytes", () => {
  const entries = [
    { name: "美国.webp", bytes: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: "韩国.webp", bytes: new Uint8Array([9, 8, 7]) },
  ];
  const zip = Buffer.from(buildZipArchive(entries));

  assert.equal(readUInt32LE(zip, 0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("美国.webp", "utf8")));
  assert.ok(zip.includes(Buffer.from("韩国.webp", "utf8")));

  const endSignatureOffset = zip.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  );
  assert.ok(endSignatureOffset > 0);
  assert.equal(zip.readUInt16LE(endSignatureOffset + 8), entries.length);
  assert.equal(zip.readUInt16LE(endSignatureOffset + 10), entries.length);
});

test("produces an archive with as many local file signatures as entries", () => {
  const entries = [
    { name: "a.webp", bytes: new Uint8Array([1]) },
    { name: "b.webp", bytes: new Uint8Array([2]) },
    { name: "c.webp", bytes: new Uint8Array([3]) },
  ];
  const zip = Buffer.from(buildZipArchive(entries));
  const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

  let count = 0;
  let index = zip.indexOf(signature);
  while (index !== -1) {
    count += 1;
    index = zip.indexOf(signature, index + 1);
  }

  assert.equal(count, entries.length);
});

test("returns a valid empty archive for zero entries", () => {
  const zip = Buffer.from(buildZipArchive([]));
  assert.equal(zip.length, 22);
  assert.equal(readUInt32LE(zip, 0), 0x06054b50);
});

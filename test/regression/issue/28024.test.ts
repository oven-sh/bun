// https://github.com/oven-sh/bun/issues/28024
// Segfault in jsHashProtoFuncUpdate: missing null checks for invalid `this` and detached buffers
import { expect, test } from "bun:test";
import { Hash, createHash } from "node:crypto";

test("Hash update() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const update = Hash.prototype.update;
  expect(() => update.call({}, "data")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => update.call(null, "data")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => update.call(42, "data")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("Hash digest() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const digest = Hash.prototype.digest;
  expect(() => digest.call({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => digest.call(null)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("Hash.update() does not crash on a detached ArrayBufferView", () => {
  const hash = createHash("sha256");
  const view = new Uint8Array(16);
  // @ts-ignore - transfer() detaches the underlying buffer
  view.buffer.transfer();

  // Node.js treats a detached view as 0 bytes; the digest matches sha256("").
  expect(hash.update(view).digest("hex")).toBe(createHash("sha256").digest("hex"));
});

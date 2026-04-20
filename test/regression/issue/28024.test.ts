// https://github.com/oven-sh/bun/issues/28024
// Segfault in jsHashProtoFuncUpdate: missing null checks for invalid `this` and detached buffers
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

function getNativeHandle(hash: any) {
  const sym = Object.getOwnPropertySymbols(hash).find(s => s.description === "kHandle");
  return hash[sym!];
}

test("Hash native update() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const hash = createHash("sha256");
  const native = getNativeHandle(hash);
  const nativeUpdate = native.update;

  expect(() => nativeUpdate.call({}, hash, "data")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeUpdate.call(null, hash, "data")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeUpdate.call(42, hash, "data")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("Hash native digest() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const hash = createHash("sha256");
  const native = getNativeHandle(hash);
  const nativeDigest = native.digest;

  expect(() => nativeDigest.call({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeDigest.call(null)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("Hash.update() throws ERR_INVALID_STATE on detached ArrayBufferView", () => {
  const hash = createHash("sha256");
  const view = new Uint8Array(16);
  // @ts-ignore - transfer() detaches the underlying buffer
  view.buffer.transfer();

  expect(() => hash.update(view)).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
});

// Native crypto prototype methods must not segfault when called with an invalid `this`.
// Before these fixes, jsDynamicCast returned null and the code dereferenced it anyway.
import { expect, test } from "bun:test";
import { createHmac, getDiffieHellman } from "node:crypto";

function getNativeHandle(obj: any) {
  const sym = Object.getOwnPropertySymbols(obj).find(s => s.description === "kHandle");
  return obj[sym!];
}

test("Hmac native digest() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const hmac = createHmac("sha256", "key");
  const native = getNativeHandle(hmac);
  const nativeDigest = native.digest;

  expect(() => nativeDigest.call({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeDigest.call(null)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeDigest.call(42)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("DiffieHellmanGroup verifyError getter throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const dhg = getDiffieHellman("modp14");
  const desc =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(dhg), "verifyError") ??
    Object.getOwnPropertyDescriptor(dhg, "verifyError");
  expect(desc?.get).toBeFunction();

  expect(() => desc!.get!.call({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => desc!.get!.call(null)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

// Tests for the native crypto objects behind the node:crypto wrappers (the kHandle objects).
//
// Native crypto prototype methods must not segfault when called with an invalid `this`.
// Before these fixes, jsDynamicCast returned null and the code dereferenced it anyway.
import { expect, test } from "bun:test";
import { createHash, createHmac, getDiffieHellman } from "node:crypto";

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

test("Hmac native update() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const hmac = createHmac("sha256", "key");
  const native = getNativeHandle(hmac);
  const nativeUpdate = native.update;

  expect(() => nativeUpdate.call({}, hmac, "x")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeUpdate.call(null, hmac, "x")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => nativeUpdate.call(42, hmac, "x")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
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

test.each([
  ["Hash", () => createHash("sha256"), ["sha256"]],
  ["Hmac", () => createHmac("sha256", "key"), ["sha256", "key"]],
] as const)("native %s constructor has a prototype property, so instanceof and extends work", (name, create, args) => {
  const native = getNativeHandle(create());
  const proto = Object.getPrototypeOf(native);
  const Native = proto.constructor;

  expect(Native.name).toBe(name);
  expect(Object.getOwnPropertyDescriptor(Native, "prototype")).toEqual({
    value: proto,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  expect(native instanceof Native).toBe(true);

  class Sub extends Native {}
  const sub = new Sub(...args);
  expect(Object.getPrototypeOf(sub)).toBe(Sub.prototype);
  expect(sub instanceof Native).toBe(true);
  // The native update() takes the JS wrapper as its first argument and returns it.
  expect(sub.update(sub, "abc")).toBe(sub);
  expect(sub.digest("hex")).toBe(create().update("abc").digest("hex"));
});

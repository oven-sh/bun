// Native crypto prototype methods must not segfault when called with an invalid `this`.
// Before these fixes, jsDynamicCast returned null and the code dereferenced it anyway.
import { expect, test } from "bun:test";
import { Hash, Hmac, createHash, createHmac, getDiffieHellman } from "node:crypto";

test("Hmac digest() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const digest = Hmac.prototype.digest;
  expect(() => digest.call({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => digest.call(null)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => digest.call(42)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => digest.call(createHash("sha256"))).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("Hmac update() throws ERR_INVALID_THIS instead of segfaulting on bad this", () => {
  const update = Hmac.prototype.update;
  expect(() => update.call({}, "x")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => update.call(null, "x")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => update.call(42, "x")).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});

test("Hash methods throw ERR_INVALID_THIS on bad this", () => {
  for (const name of ["update", "digest", "copy", "_transform", "_flush"]) {
    expect(() => Hash.prototype[name].call({}, "x", "utf8", () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_THIS" }),
    );
    expect(() => Hash.prototype[name].call(createHmac("sha256", "k"), "x", "utf8", () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_THIS" }),
    );
  }
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

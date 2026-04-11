// https://github.com/oven-sh/bun/issues/29195
//
// fetch() and the Request constructor must throw a TypeError when the
// `init` argument is a primitive other than undefined or null. Per the
// WHATWG Fetch spec, `init` is a Web IDL dictionary, and dictionary
// conversion throws TypeError for non-object, non-nullish values.
import { describe, expect, test } from "bun:test";

// data: URL so the "good init" cases resolve synchronously without any
// network I/O — keeps the test hermetic on every platform.
const url = "data:text/plain,ok";

const bad_init: [string, unknown][] = [
  ["number 0", 0],
  ["non-zero number", 42],
  ["bigint", 0n],
  ["empty string", ""],
  ["non-empty string", "hello"],
  ["boolean false", false],
  ["boolean true", true],
];

const good_init: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["a plain object", { method: "GET" }],
];

describe("fetch() init argument validation (#29195)", () => {
  test.each(bad_init)("rejects with TypeError when init is %s", async (_label, value) => {
    await expect(fetch(url, value as any)).rejects.toBeInstanceOf(TypeError);
  });

  test("rejects with TypeError when init is a symbol", async () => {
    await expect(fetch(url, Symbol("test") as any)).rejects.toBeInstanceOf(TypeError);
  });

  test.each(good_init)("resolves when init is %s", async (_label, value) => {
    const res = await fetch(url, value as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("new Request() init argument validation (#29195)", () => {
  test.each(bad_init)("throws TypeError when init is %s", (_label, value) => {
    expect(() => new Request(url, value as any)).toThrow(TypeError);
  });

  test("throws TypeError when init is a symbol", () => {
    // Our validation in constructInto catches the Symbol: isUndefinedOrNull()
    // is false and isObject() is false, so it throws TypeError before the
    // code path that would otherwise stringify it.
    expect(() => new Request(url, Symbol("test") as any)).toThrow(TypeError);
  });

  test.each(good_init)("does not throw when init is %s", (_label, value) => {
    expect(() => new Request(url, value as any)).not.toThrow();
  });
});

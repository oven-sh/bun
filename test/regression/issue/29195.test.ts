// https://github.com/oven-sh/bun/issues/29195
//
// fetch() and the Request constructor must throw a TypeError when the
// `init` argument is a primitive other than undefined or null. Per the
// WHATWG Fetch spec, `init` is a Web IDL dictionary, and dictionary
// conversion throws TypeError for non-object, non-nullish values.
import { describe, expect, test } from "bun:test";

const url = "http://bun.invalid.example/";

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

  test.each(good_init)("does not reject with TypeError when init is %s", async (_label, value) => {
    // The request will fail with a DNS/network error, not a TypeError from
    // init validation. We only care that the rejection (if any) is not a
    // TypeError about the init argument.
    const result = await fetch(url, value as any).then(
      r => ({ ok: true as const, r }),
      e => ({ ok: false as const, e }),
    );
    if (!result.ok) {
      expect(result.e).not.toBeInstanceOf(TypeError);
    }
  });
});

describe("new Request() init argument validation (#29195)", () => {
  test.each(bad_init)("throws TypeError when init is %s", (_label, value) => {
    expect(() => new Request(url, value as any)).toThrow(TypeError);
  });

  test("throws TypeError when init is a symbol", () => {
    // Symbol → string conversion throws its own TypeError, so new Request()
    // throws before our validation even runs — both outcomes are TypeError.
    expect(() => new Request(url, Symbol("test") as any)).toThrow(TypeError);
  });

  test.each(good_init)("does not throw when init is %s", (_label, value) => {
    expect(() => new Request(url, value as any)).not.toThrow();
  });
});

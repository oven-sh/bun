// https://github.com/oven-sh/bun/issues/29195
//
// fetch() must reject with a TypeError when the `init` argument is a
// primitive other than undefined or null. Per the WHATWG Fetch spec,
// `init` is a Web IDL dictionary, and dictionary conversion throws
// TypeError for non-object, non-nullish values.
import { describe, expect, test } from "bun:test";

const url = "http://bun.invalid.example/";

describe("fetch() init argument validation (#29195)", () => {
  test.each([
    ["number 0", 0],
    ["non-zero number", 42],
    ["bigint", 0n],
    ["empty string", ""],
    ["non-empty string", "hello"],
    ["boolean false", false],
    ["boolean true", true],
  ])("rejects with TypeError when init is %s", async (_label, value) => {
    await expect(fetch(url, value as any)).rejects.toBeInstanceOf(TypeError);
  });

  test("rejects with TypeError when init is a symbol", async () => {
    await expect(fetch(url, Symbol("test") as any)).rejects.toBeInstanceOf(TypeError);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a plain object", { method: "GET" }],
  ])("does not reject with TypeError when init is %s", async (_label, value) => {
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

// https://github.com/oven-sh/bun/issues/29195
//
// Canonical tests live in test/js/web/fetch/fetch.test.ts alongside the rest
// of the fetch/Request coverage. This file mirrors a minimal set so the
// issue-number locator still finds a regression entry point for #29195.
import { describe, expect, test } from "bun:test";

const url = "data:text/plain,ok";

// Primitives that fail Web IDL dictionary conversion.
const bad_init: [string, unknown][] = [
  ["number", 0],
  ["bigint", 0n],
  ["string", ""],
  ["boolean", false],
  ["symbol", Symbol("test")],
];

describe("fetch() and Request init validation", () => {
  test.each(bad_init)("fetch rejects TypeError for %s init", async (_l, value) => {
    await expect(fetch(url, value as any)).rejects.toBeInstanceOf(TypeError);
  });

  test.each(bad_init)("new Request throws TypeError for %s init", (_l, value) => {
    expect(() => new Request(url, value as any)).toThrow(TypeError);
  });

  test("fetch resolves for a plain-object init", async () => {
    const res = await fetch(url, { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("new Request does not throw for a plain-object init", () => {
    expect(() => new Request(url, { method: "GET" })).not.toThrow();
  });
});

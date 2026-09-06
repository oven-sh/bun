import { expect, test } from "bun:test";
import { expectRssDeltaBelow } from "harness";
import stripAnsiColors from "strip-ansi";

test("expect-label", () => {
  let err;
  try {
    expect("a", "lol!").toBe("b");
    expect.unreachable();
  } catch (e) {
    err = e;
  }

  expect(stripAnsiColors(err.message)).toContain("lol!\n\nExpected");
  expect(stripAnsiColors(err.message)).not.toContain("to be");
  expect(stripAnsiColors(err.message)).not.toContain("toBe");
});

test("expect-label toEqual", () => {
  let err;
  try {
    expect("a", "lol!").toEqual("b");
    expect.unreachable();
  } catch (e) {
    err = e;
  }

  expect(stripAnsiColors(err.message)).toContain("lol!\n\nExpected");
});

test("non-strings do not crash", () => {
  try {
    expect("a", undefined).toEqual("b");
  } catch {}
  try {
    // @ts-ignore
    expect("a", Symbol("a")).toEqual("b");
  } catch {}
  try {
    // @ts-ignore
    expect("a", null).toEqual("b");
  } catch {}
});

test.concurrent("expect(value, label) does not leak the label", async () => {
  const code = /* js */ `
    const { expect } = require("bun:test");
    const base = Buffer.alloc(256 * 1024, "a").toString();
    for (let i = 0; i < 20; i++) expect(1, base + i).toBe(1);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 400; i++) expect(1, base + i).toBe(1);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: ~100 MiB. Fixed: allocator slack only.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 40, debug: 55 });
});

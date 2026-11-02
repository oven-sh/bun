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

test("expect-label toBe of deep-equal values", () => {
  const message = (fails: () => void) => {
    try {
      fails();
    } catch (e) {
      return stripAnsiColors((e as Error).message);
    }
    expect.unreachable();
  };

  // The label takes the place of the signature line only.
  expect(message(() => expect({ a: 1 }, "lol!").toBe({ a: 1 }))).toMatchInlineSnapshot(`
    "lol!

    If this test should pass, replace "toBe" with "toStrictEqual"

    Expected: {
      a: 1,
    }
    Received: serializes to the same string
    "
  `);
  expect(message(() => expect({ a: undefined }, "lol!").toBe<unknown>({}))).toMatchInlineSnapshot(`
    "lol!

    If this test should pass, replace "toBe" with "toEqual"

    Expected: {}
    Received: {
      a: undefined,
    }
    "
  `);
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

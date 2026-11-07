import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "../../aot/harness/default-timeout";
import { run } from "../../aot/harness/run";
import { test } from "../../aot/supported";

raiseDefaultTimeout(60_000);

const files = {
  "cases.ts": readFileSync(join(import.meta.dir, "../../aot/parallel/typed-objects/deep-equality/cases.ts"), "utf8"),
  "matchers.test.ts": `
import { expect, test } from "bun:test";
import { cases, type T } from "./cases";
const ok = (f: () => void) => { try { f(); return "T"; } catch { return "f"; } };
test("every pair, every matcher, both ways round", () => {
  for (const [name, left, right] of cases) {
    const l = left() as any, r = right() as any;
    console.log("ROW", name + ":", ok(() => expect(l).toEqual(r)) + ok(() => expect(r).toEqual(l)), ok(() => expect(l).toStrictEqual(r)) + ok(() => expect(r).toStrictEqual(l)), ok(() => expect(l).toMatchObject(r)) + ok(() => expect(r).toMatchObject(l)), ok(() => expect([l]).toContainEqual(r)) + ok(() => expect([r]).toContainEqual(l)), ok(() => expect(l).toEqual(expect.objectContaining(r))) + ok(() => expect(r).toEqual(expect.objectContaining(l))), ok(() => expect({ k: l }).toHaveProperty("k", r)) + ok(() => expect(l).not.toEqual(r)));
  }
});
test("asymmetric matchers against typed objects", () => {
  const t: T = { a: undefined, b: 1, c: "c" };
  const rows: [string, () => void][] = [
    ["any", () => expect(t).toEqual({ b: expect.any(Number), c: expect.any(String) })],
    ["any, strict", () => expect(t).toStrictEqual({ b: expect.any(Number), c: expect.any(String) })],
    ["any, strict, undefined named", () => expect(t).toStrictEqual({ a: undefined, b: expect.any(Number), c: expect.any(String) })],
    ["anything", () => expect(t).toEqual({ a: expect.anything(), b: 1, c: "c" })],
    ["stringContaining", () => expect(t).toMatchObject({ c: expect.stringContaining("c") })],
    ["objectContaining in an array", () => expect([t]).toEqual([expect.objectContaining({ b: 1 })])],
    ["arrayContaining", () => expect([t, { b: 2 } as T]).toEqual(expect.arrayContaining([{ b: 2 }]))],
    ["a typed object as the pattern", () => expect({ b: 1, c: "c", more: 1 }).toMatchObject(t)],
    ["a typed pattern with a matcher in a field", () => { const p: { b: unknown } = { b: expect.any(Number) }; expect<unknown>(t).toMatchObject(p); }],
    ["a typed expectation with a matcher in a field", () => { const p: { a?: unknown; b: unknown; c: unknown } = { b: expect.any(Number), c: "c" }; expect<unknown>(t).toEqual(p); }],
  ];
  for (const [name, f] of rows) console.log("ROW asymmetric:", name + ":", ok(f));
});
`,
};

const constructorFiles = {
  "pairs.cjs": readFileSync(
    join(
      import.meta.dir,
      "../../aot/parallel/objects/deep-comparison-of-two-records-one-with-constructor-beside-a-late-key/pairs.cjs",
    ),
    "utf8",
  ),
  "constructors.test.cjs": `
const { describe } = require("bun:jsc");
const { test } = require("bun:test");
const { isDeepStrictEqual } = require("node:util");
const pairs = require("./pairs.cjs");
const structureOf = object => /StructureID: (\\d+)/.exec(describe(object))[1];
test("two records, one of which owns a constructor", () => {
  for (const [name, make] of pairs) {
    const [first, second] = make();
    console.log("SHAPE", name + ":", structureOf(first) === structureOf(second) ? "one Structure" : "two Structures");
    console.log("ROW", name + ":", isDeepStrictEqual(first, second));
  }
});
`,
};

async function rowsOf(cwd: string, aot: boolean, file = "./matchers.test.ts") {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...(aot ? ["--debug-aot"] : []), file], cwd);
  const lines = (prefix: string) => stdout.split("\n").filter(line => line.startsWith(prefix));
  return { rows: lines("ROW "), shapes: lines("SHAPE "), stderr: exitCode ? stderr : "", exitCode };
}

test("under bun test --aot, matchers that compare deeply answer for typed objects as for plain ones", async () => {
  using expectedDir = tempDir("test-aot-deep-equality", files);
  using actualDir = tempDir("test-aot-deep-equality", files);
  const [expected, actual] = await Promise.all([rowsOf(String(expectedDir), false), rowsOf(String(actualDir), true)]);
  expect(expected.rows.length).toBe(88);
  expect(actual).toEqual(expected);
  expect(actual.exitCode).toBe(0);
});

test("under bun test --aot, node:util answers for two records of one Structure, one of which owns a constructor, as without it", async () => {
  using expectedDir = tempDir("test-aot-deep-equality", constructorFiles);
  using actualDir = tempDir("test-aot-deep-equality", constructorFiles);
  const [{ shapes: _, ...expected }, { shapes, ...actual }] = await Promise.all([
    rowsOf(String(expectedDir), false, "./constructors.test.cjs"),
    rowsOf(String(actualDir), true, "./constructors.test.cjs"),
  ]);
  expect(expected.rows.length).toBe(9);
  expect(actual).toEqual(expected);
  // The comparison skips the read of the second constructor only for two objects of one Structure: without such a pair no row asks for it.
  expect(shapes).toContain("SHAPE a value that is not enumerable, on the second: one Structure");
  expect(shapes).toContain("SHAPE a getter that is not enumerable, on the second: one Structure");
  expect(actual.exitCode).toBe(0);
});

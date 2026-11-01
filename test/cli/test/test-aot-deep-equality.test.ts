import { expect, setDefaultTimeout } from "bun:test";
import { readFileSync } from "fs";
import { bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run } from "../../aot/harness/run";
import { test } from "../../aot/supported";

setDefaultTimeout(60_000);

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

async function rowsOf(cwd: string, aot: boolean, file = "./matchers.test.ts") {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...(aot ? ["--debug-aot"] : []), file], cwd);
  return { rows: stdout.split("\n").filter(line => line.startsWith("ROW ")), stderr: exitCode ? stderr : "", exitCode };
}

test("under bun test --aot, matchers that compare deeply answer for typed objects as for plain ones", async () => {
  using expectedDir = tempDir("test-aot-deep-equality", files);
  using actualDir = tempDir("test-aot-deep-equality", files);
  const [expected, actual] = await Promise.all([rowsOf(String(expectedDir), false), rowsOf(String(actualDir), true)]);
  expect(expected.rows.length).toBe(88);
  expect(actual).toEqual(expected);
  expect(actual.exitCode).toBe(0);
});

const emptinessFiles = {
  "no-exports.ts": "export {};\n",
  "emptiness.test.ts": `
import { expect, test } from "bun:test";
import * as noExports from "./no-exports";
class Plain {}
class WithField { a = 1; }
class Tagged { get [Symbol.toStringTag]() { return "Tagged"; } }
const ok = (f: () => void) => { try { f(); return "T"; } catch { return "f"; } };
test("toBeEmpty() and its negation", () => {
  const rows: [string, unknown][] = [
    ["an object literal", {}],
    ["an object literal with a field", { a: 1 }],
    ["an instance", new Plain()],
    ["an instance with a field", new WithField()],
    ["an instance of a class with a Symbol.toStringTag getter", new Tagged()],
    ["a module namespace with no exports", noExports],
    ["a Date", new Date(0)],
  ];
  for (const [name, value] of rows) console.log("ROW", name + ":", ok(() => expect(value).toBeEmpty()) + ok(() => expect(value).not.toBeEmpty()));
});
`,
};

test("under bun test --aot, toBeEmpty() answers for compiled objects and namespaces as for plain ones", async () => {
  using expectedDir = tempDir("test-aot-to-be-empty", emptinessFiles);
  using actualDir = tempDir("test-aot-to-be-empty", emptinessFiles);
  const [expected, actual] = await Promise.all([
    rowsOf(String(expectedDir), false, "./emptiness.test.ts"),
    rowsOf(String(actualDir), true, "./emptiness.test.ts"),
  ]);
  expect(expected.rows).toEqual([
    "ROW an object literal: Tf",
    "ROW an object literal with a field: fT",
    "ROW an instance: Tf",
    "ROW an instance with a field: fT",
    "ROW an instance of a class with a Symbol.toStringTag getter: Tf",
    "ROW a module namespace with no exports: Tf",
    "ROW a Date: fT",
  ]);
  expect(actual).toEqual(expected);
  expect(actual.exitCode).toBe(0);
});

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
test("the constructor of a Set that a Proxy serves", () => {
  const serving = (constructor: Function) =>
    new Proxy(new Set([1]), {
      get(target, key) {
        if (key === "constructor") return constructor;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const rows: [string, Function, Function][] = [
    ["two bound functions of one name", Set.bind(null), Set.bind(null)],
    ["two classes of one name", class X {}, class X {}],
    ["two bound classes of one name", (class X {}).bind(null), (class X {}).bind(null)],
    ["a class of the name Set and Set", { Set: class {} }.Set, Set],
    ["a bound function and a function of its name", Set.bind(null), { "bound Set": function () {} }["bound Set"]],
  ];
  for (const [name, a, b] of rows) console.log("ROW constructor:", name + ":", ok(() => expect(serving(a)).toEqual(serving(b))));
});
`,
};

async function rowsOf(cwd: string, aot: boolean) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...(aot ? ["--debug-aot"] : []), "./matchers.test.ts"],
    cwd,
  );
  return { rows: stdout.split("\n").filter(line => line.startsWith("ROW ")), stderr: exitCode ? stderr : "", exitCode };
}

test("under bun test --aot, matchers that compare deeply answer for typed objects as for plain ones", async () => {
  using expectedDir = tempDir("test-aot-deep-equality", files);
  using actualDir = tempDir("test-aot-deep-equality", files);
  const [expected, actual] = await Promise.all([rowsOf(String(expectedDir), false), rowsOf(String(actualDir), true)]);
  // For two Proxies around a Set, toEqual() takes two constructors for one only if both print as `[native code]` under one name.
  expect(expected.rows.filter(row => row.startsWith("ROW constructor: "))).toEqual([
    "ROW constructor: two bound functions of one name: T",
    "ROW constructor: two classes of one name: f",
    "ROW constructor: two bound classes of one name: T",
    "ROW constructor: a class of the name Set and Set: f",
    "ROW constructor: a bound function and a function of its name: f",
  ]);
  expect(expected.rows.length).toBe(93);
  expect(actual).toEqual(expected);
  expect(actual.exitCode).toBe(0);
});

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

const classFiles = {
  "cases.ts": readFileSync(
    join(import.meta.dir, "../../aot/parallel/typed-objects/deep-equality-of-classes/cases.ts"),
    "utf8",
  ),
  "matchers.test.ts": `
import { expect, test } from "bun:test";
import { cases } from "./cases";
const ok = (f: () => void) => { try { f(); return "T"; } catch { return "f"; } };
test("every pair, both ways round, then inside an object and an array", () => {
  for (const [name, left, right] of cases) {
    const l = left() as any, r = right() as any;
    console.log("ROW", name + ":", ok(() => expect(l).toStrictEqual(r)) + ok(() => expect(r).toStrictEqual(l)), ok(() => expect({ k: [l] }).toStrictEqual({ k: [r] })) + ok(() => expect({ k: [r] }).toStrictEqual({ k: [l] })));
  }
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
  expect(expected.rows.length).toBe(88);
  expect(actual).toEqual(expected);
  expect(actual.exitCode).toBe(0);
});

test("under bun test --aot, toStrictEqual() tells two classes apart as without it", async () => {
  using expectedDir = tempDir("test-aot-deep-equality", classFiles);
  using actualDir = tempDir("test-aot-deep-equality", classFiles);
  const [expected, actual] = await Promise.all([rowsOf(String(expectedDir), false), rowsOf(String(actualDir), true)]);
  expect(actual).toEqual(expected);
  expect(actual.exitCode).toBe(0);
  expect(expected.rows.join("\n")).toMatchInlineSnapshot(`
    "ROW built-in: a Map and an heir: ff ff
    ROW built-in: two of one heir: TT TT
    ROW built-in: two heirs of Map: ff ff
    ROW built-in: a Set and an heir: ff ff
    ROW built-in: a Date and an heir: ff ff
    ROW built-in: an Error and an heir: ff ff
    ROW built-in: two of one heir of Error: TT TT
    ROW built-in: a RegExp and an heir: ff ff
    ROW built-in: a Uint8Array and an heir: ff ff
    ROW built-in: an ArrayBuffer and an heir: ff ff
    ROW built-in: a Buffer and a Uint8Array: ff ff
    ROW built-in: a Map and a mixin over it: ff ff
    ROW built-in: two mixins over Map: ff ff
    ROW built-in: a Date that owns the constructor Date: TT TT
    ROW built-in: inside a typed object: ff ff
    ROW instances: the same: TT TT
    ROW instances: a class and its heir: ff ff
    ROW instances: a class and a mixin over it: ff ff
    ROW instances: against a record: ff ff
    ROW instances: against a plain object: ff ff
    ROW instances: two classes with one name: ff ff
    ROW instances: one class with that name: TT TT
    ROW instances: two classes with no name: ff ff
    ROW instances: one class with no name: TT TT
    ROW instances: no name, against a record: ff ff
    ROW instances: no name, against a plain object: ff ff
    ROW instances: an heir without a constructor of its own: TT TT
    ROW instances: born by Object.create: TT TT
    ROW instances: a getter named constructor: TT TT
    ROW instances: a getter named constructor, against a record: TT TT
    ROW instances: in an array: ff ff
    ROW instances: Map values: ff ff
    ROW instances: Set members: ff ff
    ROW prototypes: of a class and of its heir: ff ff
    ROW prototypes: of two classes: ff ff
    ROW prototypes: of two classes with one name: ff ff
    ROW prototypes: of one class: TT TT
    ROW prototypes: of two classes with one name, which nothing has read: ff ff
    ROW prototypes: an object made from one that nothing has read, and another such prototype: ff ff
    ROW typed | typed: the same: TT TT
    ROW typed | plain: the same: TT TT
    ROW typed | typed: a null prototype: ff ff
    ROW typed | typed: both with a null prototype: TT TT
    ROW typed | plain: a null prototype on the plain one: ff ff
    ROW typed | typed: the prototype of a class: TT TT
    ROW a field named constructor: the same object in it: TT TT
    ROW a field named constructor: other values: ff ff
    ROW a field named constructor: NaN: TT TT
    ROW a field named constructor: undefined against absent: ff ff
    ROW a field named constructor: against a plain object: TT TT
    ROW a field named constructor: one class in both: TT TT
    ROW a field named constructor: two classes: ff ff
    ROW a field named constructor: a class against a value: ff ff
    ROW a field named constructor: Object against absent: ff ff
    ROW an extra named constructor: the same object in it: TT TT
    ROW an extra named constructor: other values: ff ff
    ROW an extra named constructor: NaN: TT TT
    ROW an extra named constructor: on one side: ff ff
    ROW an extra named constructor: against the field: TT TT
    ROW an extra named constructor: against a plain object: TT TT
    ROW an extra named constructor: one class in both: TT TT
    ROW an extra named constructor: two classes: ff ff
    ROW an extra named constructor: the class of the other side: ff ff
    ROW an extra named constructor: on an instance: ff ff
    ROW an extra named constructor: on an instance, its own class: ff ff
    ROW a hidden constructor: the same object in it: TT TT
    ROW a hidden constructor: other values: TT TT
    ROW a hidden constructor: on one side: ff ff
    ROW a hidden constructor: two classes: ff ff
    ROW a hidden constructor: the class of the other side: TT TT
    ROW a computed key that spells constructor: the same object in it: TT TT
    ROW a computed key that spells constructor: two classes: ff ff
    ROW a computed key that spells constructor: against the field: TT TT
    ROW a getter named constructor in a record: ff ff
    ROW a key named constructor deep inside: TT TT"
  `);
});

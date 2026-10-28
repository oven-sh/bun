import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";
import { run } from "./harness/run";

// Freezing an array, or allocating an Array subclass, must not break what compiled code assumes about structures and cell types.
// Only language semantics are exercised here, so plain `bun run` is the oracle.
const arrays: Record<string, string> = {
  int32: "[i, i + 1, 3]",
  double: "[i + 0.5, 1.5, 2.5]",
  contiguous: '[{}, "s", i]',
  copyOnWrite: "[1, 2, 3]",
  holey: "[i, , 3]",
  spread: "[...[i, 2, 3]]",
  fromArrayLike: "Array.from({ length: 3 }, (_, k) => k + i)",
  subclassOf: "Subclass.of(i, 2, 3)",
  subclassNew: "new Subclass(3).fill(i)",
};
const integrityLevels: Record<string, string> = {
  freeze: "Object.freeze(a)",
  seal: "Object.seal(a)",
  preventExtensions: "Object.preventExtensions(a)",
  freezeInCallee: "freezeInCallee(a)",
};
const mutations: Record<string, string> = {
  storeFirst: "a[0] = -1",
  storeAtLength: "a[a.length] = -1",
  storeSparse: "a[10] = -1",
  storeDouble: "a[0] = 0.5",
  storeObject: "a[0] = {}",
  storeInCallee: "storeInCallee(a, 0, -1)",
  increment: "a[0]++",
  push: "a.push(-1)",
  pop: "a.pop()",
  shift: "a.shift()",
  unshift: "a.unshift(-1)",
  splice: "a.splice(0, 1)",
  truncate: "a.length = 0",
  grow: "a.length = 9",
  sort: "a.sort()",
  reverse: "a.reverse()",
  fill: "a.fill(-1)",
  deleteFirst: "delete a[0]",
  addNamedProperty: "a.extra = 1",
  defineProperty: "Object.defineProperty(a, 0, { value: -1 })",
  defineAccessor: "Object.defineProperty(a, 0, { get() { return -1; }, configurable: true })",
  assign: "Object.assign(a, [-1])",
  reflectSet: "Reflect.set(a, 0, -1)",
  setPrototypeOf: "Object.setPrototypeOf(a, null)",
};
const observe =
  'JSON.stringify(a) + "|" + a.length + "|" + Object.isFrozen(a) + Object.isSealed(a) + Object.isExtensible(a) + "|" + Array.prototype.slice.call(a).length + "|" + Array.prototype.indexOf.call(a, 3) + "|" + Object.keys(a).join("")';
const prelude = `class Subclass extends Array {}
function freezeInCallee(a) { return Object.freeze(a); }
function storeInCallee(a, k, v) { a[k] = v; }
function normalize(s, i) { return s.split(String(i + 1)).join("J").split(String(i)).join("I"); }
function count(f) { const seen = {}; for (let i = 1000; i < ${isASAN ? 5000 : 21000}; i++) { let outcome; try { outcome = normalize(String(f(i)), i); } catch (e) { outcome = "uncaught " + e.name; } seen[outcome] = (seen[outcome] || 0) + 1; } return JSON.stringify(seen); }
`;

export function frozenArrayTests(part: number, parts: number) {
  const kinds = Object.keys(arrays).filter((_, index) => index % parts === part - 1);
  test.concurrent.each(kinds)("%s", async kind => {
    const cases: string[] = [];
    for (const [level, applyLevel] of Object.entries(integrityLevels))
      for (const [mutation, mutate] of Object.entries(mutations))
        cases.push(`console.log(${JSON.stringify(`${level} ${mutation}`)}, count(i => { const a = ${arrays[kind]}; ${applyLevel}; let threw = ""; try { ${mutate}; } catch (e) { threw = e.name; } return threw + "|" + ${observe}; }));`);
    using dir = tempDir("run-aot-frozen-arrays", { "main.mjs": prelude + cases.join("\n") + "\n" });
    const results = [];
    for (const flags of [[], ["--aot"]]) {
      const { stdout, exitCode } = await run([bunExe(), "run", ...flags, "main.mjs"], String(dir));
      results.push({ lines: stdout.split("\n"), exitCode });
    }
    expect(results[0].lines.length).toBe(cases.length + 1);
    expect(results[1]).toEqual(results[0]);
  }, isASAN || isDebug ? 450_000 : 120_000);
}

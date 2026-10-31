import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "x.ts": `let count = 0;
export function next(): number { return ++count; }
export const made = {};
`,
  "only.ts": `export const value: number = 1;`,
  "user.ts": `import { next } from "./x";
export function nextOfUser(): number { return next(); }
`,
  "a.test.ts": `import { expect, test } from "bun:test";
import { made, next } from "./x";
import { nextOfUser } from "./user";
test("each query gives a fresh instance", async () => {
  const one = await import("./x.ts?fresh=1");
  const two = await import("./x.ts?fresh=2");
  const oneAgain = await import("./x.ts?fresh=1");
  expect(one.next()).toBe(1);
  expect(one.next()).toBe(2);
  expect(two.next()).toBe(1);
  expect(oneAgain).toBe(one);
  expect(one.made).not.toBe(two.made);
  expect(one.made).not.toBe(made);
});
test("the import without a query keeps its state", () => {
  expect(next()).toBe(1);
  expect(nextOfUser()).toBe(2);
});
test("a query made at run time", async () => {
  for (const n of [Date.now(), Date.now() + 1]) {
    const fresh = await import(\`./x.ts?fresh=\${n}\`);
    expect(fresh.next()).toBe(1);
  }
});
test("a query of a file that nothing else imports", async () => {
  expect((await import("./only.ts?v=1")).value).toBe(1);
});
`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { results, exitCode };
}

test("a query on an import in a compiled test run gives a fresh instance, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query", files);
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBe(4);
  expect(plain.exitCode).toBe(0);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test("a query through a parameter loads, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query-parameter", {
    "x.ts": `export const v = 1;`,
    "helper.ts": `export const load = (path: string) => import(path);`,
    "a.test.ts": `import { expect, test } from "bun:test";
import { load } from "./helper";
const question = "./x.ts?v=1 is what the docs say";
test("through a parameter", async () => {
  expect(question.length).toBeGreaterThan(0);
  expect((await load(import.meta.dir + "/x.ts?fresh=1")).v).toBe(1);
});
`,
  });
  const { results, exitCode } = await runTests(String(dir), "--aot");
  expect({ results, exitCode }).toEqual({ results: ["pass through a parameter"], exitCode: 0 });
}, 60_000);

test("an instance under a query imports what its file imports, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query-imports", {
    "base.ts": `export const base: string = "base";`,
    "base.cjs": `exports.base = "base";`,
    "config.ts": `import { base } from "./base";
export const mode = process.env.MODE + " on " + base;
`,
    "config.cjs": `exports.mode = process.env.MODE + " on " + require("./base.cjs").base;`,
    "a.test.ts": `import { expect, test } from "bun:test";
test("a module", async () => {
  process.env.MODE = "one";
  const first = await import("./config.ts");
  process.env.MODE = "two";
  const second = await import("./config.ts?again");
  expect([first.mode, second.mode]).toEqual(["one on base", "two on base"]);
});
test("a CommonJS file", async () => {
  process.env.MODE = "one";
  const first = await import("./config.cjs");
  process.env.MODE = "two";
  const second = await import("./config.cjs?again");
  expect([first.mode, second.mode]).toEqual(["one on base", "two on base"]);
});
`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBe(2);
  expect(plain.exitCode).toBe(0);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test("an instance under a query hands its own objects to compiled functions, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query-own-objects", {
    "package.json": `{ "type": "module" }`,
    "kept.js": `
export class Point {
  #secret = 7;
  constructor(x, y) { this.x = x; this.y = y; }
  norm() { return this.x + this.y; }
  static secretOf(point) { return point.#secret; }
}
export function sumOf(pair) { return pair.x + pair.y; }
export function total(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
export function call(callback) { return callback(20) + 1; }
export function normOf(point) { return point.norm(); }
export function describe(options) { return options.name + ":" + options.size.width + "x" + options.size.height; }
export const held = { last: null };
export function keep(value) { held.last = value; return held.last.tag; }
export let counter = 0;
export function count(by) { counter += by; return counter; }`,
    "user.js": `
import { Point, sumOf, total, call, normOf, describe, keep, held, count, counter } from "./kept.js";
class Own { constructor() { this.x = 5; this.y = 6; } norm() { return "own norm"; } }
export const run = () => [
  sumOf({ x: 1, y: 2 }),
  total([1.5, 2.5, 3]),
  total([1, 2, 3]),
  call(value => value * 2),
  normOf(new Point(3, 4)),
  normOf(new Own()),
  Point.secretOf(new Point(1, 1)),
  describe({ name: "box", size: { width: 2, height: 3 } }),
  keep({ tag: "kept", extra: [1] }),
  held.last.extra.length,
  count(2),
  counter,
];`,
    "a.test.ts": `import { expect, test } from "bun:test";
test("its own objects", async () => {
  const answers = [3, 7, 6, 41, 7, "own norm", 7, "box:2x3", "kept", 1];
  const first = await import("./user.js");
  for (let i = 0; i < 3; i++) first.run();
  const again = await import("./user.js?again");
  expect(again).not.toBe(first);
  expect(again.run().slice(0, 10)).toEqual(answers);
  expect(first.run().slice(0, 10)).toEqual(answers);
  for (let i = 0; i < 2000; i++) again.run();
  expect(again.run().slice(0, 10)).toEqual(answers);
});
`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass its own objects"]);
  expect(plain.exitCode).toBe(0);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test("a copy from disk reaches the compiled modules by every way, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query-every-way", {
    "package.json": `{ "type": "module" }`,
    "kept.js": `
export class Point {
  #secret = 7;
  constructor(x, y) { this.x = x; this.y = y; }
  norm() { return this.x + this.y; }
  static secretOf(point) { return point.#secret; }
}
export function sumOf(pair) { return pair.x + pair.y; }
export function total(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
export function call(callback) { return callback(20) + 1; }
export function normOf(point) { return point.norm(); }
export function describe(options) { return options.name + ":" + options.size.width + "x" + options.size.height; }
export const held = { last: null };
export function keep(value) { held.last = value; return held.last.tag; }
export let counter = 0;
export function count(by) { counter += by; return counter; }`,
    "only-under-a-query.js": `
import { Point, sumOf, total, call, normOf, describe, keep, held, count, counter } from "./kept.js";
class Own { constructor() { this.x = 5; this.y = 6; } norm() { return "own norm"; } }
export const run = () => [
  sumOf({ x: 1, y: 2 }),
  total([1.5, 2.5, 3]),
  total([1, 2, 3]),
  call(value => value * 2),
  normOf(new Point(3, 4)),
  normOf(new Own()),
  Point.secretOf(new Point(1, 1)),
  describe({ name: "box", size: { width: 2, height: 3 } }),
  keep({ tag: "kept", extra: [1] }),
  held.last.extra.length,
  count(2),
  counter,
];`,
    "late-user.js": `
class Own { constructor() { this.x = 5; this.y = 6; } norm() { return "own norm"; } }
export const run = async () => {
  const { Point, sumOf, total, call, normOf, describe, keep, held } = await import("./kept.js");
  return [
    sumOf({ x: 1, y: 2 }),
    total([1.5, 2.5, 3]),
    total([1, 2, 3]),
    call(value => value * 2),
    normOf(new Point(3, 4)),
    normOf(new Own()),
    Point.secretOf(new Point(1, 1)),
    describe({ name: "box", size: { width: 2, height: 3 } }),
    keep({ tag: "kept", extra: [1] }),
    held.last.extra.length,
  ];
};`,
    "a.test.ts": `import { expect, test } from "bun:test";
import { sumOf } from "./kept.js";
const answers = [3, 7, 6, 41, 7, "own norm", 7, "box:2x3", "kept", 1];
test("a file that is reached only under a query", async () => {
  const copy = await import("./only-under-a-query.js?again");
  for (let i = 0; i < 300; i++) copy.run();
  expect(copy.run().slice(0, 10)).toEqual(answers);
  expect(sumOf({ x: 2, y: 2 })).toBe(4);
});
test("a copy under a query loads by import()", async () => {
  const first = await import("./late-user.js");
  expect(await first.run()).toEqual(answers);
  const copy = await import("./late-user.js?again");
  expect(copy).not.toBe(first);
  for (let i = 0; i < 300; i++) await copy.run();
  expect(await copy.run()).toEqual(answers);
  expect(await first.run()).toEqual(answers);
});
test("a module that runs again loads by import()", async () => {
  const first = await import("./late-user.js");
  delete require.cache[require.resolve("./late-user.js")];
  const copy = await import("./late-user.js");
  expect(copy).not.toBe(first);
  expect(await copy.run()).toEqual(answers);
  expect(await first.run()).toEqual(answers);
});
`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBe(3);
  expect(plain.exitCode).toBe(0);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test("a copy made by require() under a query requires a compiled file when its load is over, as in plain bun test", async () => {
  using dir = tempDir("aot-test-run-query-later-require", {
    "package.json": `{ "type": "module" }`,
    "hidden-common.cjs": `
exports.sumOf = pair => pair.x + pair.y;
exports.value = 1;
exports.list = [1, 2, 3];
exports.nested = { pick: value => value + 1, depth: 1 };`,
    "reader-common.cjs": `
const hidden = require("./hidden-common.cjs");
const { sumOf } = require("./hidden-common.cjs");
exports.read = () => [
  hidden.sumOf({ x: 1, y: 2 }),
  sumOf({ x: 1, y: 2 }),
  hidden.value + 1,
  hidden.list.length,
  hidden.nested.pick(1),
  hidden.nested.depth + 1,
  Object.keys(hidden).join(),
];`,
    "copy-common.cjs": `
exports.reach = name => {
  const hidden = require("./" + name + ".cjs");
  hidden.sumOf = () => "replaced";
  hidden.value = "written";
  hidden.list = "no list";
  hidden.nested.pick = value => "picked " + value;
  hidden.nested.depth = "deep";
  hidden.added = true;
};`,
    "a.test.ts": `import { expect, test } from "bun:test";
test("what the copy writes is read", () => {
  const { read } = require("./reader-common.cjs");
  for (let i = 0; i < 300; i++) read();
  expect(read()).toEqual([3, 3, 2, 3, 2, 2, "sumOf,value,list,nested"]);
  require("./copy-common.cjs?again").reach(["hidden", "common"].join("-"));
  expect(read()).toEqual(["replaced", 3, "written1", 7, "picked 1", "deep1", "sumOf,value,list,nested,added"]);
});
`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass what the copy writes is read"]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test.each([
  ["star.js", `export * from "./one.js";`],
  ["named.js", `export { a } from "./one.js";`],
  ["namespace.js", `export * as one from "./one.js";`],
  ["uses.js", `import { a } from "./one.js"; export const mine = a;`],
])(
  "an instance of %s under a query begins a compiled file that nothing has run yet, as in plain bun test",
  async (file, text) => {
    using dir = tempDir("aot-test-run-query-begins-a-file", {
      "package.json": `{ "type": "module" }`,
      "one.js": `export const a = "one a"; export function f() { return "one f"; }`,
      [file]: text,
      "a.test.ts": `import { expect, test } from "bun:test";
const seenIn = module => module.a ?? module.mine ?? module.one.a;
test("the copy comes first", async () => {
  expect(seenIn(await import("./${file}?again"))).toBe("one a");
});
test("the file by its own name", async () => {
  expect(seenIn(await import("./${file}"))).toBe("one a");
});
`,
    });
    const plain = await runTests(String(dir));
    expect(plain.results).toEqual(["pass the copy comes first", "pass the file by its own name"]);
    expect(await runTests(String(dir), "--aot")).toEqual(plain);
  },
  60_000,
);

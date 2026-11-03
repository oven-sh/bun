import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// Each case builds and runs in a folder of its own. One after the other they take longer than CI gives a file on the lane with assertions,
// and at once they still take about that long there: so they are dealt out over four files, by the time that they take.
const test = oneAtATime.concurrent;

const countingState = `globalThis.loads = (globalThis.loads ?? 0) + 1;\nexport let count = 0;\nexport function bump() { return ++count; }\nexport default { held: 0 };`;
const takesStateOutAndLoadsItAgain = `
      import { test } from "bun:test";
      test("takes it out and loads it again", () => {
        const path = require.resolve("./state.js");
        const first = require(path);
        first.bump(); first.bump();
        delete require.cache[path];
        const second = require(path);
        second.bump(); second.default.held = 7;
        console.log(first.count, second.count, first === second);
      });`;
const takesNothingOut = takesStateOutAndLoadsItAgain.replace("delete ", "if (globalThis.never) delete ");

test("the import statements of a later test file name the instance that require() answers", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": countingState,
    "a.test.js": takesStateOutAndLoadsItAgain,
    "b.test.js": `
      import { test } from "bun:test";
      console.log("at load", count, bump());
      import box, { bump, count } from "./state.js";
      import * as all from "./state";
      export { bump as again } from "./state.js";
      test("names, the namespace object and the default export", async () => {
        const now = require(require.resolve("./state.js"));
        console.log(count, bump(), count, now.count, now.bump(), count, globalThis.loads);
        console.log(all === now, all.count, Object.keys(all).join(), box === now.default, box.held);
        console.log((await import("./b.test.js")).again(), count);
      });
      test("a binding stays with its instance", () => {
        const path = require.resolve("./state.js");
        delete require.cache[path];
        const fresh = require(path);
        console.log(bump(), count, all.count, fresh.count, fresh.bump === bump, globalThis.loads);
      });`,
    "c.test.js": `
      import { test } from "bun:test";
      import { bump, count } from "./state.js";
      test("the next test file gets the newest", () => { console.log(count, bump(), count, globalThis.loads); });`,
  });
});

test("an import statement of a later test file loads a file again that nothing has loaded since, in its turn", async () => {
  const says = (word: string) => `(globalThis.order ??= []).push("${word}");\nexport const word = "${word}";`;
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": `(globalThis.order ??= []).push("state");\n${countingState}`,
    "before.js": says("before"),
    "after.js": says("after"),
    "a.test.js": `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      test("takes it out", () => { bump(); bump(); delete require.cache[require.resolve("./state.js")]; });`,
    "b.test.js": `
      import { test } from "bun:test";
      import { word as first } from "./before.js";
      import { bump, count } from "./state.js";
      import { word as last } from "./after.js";
      test("loads", () => { console.log(globalThis.order.join(), first, last, count, bump(), require("./state.js").count, globalThis.loads); });`,
  });
});

test("a later test file sees a file that was taken out as the modules between them do", async () => {
  const user = `import { bump, count } from "./state.js";\nexport const seenWhenLoaded = count;\nexport const next = () => bump();\nexport const now = () => count;`;
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": countingState,
    "ran.js": user,
    "late.js": user,
    "a.test.js": `
      import { test } from "bun:test";
      import { next } from "./ran.js";
      test("takes it out", () => { next(); next(); next(); const path = require.resolve("./state.js"); delete require.cache[path]; require(path).bump(); });`,
    "b.test.js": `
      import { test } from "bun:test";
      import * as ran from "./ran.js";
      import * as late from "./late.js";
      import { bump, count } from "./state.js";
      test("one importer has run and one has not", () => {
        console.log(ran.seenWhenLoaded, ran.now(), late.seenWhenLoaded, late.now(), count);
        console.log(ran.next(), late.next(), bump(), ran.now(), late.now(), count);
      });`,
  });
});

test("a spy and a mock reach a file that may be taken out, whether or not it was", async () => {
  const spies = `
      import { mock, spyOn, test } from "bun:test";
      import * as state from "./state.js";
      import { next } from "./user.js";
      test("a spy", () => {
        const spy = spyOn(state, "bump").mockReturnValue(42);
        console.log(next(), state.bump(), spy.mock.calls.length);
        spy.mockRestore();
        console.log(next(), state.bump(), state.count);
      });
      test("a mock", () => {
        mock.module("./state.js", () => ({ bump: () => "mocked", count: -1 }));
        console.log(next(), state.bump(), state.count, require("./state.js").bump());
      });`;
  for (const first of [takesStateOutAndLoadsItAgain, takesNothingOut]) {
    await expectCompiledToRunAsPlain({
      "package.json": `{ "type": "module" }`,
      "state.js": countingState,
      "user.js": `import { bump } from "./state.js";\nexport const next = () => bump();`,
      "a.test.js": first,
      "b.test.js": spies,
    });
  }
});

test("a preload takes a file out that the test files import", async () => {
  for (const flags of [[], ["--isolate"]]) {
    await expectCompiledToRunAsPlain(
      {
        "package.json": `{ "type": "module" }`,
        "bunfig.toml": `[test]\npreload = ["./setup.js"]`,
        "state.js": countingState,
        "setup.js": `const path = require.resolve("./state.js");\nrequire(path).bump();\ndelete require.cache[path];\nrequire(path).bump();\nrequire(path).bump();`,
        "a.test.js": `
      import { test } from "bun:test";
      import { bump, count } from "./state.js";
      test("imports", () => { console.log(count, bump(), globalThis.loads); });`,
      },
      ...flags,
    );
  }
});

test("a later test file imports a CommonJS file that was taken out as require() answers it", async () => {
  const imports = `
      import { test } from "bun:test";
      import state, { bump, made } from "./state.cjs";
      import * as all from "./state.cjs";
      test("imports", () => {
        const now = require("./state.cjs");
        console.log(state === now, state.count, bump(), now.count, made === now.made, all.default === now, globalThis.loads);
      });`;
  for (const loadsAgain of ["", "require(path).bump();"]) {
    await expectCompiledToRunAsPlain({
      "package.json": `{ "type": "module" }`,
      "state.cjs": `globalThis.loads = (globalThis.loads ?? 0) + 1;\nlet count = 0;\nmodule.exports = { bump() { return ++count; }, get count() { return count; }, made: {} };`,
      "a.test.js": `
      import { test } from "bun:test";
      import state from "./state.cjs";
      test("takes it out", () => { const path = require.resolve("./state.cjs"); state.bump(); state.bump(); delete require.cache[path]; ${loadsAgain} });`,
      "b.test.js": imports,
    });
  }
});

test("a later test file imports a file of data that was taken out anew", async () => {
  const imports = `
      import { test } from "bun:test";
      import data, { inner } from "./d.json";
      import * as all from "./d.json";
      import typed from "./d.txt" with { type: "toml" };
      import text from "./d.txt";
      test("imports", () => {
        const now = require("./d.json");
        console.log(data.n, data === now, inner === now.inner, all.default === now, all.n, typed.n, JSON.stringify(text));
      });`;
  for (const flags of [[], ["--isolate"]]) {
    for (const loadsAgain of ["", "require(path).n = 7;"]) {
      await expectCompiledToRunAsPlain(
        {
          "package.json": `{ "type": "module" }`,
          "d.json": `{ "n": 1, "inner": { "m": 2 } }`,
          "d.txt": `n = 1\n`,
          "a.test.js": `
      import { test } from "bun:test";
      import data from "./d.json";
      import typed from "./d.txt" with { type: "toml" };
      test("takes them out", () => {
        const path = require.resolve("./d.json");
        data.n = 5; typed.n = 5;
        delete require.cache[path];
        delete require.cache[require.resolve("./d.txt")];
        ${loadsAgain}
      });`,
          "b.test.js": imports,
        },
        ...flags,
      );
    }
  }
});

test("the JSX of a later test file calls the runtime that require() answers", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "own" } }`,
    "node_modules/own/package.json": `{ "name": "own", "type": "module", "exports": { "./jsx-runtime": "./jsx.js", "./jsx-dev-runtime": "./jsx.js" } }`,
    "node_modules/own/jsx.js": `export let made = 0;\nexport const jsx = (type, props) => ({ type, props, number: ++made });\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";`,
    "a.test.jsx": `
      import { test } from "bun:test";
      test("takes it out", () => {
        const [one, two] = [<p />, <p />];
        const path = require.resolve("own/jsx-dev-runtime");
        delete require.cache[path];
        const fresh = require(path);
        fresh.jsx("q", {});
        console.log(one.number, two.number, fresh.made);
      });`,
    "b.test.jsx": `
      import { test } from "bun:test";
      test("makes an element", () => { const made = <p id="x" />; console.log(made.type, made.number, require("own/jsx-dev-runtime").made); });`,
  });
});

test("a file that may be taken out imports the test file that imports it", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": `import { fromTestFile } from "./b.test.js";\n${countingState}\nexport const ask = () => fromTestFile();`,
    "a.test.js": `
      import { test } from "bun:test";
      test("takes nothing out", () => { if (globalThis.never) delete require.cache[require.resolve("./state.js")]; });`,
    "b.test.js": `
      import { test } from "bun:test";
      import { ask, bump, count } from "./state.js";
      export function fromTestFile() { return "from the test file"; }
      test("on a cycle", () => { console.log(count, bump(), ask()); });`,
  });
});

test("a test file that imports a file that may be taken out is compiled, and so is the file until it is taken out", async () => {
  const project = (first: string) => ({
    "package.json": `{ "type": "module" }`,
    "state.js": countingState,
    "stays.js": `export function stays() {}`,
    "a.test.js": first,
    "b.test.js": `
      import { test } from "bun:test";
      import { jscDescribe } from "bun:jsc";
      import { bump } from "./state.js";
      import { stays } from "./stays.js";
      function here() {}
      const kind = made => /Structure 0x[0-9a-f]+:\\[(0x[0-9a-f]+)/.exec(jscDescribe(made))[1];
      test("who is compiled", () => { console.log(bump(), kind(here) === kind(stays), kind(bump) === kind(stays)); });`,
  });
  const lastLine = async (first: string, env: Record<string, string | undefined>) => {
    using dir = tempDir("require-cache-in-test-runs", project(first));
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    return { last: stdout.trim().split("\n").at(-1), exitCode };
  };
  // A function of compiled code has a structure of its own.
  expect(await lastLine(takesStateOutAndLoadsItAgain, bunEnv)).toEqual({ last: "2 true false", exitCode: 0 });
  const withTripwire = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
  expect(await lastLine(takesNothingOut, withTripwire)).toEqual({ last: "4 true true", exitCode: 0 });
});

test("a module that runs again imports the modules that were not taken out", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": `export let count = 0;\nexport const bump = () => ++count;`,
    "late.js": `import { bump, count } from "./state.js";\nexport const seenWhenLoaded = count;\nexport const next = () => bump();`,
    "one.test.js": `
      import { test } from "bun:test";
      import * as state from "./state.js";
      test("the importer alone", async () => {
        const before = await import("./late.js");
        before.next(); before.next();
        delete require.cache[require.resolve("./late.js")];
        const late = await import("./late.js");
        console.log(late === before, late.seenWhenLoaded, late.next(), state.count);
      });`,
  });
});

test("a module that is loaded behind an eviction begins the compiled files that nothing has run yet", async () => {
  const other = (word: string) =>
    `export const word = "${word}";\nexport class Kind { name() { return "kind of " + word; } }\nexport function call() { return word + " called"; }`;
  const begin = `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      const evict = () => { bump(); delete require.cache[require.resolve("./state.js")]; };`;
  await expectCompiledToRunAsPlain(
    {
      "package.json": `{ "type": "module" }`,
      "state.js": `export let count = 0;\nexport const bump = () => ++count;`,
      "named.js": other("named"),
      "starred.js": other("starred"),
      "whole.js": other("whole"),
      "common.cjs": `exports.word = "common";\nexports.call = () => exports.word + " called";`,
      "by-names.js": `import { count } from "./state.js";\nimport { word, Kind, call } from "./named.js";\nexport const said = [count, word, new Kind().name(), call()];`,
      "by-a-star.js": `import { count } from "./state.js";\nexport * from "./starred.js";\nexport const seen = count;`,
      "by-objects.js": `import { count } from "./state.js";\nimport common from "./common.cjs";\nimport * as whole from "./whole.js";\nexport const said = [count, common.call(), Object.keys(whole).join(), whole.call()];`,
      "names.test.js": `${begin}
      test("by names", async () => { evict(); console.log((await import("./by-names.js")).said); });`,
      "star.test.js": `${begin}
      test("by a star", async () => { evict(); const late = await import("./by-a-star.js"); console.log(late.seen, late.word, late.call()); });`,
      "objects.test.js": `${begin}
      test("by objects", async () => { evict(); console.log((await import("./by-objects.js")).said); });`,
      "require.test.js": `${begin}
      test("by require", () => { evict(); console.log(require("./by-names.js").said); });`,
    },
    "--isolate",
  );
});

test("a copy from disk begins a compiled file that no compiled code runs", async () => {
  const inner = `globalThis.runsOfInner = (globalThis.runsOfInner ?? 0) + 1;\nexport const inner = "inner";\nexport function f() { return "f"; }`;
  await expectCompiledToRunAsPlain(
    {
      "package.json": `{ "type": "module" }`,
      "named.js": inner,
      "evicted.js": inner,
      "over-named.js": `export * from "./named.js";`,
      "over-evicted.js": `export { inner, f } from "./evicted.js";`,
      "named.test.js": `
      import { test } from "bun:test";
      test("only require.resolve names the file", async () => {
        require.resolve("./named.js");
        const copy = await import("./over-named.js?again");
        console.log(copy.inner, copy.f(), globalThis.runsOfInner);
      });`,
      "evicted.test.js": `
      import { test } from "bun:test";
      test("the file is taken out before anything has run it", async () => {
        delete require.cache[require.resolve("./evicted.js")];
        const copy = await import("./over-evicted.js?again");
        console.log(copy.inner, copy.f(), globalThis.runsOfInner);
      });`,
    },
    "--isolate",
  );
});

test("a module that runs again hands its own objects to compiled functions", async () => {
  await expectCompiledToRunAsPlain({
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
    "one.test.js": `
      import { test } from "bun:test";
      test("fresh copies", async () => {
        const first = await import("./user.js");
        for (let i = 0; i < 3; i++) first.run();
        console.log(JSON.stringify(first.run()));
        delete require.cache[require.resolve("./user.js")];
        const again = await import("./user.js");
        console.log(again !== first, JSON.stringify(again.run()), JSON.stringify(first.run()));
        delete require.cache[require.resolve("./user.js")];
        console.log(JSON.stringify(require("./user.js").run()));
        for (let i = 0; i < 2000; i++) again.run();
        console.log(JSON.stringify(again.run()));
      });`,
  });
});

test("each way to take a file out of require.cache runs it again", async () => {
  await expectCompiledToRunAsPlain({
    "counter.cjs": `globalThis.count = (globalThis.count ?? 0) + 1;\nmodule.exports = globalThis.count;`,
    "deletes-itself.cjs": `globalThis.own = (globalThis.own ?? 0) + 1;\ndelete require.cache[__filename];\nmodule.exports = globalThis.own;`,
    "throws-once.cjs": `globalThis.tries = (globalThis.tries ?? 0) + 1;\nif (globalThis.tries === 2) throw new Error("second");\nmodule.exports = globalThis.tries;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import Module from "node:module";
      const key = require.resolve("./counter.cjs");
      function evict(cache: any) { delete cache[key]; }
      test("ways", () => {
        const seen = [require("./counter.cjs")];
        Reflect.deleteProperty(require.cache, key);
        seen.push(require("./counter.cjs"));
        evict(require.cache);
        seen.push(require("./counter.cjs"));
        delete (Module as any)._cache[key];
        seen.push(require("./counter.cjs"), require("./counter.cjs"));
        console.log(seen);
      });
      test("a load that throws is tried again", () => {
        const file = require.resolve("./throws-once.cjs");
        const seen: unknown[] = [require("./throws-once.cjs")];
        delete require.cache[file];
        try { require("./throws-once.cjs"); } catch (error) { seen.push((error as Error).message); }
        seen.push(require("./throws-once.cjs"), require("./throws-once.cjs"));
        console.log(seen);
      });
      test("a file that deletes its own entry while it runs", () => {
        console.log(require("./deletes-itself.cjs"), require("./deletes-itself.cjs"), require("./deletes-itself.cjs"));
      });`,
  });
});

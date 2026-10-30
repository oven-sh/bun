import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const pkg = {
  "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js", "exports": { ".": "./index.js", "./client": "./client.js" } }`,
  "node_modules/pkg/index.js": `module.exports = require("./inner.js");`,
  "node_modules/pkg/client.js": `const inner = require("./inner.js");\nexports.canUse = inner.canUse;\nexports.runs = inner.runs;`,
  "node_modules/pkg/inner.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.canUse = typeof window !== "undefined";\nexports.runs = globalThis.runs;`,
};

async function expectCompiledToRunAsPlain(files: Record<string, string>, ...always: string[]) {
  using dir = tempDir("require-cache-in-test-runs", files);
  const endsInAnyOrder = always.some(flag => flag.startsWith("--parallel"));
  const test = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...always, ...flags], String(dir), bunEnv);
    if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
    const passed = [...stderr.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]);
    return { stdout, passed: endsInAnyOrder ? passed.sort() : passed, exitCode };
  };
  const plain = await test();
  expect(plain.exitCode).toBe(0);
  expect(plain.passed).not.toEqual([]);
  expect(await test("--aot")).toEqual(plain);
}

test("a walk over require.cache by a prefix, then import() of a package, runs it again", async () => {
  await expectCompiledToRunAsPlain({
    ...pkg,
    "one.test.ts": `
      import { beforeAll, test } from "bun:test";
      import { dirname, sep } from "node:path";
      import { canUse } from "pkg";
      let reloaded: any;
      beforeAll(async () => {
        (globalThis as any).window = {};
        const dir = dirname(require.resolve("pkg")) + sep;
        for (const key of Object.keys(require.cache)) if (key.startsWith(dir)) delete require.cache[key];
        reloaded = await import("pkg/client");
      });
      test("again", () => { console.log(canUse, reloaded.canUse, reloaded.runs); });`,
  });
});

test("delete require.cache[require.resolve(x)], then require() runs a file again, each time", async () => {
  await expectCompiledToRunAsPlain({
    "counter.js": `globalThis.count = (globalThis.count ?? 0) + 1;\nmodule.exports = globalThis.count;`,
    "one.test.ts": `
      import { test } from "bun:test";
      test("counts", () => {
        const before = require("./counter.js");
        const same = require("./counter.js");
        delete require.cache[require.resolve("./counter.js")];
        const again = require("./counter.js");
        const stillAgain = require("./counter.js");
        delete require.cache[require.resolve("./counter.js")];
        console.log(before, same, again, stillAgain, require("./counter.js"));
      });`,
  });
});

test("an ES module that reads a global at load runs again for import() and require(), and its first importer keeps its value", async () => {
  await expectCompiledToRunAsPlain({
    "reader.ts": `export const seen = (globalThis as any).marker ?? "none";`,
    "user.ts": `import { seen } from "./reader";\nexport const first = seen;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { first } from "./user";
      test("reader", async () => {
        (globalThis as any).marker = "set";
        delete require.cache[require.resolve("./reader")];
        const again = await import("./reader");
        console.log(first, again.seen);
        (globalThis as any).marker = "set again";
        delete require.cache[require.resolve("./reader")];
        const required = require("./reader");
        console.log(first, again.seen, required.seen, required === require("./reader"));
      });`,
  });
});

test("an ES module that is required by a path in a variable runs again", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": `export let count = 0;\nexport function bump() { return ++count; }`,
    "one.test.js": `
      import { test } from "bun:test";
      const outer = require.resolve("./state.js");
      test("in a variable of the function", () => {
        const path = require.resolve("./state.js");
        const first = require(path);
        first.bump();
        delete require.cache[path];
        const second = require(path);
        console.log(second === first, first.count, second.count);
        delete require.cache[path];
        console.log(require(path) === second, require("./state.js") === require(path));
      });
      test("in a variable of the module, from a closure", () => {
        const load = () => require(outer);
        const first = load();
        first.bump();
        delete require.cache[outer];
        const second = load();
        console.log(second === first, first.count, second.count);
      });`,
  });
});

test("an ES module that the test file imports as well runs again for a path in a variable", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": `export let count = 0;\nexport function bump() { return ++count; }`,
    "one.test.js": `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      test("imported too", () => {
        const path = require.resolve("./state.js");
        bump();
        const first = require(path);
        delete require.cache[path];
        const second = require(path);
        bump();
        console.log(first.count, second.count, second === first);
      });`,
  });
});

test("an ES module runs again in a worker of --parallel", async () => {
  await expectCompiledToRunAsPlain(
    {
      "state.js": `export let count = 0;\nexport function bump() { return ++count; }`,
      "one.test.ts": `
        import { test } from "bun:test";
        test("again", () => {
          const path = require.resolve("./state.js");
          const first = require("./state.js");
          first.bump();
          delete require.cache[path];
          const second = require("./state.js");
          console.log(second === first, first.count, second.count);
        });`,
      "two.test.ts": `
        import { test } from "bun:test";
        test("nothing", () => {});`,
    },
    "--parallel=2",
  );
});

for (const [run, more] of Object.entries({
  "every import() has a known name": {},
  "an import() has a name that nobody knows": {
    "unrelated.js": `export const unrelated = 1;`,
    "unknown-name.test.js": `
      import { test } from "bun:test";
      test("unknown", async () => { await import("./unrelated.js?t=" + Date.now()); });`,
  },
})) {
  test(`a module that is loaded behind an eviction imports the new instance: ${run}`, async () => {
    const head = `
    import { test } from "bun:test";
    import * as state from "./state.js";
    const path = require.resolve("./state.js");`;
    await expectCompiledToRunAsPlain(
      {
        "package.json": `{ "type": "module" }`,
        "state.js": `export let count = 0;\nexport const bump = () => ++count;`,
        "late.js": `import { bump, count } from "./state.js";\nexport const seenWhenLoaded = count;\nexport const next = () => bump();`,
        "later.js": `import { next, seenWhenLoaded } from "./late.js";\nexport const through = () => [seenWhenLoaded, next()];`,
        "imported.test.js": `${head}
        test("imported", async () => {
          state.bump(); state.bump(); delete require.cache[path];
          const late = await import("./late.js");
          console.log(late.seenWhenLoaded, late.next(), state.count);
        });`,
        "required.test.js": `${head}
        test("required", () => {
          state.bump(); state.bump(); delete require.cache[path];
          const late = require("./late.js");
          console.log(late.seenWhenLoaded, late.next(), state.count);
        });`,
        "two-down.test.js": `${head}
        test("two modules down", async () => {
          state.bump(); state.bump(); delete require.cache[path];
          console.log((await import("./later.js")).through(), state.count);
        });`,
        "anew-first.test.js": `${head}
        test("required anew first", async () => {
          state.bump(); state.bump(); delete require.cache[path];
          const anew = require(path);
          const late = await import("./late.js");
          console.log(late.seenWhenLoaded, late.next(), state.count, anew.count);
        });`,
        "twice.test.js": `${head}
        test("evicted twice", async () => {
          state.bump(); delete require.cache[path];
          require(path).bump(); delete require.cache[path];
          const late = await import("./late.js");
          console.log(late.seenWhenLoaded, late.next(), state.count);
        });`,
        "loaded-before.test.js": `${head}
        test("an importer that has run keeps its instance", async () => {
          const late = await import("./late.js");
          state.bump(); delete require.cache[path];
          console.log((await import("./late.js")) === late, late.next(), state.count);
        });`,
        ...more,
      },
      "--isolate",
    );
  });
}

test("a test file that imports what an earlier test file has taken out still runs", async () => {
  await expectCompiledToRunAsPlain({
    "package.json": `{ "type": "module" }`,
    "state.js": `export let count = 0;\nexport const bump = () => ++count;`,
    "a.test.js": `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      test("takes it out", () => { bump(); delete require.cache[require.resolve("./state.js")]; });`,
    "b.test.js": `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      test("runs", () => { console.log(typeof bump); });`,
  });
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

const readsEveryEntry = {
  "es.ts": `export const value = 1;`,
  "common.cjs": `exports.value = 2;`,
  "worker.ts": `
    import { value } from "./es";
    const common = require("./common.cjs");
    const kinds = Reflect.ownKeys(require.cache).map(key => typeof Reflect.get(require.cache, key));
    postMessage([value, common.value, [...new Set(kinds)]]);`,
  "one.test.ts": `
    import { test } from "bun:test";
    import { createRequire } from "node:module";
    import { value } from "./es";
    const made = createRequire(import.meta.url);
    const own = (key: PropertyKey) => /(es\\.ts|common\\.cjs|one\\.test\\.ts)$/.test(String(key));
    test("entries", () => {
      const common = require("./common.cjs");
      for (const cache of [require.cache, made.cache]) {
        const keys = Reflect.ownKeys(cache);
        console.log(keys.filter(own).map(key => String(key).replace(/.*[\\\\/]/, "")).sort(), [...new Set(keys.map(key => typeof Reflect.get(cache, key)))]);
        console.log(value, Object.keys(cache[require.resolve("./es")]!.exports), cache[require.resolve("./common.cjs")]!.exports === common);
        console.log(require.resolve("./es") in cache, Object.getOwnPropertyDescriptor(cache, require.resolve("./common.cjs"))?.enumerable);
      }
    });
    test("in a worker", async () => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      console.log(await new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
      worker.terminate();
    });`,
};

test("every entry of require.cache can be read, here and in a Worker", async () => {
  await expectCompiledToRunAsPlain(readsEveryEntry);
});

test("every entry of require.cache can be read under --isolate", async () => {
  await expectCompiledToRunAsPlain(readsEveryEntry, "--isolate");
});

test("modules with nothing to run are listed once their importer has run", async () => {
  await expectCompiledToRunAsPlain({
    "constant.ts": `export const value = 1;`,
    "function.ts": `export function three() { return 3; }`,
    "through.ts": `export { three } from "./function";\nexport * from "./constant";`,
    "never.ts": `export const unused = 4;`,
    "later.ts": `export const late = 5;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { three, value } from "./through";
      const own = () => Reflect.ownKeys(require.cache).map(key => String(key).replace(/.*[\\\\/]/, "")).filter(key => /^(constant|function|through|never|later)\\.ts$/.test(key)).sort();
      test("entries", async () => {
        console.log(own(), value, three());
        console.log(Object.keys(require.cache[require.resolve("./function")]!.exports), Object.keys(require.cache[require.resolve("./through")]!.exports).sort());
        console.log(require.resolve("./never") in require.cache, require.resolve("./later") in require.cache);
        console.log((await import("./later")).late, own());
        delete require.cache[require.resolve("./constant")];
        console.log(own());
      });`,
  });
});

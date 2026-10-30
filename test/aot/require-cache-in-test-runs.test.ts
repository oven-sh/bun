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

// Code that imports a file is compiled for a file that loads once, unless the build sees the file taken out. What the build cannot see fails, and says so.
test("a file that only code from disk takes out stays, and the delete throws", async () => {
  using dir = tempDir("require-cache-in-test-runs", {
    "state.ts": `export let count = 0;\nexport function bump() { return ++count; }`,
    "never-loaded.ts": `export const unused = 1;`,
    "one.test.ts": `
      import { expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { bump } from "./state";
      test("refused", async () => {
        const written = join(import.meta.dir, "written-" + process.pid + ".cjs");
        writeFileSync(written, "module.exports = path => delete require.cache[path];");
        const takeOut = require(written);
        bump();
        let message = "";
        try { takeOut(require.resolve("./state")); } catch (error) { message = (error as Error).message; }
        console.log(message.replaceAll(import.meta.dir, "").replaceAll("\\\\", "/"));
        console.log(bump(), (await import("./state")).count);
        console.log(takeOut(require.resolve("./never-loaded")), takeOut(written), takeOut("/nowhere.js"));
      });`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect({ stdout: stdout.split("\n").slice(1), stderr: exitCode ? stderr : "", exitCode }).toEqual({
    stdout: [
      `Cannot take '/state.ts' out of require.cache: the build found nothing that does, so the code that imports it was compiled for a module that loads once. Spell the path where it is deleted, in a file that the tests import: delete require.cache[require.resolve("./module")]`,
      "2 2",
      "true true true",
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});

test("the key of a delete may come by a name, a helper or a path that is put together", async () => {
  await expectCompiledToRunAsPlain({
    "a.cjs": `globalThis.a = (globalThis.a ?? 0) + 1;\nmodule.exports = globalThis.a;`,
    "b.cjs": `globalThis.b = (globalThis.b ?? 0) + 1;\nmodule.exports = globalThis.b;`,
    "c.cjs": `globalThis.c = (globalThis.c ?? 0) + 1;\nmodule.exports = globalThis.c;`,
    "kept.cjs": `globalThis.kept = (globalThis.kept ?? 0) + 1;\nmodule.exports = globalThis.kept;`,
    "fresh.ts": `export function fresh(name: string) { delete require.cache[require.resolve(name)]; return require(name); }`,
    "named.test.ts": `
      import { test } from "bun:test";
      test("a name", () => {
        const first = require.resolve("./a.cjs");
        const key = first;
        console.log(require("./a.cjs"), require("./kept.cjs"));
        delete require.cache[key as string];
        console.log(require("./a.cjs"), require("./kept.cjs"));
      });`,
    "helper.test.ts": `
      import { test } from "bun:test";
      import { join } from "node:path";
      import { fresh } from "./fresh";
      test("a helper", () => { console.log(require("./b.cjs"), fresh(join(import.meta.dir, "b.cjs")), fresh(join(import.meta.dir, "b.cjs"))); });
      test("a path", () => {
        console.log(require("./c.cjs"));
        delete require.cache[join(import.meta.dir, "c" + ".cjs")];
        console.log(require("./c.cjs"));
      });`,
  });
});

// The image of a test file and the layer that it shares with the others may both hold a file. The copy that has run is the one to take out.
test("a file that a layer below holds too is taken out of require.cache", async () => {
  using dir = tempDir("require-cache-in-test-runs", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "helpers/evicted.js": `export let count = 0;\nexport const bump = () => ++count;`,
    "helpers/imports-evicted.js": `import { bump, count } from "./evicted.js";\nexport const seenWhenLoaded = count;\nexport const next = () => bump();`,
    "evicts.test.js": `
      import { test } from "bun:test";
      test("evicts", async () => {
        const path = require.resolve("./helpers/evicted.js");
        const first = require(path); first.bump(); first.bump();
        delete require.cache[path];
        const second = require(path);
        console.log(first.count, second.count, first === second);
        const late = await import("./helpers/imports-evicted.js");
        console.log(late.seenWhenLoaded, late.next(), first.count, second.count);
      });`,
    // Puts helpers/evicted.js into the layer that the test files share.
    "imports.test.js": `import { test } from "bun:test";\nimport "./helpers/imports-evicted.js";\ntest("imports", () => {});`,
    "third.test.js": `import { test } from "bun:test";\ntest("third", () => {});`,
  });
  const seen = async (words?: string, ...flags: string[]) => {
    const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    return { stdout, exitCode };
  };
  const plain = await seen();
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("2 0 false");
  for (const words of [undefined, "TestRunLayers:2,TestRunPartFiles:1", "TestRunLayers:1,TestRunPartFiles:1"])
    expect(await seen(words, "--aot")).toEqual(plain);
});

// The stage log says why every file of a run may load again, so that nobody has to guess what keeps a large run open.
test("a file that is loaded under a query: every file may load again, and only that file where the host runs the test files", async () => {
  using dir = tempDir("require-cache-in-test-runs", {
    "src/base.js": `export const base = "base";`,
    "src/state.js": `import { base } from "./base.js";\nexport let count = 0;\nexport function bump() { return ++count; }\nexport const from = base;`,
    "src/other.js": `export function other(n) { return n * 2; }`,
    "helper.js": "let n = 0;\nexport async function fresh() { return import(`./src/state.js?fresh=${n++}`); }",
    "one.test.js": `
      import { test } from "bun:test";
      import { fresh } from "./helper.js";
      import { other } from "./src/other.js";
      import { bump } from "./src/state.js";
      test("fresh", async () => {
        bump();
        const [first, second] = [await fresh(), await fresh()];
        console.log(bump(), first.bump(), second.bump(), first.from, other(2), first === second);
      });`,
  });
  const test = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    const why = [...stderr.matchAll(/^AOT test run \| every file may load again: (?:.*[\\/])?(.*)$/gm)].map(
      match => match[1],
    );
    return { printed: stdout.split("\n")[1], why: [...new Set(why)].sort(), exitCode };
  };
  const printed = "2 1 1 base 4 false";
  const logs = { BUN_JSC_logAOTPhaseTimes: "1" };
  expect(await test({})).toEqual({ printed, why: [], exitCode: 0 });
  expect(await test(logs, "--aot")).toEqual({
    printed,
    why: ["helper.js loads a file under a query", "the scan of the test files says so"],
    exitCode: 0,
  });
  const hostRunsTestFiles = { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };
  expect(await test({ ...logs, ...hostRunsTestFiles }, "--aot")).toEqual({ printed, why: [], exitCode: 0 });
});

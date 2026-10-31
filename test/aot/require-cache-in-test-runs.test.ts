import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
setDefaultTimeout(120_000);

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

const dataFiles = {
  "d.json": `{ "a": 1, "list": [1, 2] }`,
  "d.jsonc": `// a comment\n{ "a": 2, "list": [1, 2], }`,
  "d.json5": `{ a: 3, list: [1, 2], }`,
  "d.toml": `a = 4\nlist = [1, 2]`,
  "d.yaml": `a: 5\nlist:\n  - 1\n  - 2`,
  "d.txt": `some text`,
};

test("a data file taken out of require.cache is read again", async () => {
  await expectCompiledToRunAsPlain({
    ...dataFiles,
    "one.test.js": `
      import { test } from "bun:test";
      import { readFileSync, writeFileSync } from "node:fs";
      function say(first, second, third) {
        first.a = "changed";
        console.log(JSON.stringify(first), JSON.stringify(second), first === second, second === third);
      }
      test("json", () => { const a = require("./d.json"); delete require.cache[require.resolve("./d.json")]; say(a, require("./d.json"), require("./d.json")); });
      test("jsonc", () => { const a = require("./d.jsonc"); delete require.cache[require.resolve("./d.jsonc")]; say(a, require("./d.jsonc"), require("./d.jsonc")); });
      test("json5", () => { const a = require("./d.json5"); delete require.cache[require.resolve("./d.json5")]; say(a, require("./d.json5"), require("./d.json5")); });
      test("toml", () => { const a = require("./d.toml"); delete require.cache[require.resolve("./d.toml")]; say(a, require("./d.toml"), require("./d.toml")); });
      test("yaml", () => { const a = require("./d.yaml"); delete require.cache[require.resolve("./d.yaml")]; say(a, require("./d.yaml"), require("./d.yaml")); });
      test("text", () => {
        const a = require("./d.txt");
        delete require.cache[require.resolve("./d.txt")];
        const b = require("./d.txt");
        console.log(a.default, b.default, a === b, b === require("./d.txt"));
      });
      test("written again in between", () => {
        const path = require.resolve("./d.json");
        const text = readFileSync(path, "utf8");
        const a = require("./d.json");
        try {
          writeFileSync(path, JSON.stringify({ a: 100, more: true }));
          const same = require("./d.json");
          delete require.cache[path];
          const b = require("./d.json");
          console.log(a.a, same === a, b.a, b.more, Object.keys(b).join());
        } finally {
          writeFileSync(path, text);
        }
      });`,
  });
});

test("a data file taken out of require.cache under a key that nobody spells holds what the file holds", async () => {
  await expectCompiledToRunAsPlain({
    ...dataFiles,
    "one.test.js": `
      import { test } from "bun:test";
      const outer = require.resolve("./d.toml");
      test("a key in a variable of the module", () => {
        const a = require("./d.toml");
        delete require.cache[outer];
        const b = require(outer);
        console.log(a.a, b.a, a === b, b === require("./d.toml"));
      });
      test("a walk over the keys", () => {
        const a = require("./d.yaml");
        for (const key of Object.keys(require.cache)) if (key.endsWith(".yaml")) delete require.cache[key];
        const b = require("./d.yaml");
        console.log(a.a, b.a, a === b);
      });
      test("Reflect.deleteProperty", () => {
        const a = require("./d.jsonc");
        Reflect.deleteProperty(require.cache, require.resolve("./d.jsonc"));
        const b = require("./d.jsonc");
        console.log(a.a, b.a, a === b);
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

const listsFilesOfSrc = `const listed = () => Object.keys(require.cache).filter(key => /[\\\\/]src[\\\\/]/.test(key)).map(key => key.replace(/.*[\\\\/]/, "")).sort().join();`;

const filesToRequire = {
  "src/constant.ts": `export const value = 7;`,
  "src/empty.ts": `export {};`,
  "src/functions.ts": `export function three() { return 3; }\nexport class Thing {}`,
  "src/counts.ts": `const realm = globalThis as any;\nrealm.counted = (realm.counted ?? 0) + 1;\nexport const value = realm.counted;`,
  "src/imports-constant.ts": `import { below } from "./constant-below";\nexport const value = below + 1;`,
  "src/constant-below.ts": `export const below = 1;`,
  "src/never.ts": `export const value = 9;`,
};

test("an ES module is listed once a require() in a function has loaded it, and not before", async () => {
  await expectCompiledToRunAsPlain({
    ...filesToRequire,
    "one.test.ts": `
      import { test } from "bun:test";
      ${listsFilesOfSrc}
      test("one by one", () => {
        console.log(listed());
        for (const load of [
          () => require("./src/constant"),
          () => require("./src/empty"),
          () => require("./src/functions"),
          () => require("./src/counts"),
          () => require("./src/imports-constant"),
          () => (globalThis as any).neverSet && require("./src/never"),
        ]) {
          load();
          console.log(listed());
        }
      });
      test("by its key", () => {
        const path = require.resolve("./src/constant");
        console.log(require.cache[path] !== undefined, path in require.cache, require.cache[path]?.exports === require("./src/constant"));
        console.log(require.cache[require.resolve("./src/never")], require.resolve("./src/never") in require.cache);
      });`,
  });
});

test("a test of lazy loading sees the file that the first use requires", async () => {
  const files = {
    "src/feature.ts": `export function use() { return require("./heavy").big; }`,
    "src/heavy.ts": `export const big = 1;`,
  };
  await expectCompiledToRunAsPlain({
    ...files,
    "one.test.ts": `
      import { test } from "bun:test";
      import { use } from "./src/feature";
      const isLoaded = () => Object.keys(require.cache).some(key => key.endsWith("heavy.ts"));
      test("loaded by its first use", () => { console.log(isLoaded(), use(), isLoaded()); });`,
  });
  await expectCompiledToRunAsPlain({
    ...files,
    "one.test.ts": `
      import { test } from "bun:test";
      import { use } from "./src/feature";
      use();
      test("used too early", () => { console.log(Object.keys(require.cache).some(key => key.endsWith("heavy.ts"))); });`,
  });
});

test("an ES module that a file requires at its top level is listed", async () => {
  await expectCompiledToRunAsPlain({
    ...filesToRequire,
    "src/requires-at-top.ts": `const inner = require("./required-at-top");\nexport const value = inner.value + 1;`,
    "src/required-at-top.ts": `export const value = 1;`,
    "src/commonjs-requires.cjs": `exports.value = require("./under-commonjs.ts").value;`,
    "src/under-commonjs.ts": `export const value = 2;`,
    "one.test.ts": `
      import { test } from "bun:test";
      ${listsFilesOfSrc}
      const constant = require("./src/constant");
      const behindFirst = listed();
      const counts = require("./src/counts");
      require("./src/empty");
      require("./src/imports-constant");
      require("./src/constant");
      const behindAll = listed();
      test("at the top of the test file", () => {
        console.log(behindFirst);
        console.log(behindAll);
        console.log(listed());
        console.log(require.cache[require.resolve("./src/constant")]?.exports === constant, require.cache[require.resolve("./src/counts")]?.exports === counts);
      });
      test("at the top of a file that is required", () => {
        console.log(require("./src/requires-at-top").value, listed());
        console.log(require("./src/commonjs-requires.cjs").value, listed());
      });`,
  });
});

test("a file is listed as soon as it has run, while the file that imports or requires it is still running", async () => {
  await expectCompiledToRunAsPlain({
    ...filesToRequire,
    "src/reads-at-top.ts": `
      import { below } from "./constant-below";
      import { three } from "./functions";
      import { value } from "./counts";
      ${listsFilesOfSrc}
      export const atTop = [listed(), below, three(), value].join(" ");`,
    "src/requires-and-reads.ts": `
      ${listsFilesOfSrc}
      const others = () => listed().split(",").filter(name => name !== "requires-and-reads.ts").join();
      const before = others();
      require("./imports-constant");
      const between = others();
      require("./empty");
      export const seen = [before, between, others()].join(" | ");`,
    "imports.test.ts": `
      import { test } from "bun:test";
      import { atTop } from "./src/reads-at-top";
      import { value } from "./src/constant";
      ${listsFilesOfSrc}
      const here = listed();
      test("behind the imports", () => { console.log(atTop); console.log(here, value); });`,
    "imports-nothing-to-run.test.ts": `
      import { test } from "bun:test";
      import { value } from "./src/constant";
      import { three } from "./src/functions";
      ${listsFilesOfSrc}
      const here = listed();
      test("behind the imports", () => { console.log(here, value, three()); });`,
    "loads-later.test.ts": `
      import { test } from "bun:test";
      ${listsFilesOfSrc}
      test("import()", async () => { console.log((await import("./src/reads-at-top")).atTop); console.log(listed()); });
      test("require()", () => { console.log(require("./src/requires-and-reads").seen); console.log(listed()); });`,
  });
});

const looksAtFiles = {
  "src/look.cjs": `
    exports.look = function look(path) {
      const name = path.replace(/.*[\\\\/]/, "");
      const entry = require.cache[path];
      const listed = [Object.keys(require.cache).includes(path), path in require.cache].join();
      if (!entry) return [name, listed, entry].join(" ");
      let names;
      try { names = Object.keys(entry.exports).join("+"); } catch (error) { names = error.name; }
      return [name, listed, "exports", "[" + names + "]", require.cache[path] === entry].join(" ");
    };`,
};
const commonJSFileThatLooksAtItself = `
  const { look } = require("./look.cjs");
  exports.early = 1;
  exports.seen = [look(__filename), require.cache[__filename] === module, require.cache[__filename]?.exports === exports].join(" ");
  exports.later = () => [look(__filename), require.cache[__filename] === module].join(" ");`;
const moduleThatLooksAtItself = (name: string) => `
  import { look } from "./look.cjs";
  export const early = 1;
  const whileItRan = require.cache[require.resolve("./${name}")];
  export const seen = look(require.resolve("./${name}"));
  export const later = () => [look(require.resolve("./${name}")), whileItRan === undefined || whileItRan === require.cache[require.resolve("./${name}")]].join(" ");`;

async function expectCompiledToRunAsPlainInLayersToo(files: Record<string, string>) {
  using dir = tempDir("require-cache-in-test-runs", files);
  const seen = async (words?: string, ...flags: string[]) => {
    const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    return { stdout, exitCode };
  };
  const plain = await seen();
  expect(plain.exitCode).toBe(0);
  for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])
    expect(await seen(words, "--aot")).toEqual(plain);
}

test("a CommonJS file finds its own module in require.cache while it runs, whoever has begun it", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/in-function.cjs": commonJSFileThatLooksAtItself,
    "src/at-top.cjs": commonJSFileThatLooksAtItself,
    "src/imported.cjs": commonJSFileThatLooksAtItself,
    "src/imported-below.cjs": commonJSFileThatLooksAtItself,
    "src/imported-late.cjs": commonJSFileThatLooksAtItself,
    "src/under-module.cjs": commonJSFileThatLooksAtItself,
    "src/imports-file.ts": `import file from "./imported-below.cjs";\nexport const seen = file.seen;`,
    "src/requires-file.ts": `export const seen = require("./under-module.cjs").seen;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import imported from "./src/imported.cjs";
      import { seen as below } from "./src/imports-file";
      const atTop = require("./src/at-top.cjs");
      test("each way to begin it", async () => {
        const inFunction = require("./src/in-function.cjs");
        console.log(inFunction.seen);
        console.log(inFunction.later());
        console.log(atTop.seen);
        console.log(imported.seen);
        console.log(imported.later());
        console.log(below);
        console.log((await import("./src/imported-late.cjs")).default.seen);
        console.log(require("./src/requires-file").seen);
      });`,
  });
});

test("an ES module is listed while it runs if a require() has begun it, and not if an import has", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/in-function.ts": moduleThatLooksAtItself("in-function.ts"),
    "src/at-top.ts": moduleThatLooksAtItself("at-top.ts"),
    "src/imported.ts": moduleThatLooksAtItself("imported.ts"),
    "src/imported-late.ts": moduleThatLooksAtItself("imported-late.ts"),
    "src/under-file.ts": moduleThatLooksAtItself("under-file.ts"),
    "src/under-module.ts": moduleThatLooksAtItself("under-module.ts"),
    "src/file-requires.cjs": `exports.seen = require("./under-file.ts").seen;`,
    "src/module-requires.ts": `const inner = require("./under-module.ts");\nexport const seen = inner.seen;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { seen as imported, later as importedLater } from "./src/imported";
      const atTop = require("./src/at-top");
      test("each way to begin it", async () => {
        const inFunction = require("./src/in-function");
        console.log(inFunction.seen);
        console.log(inFunction.later());
        console.log(atTop.seen);
        console.log(atTop.later());
        console.log(imported);
        console.log(importedLater());
        console.log((await import("./src/imported-late")).seen);
        console.log(require("./src/file-requires.cjs").seen);
        console.log(require("./src/module-requires").seen);
      });`,
  });
});

test("what a required ES module imports sees that module listed, and not itself", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/root.ts": `import { seen as below } from "./below-root";\nexport const seen = below;`,
    "src/below-root.ts": `import { look } from "./look.cjs";\nexport const seen = [look(require.resolve("./below-root")), look(require.resolve("./root"))].join(" | ");`,
    "src/root-with-nothing-to-run.ts": `export { seen } from "./below-nothing";\nexport const constant = 1;`,
    "src/below-nothing.ts": `import { look } from "./look.cjs";\nexport const seen = look(require.resolve("./root-with-nothing-to-run"));`,
    "one.test.ts": `
      import { test } from "bun:test";
      test("below a require()", () => {
        console.log(require("./src/root").seen);
        console.log(require("./src/root-with-nothing-to-run").seen);
      });`,
  });
});

test("files that require each other are all listed while the innermost runs", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/outer.ts": `const inner = require("./inner");\nexport const seen = inner.seen;`,
    "src/inner.ts": `import { look } from "./look.cjs";\nexport const seen = [look(require.resolve("./outer")), look(require.resolve("./inner"))].join(" | ");`,
    "src/outer.cjs": `exports.before = 1;\nexports.seen = require("./inner.cjs").seen;`,
    "src/inner.cjs": `const { look } = require("./look.cjs");\nexports.seen = [look(require.resolve("./outer.cjs")), look(__filename)].join(" | ");`,
    "src/ring-first.ts": `const second = require("./ring-second");\nexport const first = 1;\nexport const seen = second.seen;`,
    "src/ring-second.ts": `
      import { look } from "./look.cjs";
      const first = require("./ring-first");
      export const seen = [Object.keys(first).join("+"), require.cache[require.resolve("./ring-first")].exports === first, look(require.resolve("./ring-first"))].join(" ");`,
    "src/ring-first.cjs": `exports.first = 1;\nexports.seen = require("./ring-second.cjs").seen;`,
    "src/ring-second.cjs": `
      const { look } = require("./look.cjs");
      const first = require("./ring-first.cjs");
      exports.seen = [Object.keys(first).join("+"), require.cache[require.resolve("./ring-first.cjs")].exports === first, look(require.resolve("./ring-first.cjs"))].join(" ");`,
    "one.test.ts": `
      import { test } from "bun:test";
      test("one below the other", () => {
        console.log(require("./src/outer").seen);
        console.log(require("./src/outer.cjs").seen);
      });
      test("in a ring", () => {
        console.log(require("./src/ring-first").seen);
        console.log(require("./src/ring-first.cjs").seen);
      });`,
  });
});

test("an ES module that an import has begun is listed from the first require() of it", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/importer.ts": `
      import { seen as below } from "./requires-importer";
      import { look } from "./look.cjs";
      export const value = 1;
      export const seen = [below, look(require.resolve("./importer"))].join(" | ");`,
    "src/requires-importer.ts": `
      import { look } from "./look.cjs";
      const before = look(require.resolve("./importer"));
      require("./importer");
      export const seen = [before, look(require.resolve("./importer"))].join(" | ");`,
    "statement.test.ts": `
      import { test } from "bun:test";
      import { seen } from "./src/importer";
      test("an import statement", () => { console.log(seen); });`,
    "call.test.ts": `
      import { test } from "bun:test";
      test("import()", async () => { console.log((await import("./src/importer")).seen); });`,
  });
});

test("a file that throws while it is required was listed until then, and is not afterwards", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/throws.cjs": `globalThis.seenByFile = require("./look.cjs").look(__filename);\nthrow new Error("from the file");`,
    "src/throws.ts": `
      import { look } from "./look.cjs";
      (globalThis as any).seenByModule = look(require.resolve("./throws.ts"));
      throw new Error("from the module");
      export {};`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { look } from "./src/look.cjs";
      const message = (load: () => void) => { try { load(); return "no error"; } catch (error) { return error.message; } };
      test("a CommonJS file", () => {
        console.log(message(() => require("./src/throws.cjs")), "|", (globalThis as any).seenByFile, "|", look(require.resolve("./src/throws.cjs")));
      });
      test("an ES module", () => {
        for (const turn of [1, 2])
          console.log(turn, message(() => require("./src/throws.ts")), "|", (globalThis as any).seenByModule, "|", look(require.resolve("./src/throws.ts")));
      });`,
  });
});

test("a file that takes itself out of require.cache while it runs: a CommonJS file runs again, an ES module does not", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/file.cjs": `
      const { look } = require("./look.cjs");
      globalThis.runsOfFile = (globalThis.runsOfFile ?? 0) + 1;
      const before = look(__filename);
      delete require.cache[__filename];
      exports.seen = [globalThis.runsOfFile, before, look(__filename)].join(" | ");`,
    "src/module.ts": `
      import { look } from "./look.cjs";
      const realm = globalThis as any;
      realm.runsOfModule = (realm.runsOfModule ?? 0) + 1;
      const path = require.resolve("./module.ts");
      const before = look(path);
      delete require.cache[path];
      export const seen = [realm.runsOfModule, before, look(path)].join(" | ");`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { look } from "./src/look.cjs";
      test("a CommonJS file", () => {
        for (const turn of [1, 2]) console.log(turn, require("./src/file.cjs").seen, "|", look(require.resolve("./src/file.cjs")));
      });
      test("an ES module", () => {
        for (const turn of [1, 2]) console.log(turn, require("./src/module.ts").seen, "|", look(require.resolve("./src/module.ts")));
      });`,
  });
});

test("an ES module whose import fails behind a require() of it that has returned stays listed, and require() answers", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/fails.ts": `import "./requires-what-fails";\nthrow new Error("fails");\nexport const value = 1;`,
    "src/requires-what-fails.ts": `require("./fails");\nexport const below = 1;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { look } from "./src/look.cjs";
      test("import(), then require()", async () => {
        console.log(await import("./src/fails").then(() => "no error", error => error.message), "|", look(require.resolve("./src/fails")));
        let message = "no error";
        try { require("./src/fails"); } catch (error) { message = error.message; }
        console.log(message, "|", look(require.resolve("./src/fails")));
      });`,
  });
});

test("code at the top level of a test file takes a file out of require.cache", async () => {
  const born = (name: string) =>
    `const births = (globalThis.births ??= {});\nconst me = "${name}#" + (births.${name} = (births.${name} ?? 0) + 1);\nlet calls = 0;\n`;
  const head = `
      import { test } from "bun:test";
      import * as user from "./user.js";
      import * as lazy from "./lazy.js";
      const isListed = () => require.resolve("./state.js") in require.cache;`;
  await expectCompiledToRunAsPlain(
    {
      "state.js": `${born("state")}export function bump() { return me + ":" + ++calls; }`,
      "user.js": `import { bump } from "./state.js";\n${born("user")}export function viaUser() { return me + " > " + bump(); }`,
      "lazy.js": `${born("lazy")}export async function viaLazy() { return me + " > " + (await import("./state.js")).bump(); }`,
      "behind-an-await.test.js": `${head}
      console.log(isListed(), user.viaUser(), await lazy.viaLazy());
      delete require.cache[require.resolve("./state.js")];
      console.log(isListed(), user.viaUser(), await lazy.viaLazy(), isListed());
      test("behind the top level", async () => console.log(user.viaUser(), await lazy.viaLazy()));`,
      "before-the-first-await.test.js": `${head}
      delete require.cache[require.resolve("./state.js")];
      console.log(isListed(), user.viaUser(), await lazy.viaLazy(), isListed());
      test("behind the top level", async () => console.log(user.viaUser(), await lazy.viaLazy()));`,
      "a-copy-under-a-query.test.js": `${head}
      delete require.cache[require.resolve("./state.js")];
      const copy = await import("./user.js?0");
      console.log(user.viaUser(), copy.viaUser(), await lazy.viaLazy());
      test("behind the top level", async () => console.log(user.viaUser(), copy.viaUser(), await lazy.viaLazy()));`,
    },
    "--isolate",
  );
});

test("require.cache lists files alone, and a loop over it takes all of them out", async () => {
  const born = (name: string) =>
    `const births = (globalThis.births ??= {});\nconst me = "${name}#" + (births.${name} = (births.${name} ?? 0) + 1);\nlet calls = 0;\n`;
  const head = `
      import { test } from "bun:test";
      const keys = () => Object.keys(require.cache).map(key => key.replace(/.*\\//, "")).sort().join(" ");
      const clear = () => { for (const key in require.cache) delete require.cache[key]; };`;
  await expectCompiledToRunAsPlain(
    {
      "state.js": `${born("state")}export function bump() { return me + ":" + ++calls; }`,
      "statec.cjs": `${born("statec")}exports.bump = function () { return me + ":" + ++calls; };`,
      "user.js": `import { bump } from "./state.js";\n${born("user")}export function viaUser() { return me + " > " + bump(); }`,
      "mixed.js": `import { bump } from "./statec.cjs";\n${born("mixed")}export function viaMixed() { return me + " > " + bump(); }`,
      "barrel.js": `export * from "./state.js";\nexport { bump as bumpC } from "./statec.cjs";\nexport { viaUser } from "./user.js";`,
      "an-importer-of-a-commonjs-file.test.js": `${head}
      import * as mixed from "./mixed.js";
      test("cleared twice", () => {
        console.log(keys());
        clear();
        console.log(keys(), mixed.viaMixed(), require("./mixed.js").viaMixed());
        console.log(keys());
        clear();
        console.log(keys());
      });`,
      "a-barrel-over-both-kinds.test.js": `${head}
      import * as barrel from "./barrel.js";
      test("cleared by its keys", () => {
        console.log(keys());
        Object.keys(require.cache).forEach(key => { delete require.cache[key]; });
        const again = require("./barrel.js");
        console.log(keys(), barrel.bumpC(), again.bumpC(), barrel.viaUser(), again.viaUser());
      });`,
    },
    "--isolate",
  );
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

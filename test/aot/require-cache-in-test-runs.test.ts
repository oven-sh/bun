import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// Each case builds and runs in a folder of its own. One after the other they take longer than CI gives a file on the lane with assertions,
// and at once they still take about that long there: so they are dealt out over four files, by the time that they take.
const test = oneAtATime.concurrent;

const pkg = {
  "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js", "exports": { ".": "./index.js", "./client": "./client.js" } }`,
  "node_modules/pkg/index.js": `module.exports = require("./inner.js");`,
  "node_modules/pkg/client.js": `const inner = require("./inner.js");\nexports.canUse = inner.canUse;\nexports.runs = inner.runs;`,
  "node_modules/pkg/inner.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.canUse = typeof window !== "undefined";\nexports.runs = globalThis.runs;`,
};

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

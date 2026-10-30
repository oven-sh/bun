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
  const test = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...always, ...flags], String(dir), bunEnv);
    if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
    return { stdout, passed: [...stderr.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]), exitCode };
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

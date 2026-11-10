import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

const isolationFlags: [string[]][] = [[[]], [["--isolate"]], [["--isolate=modules"]]];

// The assertions are inside the fixtures. `pass` makes sure every test in them actually ran.
async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("isolate-modules", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
  expect(exitCode).toBe(0);
}

// https://github.com/oven-sh/bun/issues/48139
// One child run at a time: beside one another they take longer than the time limit of a test where processors are few.
describe("jest.isolateModules()", () => {
  // Each evaluation of a module has a number of its own.
  const counted = {
    "counter.cjs": `globalThis.counters = (globalThis.counters ?? 0) + 1; module.exports = { count: 0, evaluation: globalThis.counters };`,
    "uses-counter.cjs": `exports.counter = require("./counter.cjs"); exports.lazy = () => require("./counter.cjs");`,
    "state.ts": `globalThis.states = (globalThis.states ?? 0) + 1; export const evaluation = globalThis.states; export const state = { count: 0 };`,
    "uses-state.ts": `import { state } from "./state"; export { state }; export const lazy = () => import("./state");`,
  };

  test.each(isolationFlags)("the callback loads into a registry of its own %j", async args => {
    await expectFixturesToPass(
      {
        ...counted,
        "first.cjs": `module.exports = { id: module.id, isMain: require.main === module, main: require.main };`,
        "isolate.test.ts": `
          import { beforeEach, describe, expect, jest, test } from "bun:test";
          import * as state from "./state";

          test("each call has a registry of its own", () => {
            let second;
            jest.isolateModules(() => { require("./counter.cjs").count++; });
            jest.isolateModules(() => { second = require("./counter.cjs"); });
            expect(second.count).toBe(0);
          });

          test("a module that is loaded is evaluated again inside, and is the same afterwards", () => {
            const counter = require("./counter.cjs");
            const user = require("./uses-counter.cjs");
            let inner;
            expect(jest.isolateModules(() => {
              inner = { counter: require("./counter.cjs"), user: require("./uses-counter.cjs"), state: require("./state"), user2: require("./uses-state") };
            })).toBe(jest);
            expect(inner.counter.evaluation).toBe(counter.evaluation + 1);
            expect(inner.user.counter).toBe(inner.counter);
            expect(inner.state.evaluation).toBe(state.evaluation + 1);
            expect(inner.user2.state).toBe(inner.state.state);

            expect(require("./counter.cjs")).toBe(counter);
            expect(require("./uses-counter.cjs")).toBe(user);
            expect(require("./state").state).toBe(state.state);
            expect([globalThis.counters, globalThis.states]).toEqual([counter.evaluation + 1, state.evaluation + 1]);
          });

          test("what the callback loaded loads from the test file's registry afterwards", async () => {
            const counter = require("./counter.cjs");
            let user, user2;
            jest.isolateModules(() => {
              user = require("./uses-counter.cjs");
              user2 = require("./uses-state");
            });
            expect(user.counter).not.toBe(counter);
            expect(user.lazy()).toBe(counter);
            expect((await user2.lazy()).state).toBe(state.state);
          });

          test("a module that the callback is the first to load is not loaded afterwards", () => {
            let inner;
            jest.isolateModules(() => { inner = require("./first.cjs"); });
            expect(require("./first.cjs")).not.toBe(inner);
          });

          test("require.cache inside", () => {
            const key = require.resolve("./counter.cjs");
            const counter = require("./counter.cjs");
            let inside;
            jest.isolateModules(() => {
              inside = [Object.keys(require.cache), require("./first.cjs").id, Object.keys(require.cache), require.cache[key]];
            });
            expect(inside).toEqual([[], require.resolve("./first.cjs"), [require.resolve("./first.cjs")], undefined]);
            expect(require.cache[key].exports).toBe(counter);
          });

          test("builtin modules are the same inside", () => {
            let inside;
            jest.isolateModules(() => { inside = [require("node:fs"), require("bun:test").jest]; });
            expect(inside[0]).toBe(require("node:fs"));
            expect(inside[1]).toBe(jest);
          });

          test("an error of the callback ends it", () => {
            const counter = require("./counter.cjs");
            expect(() => jest.isolateModules(() => { require("./counter.cjs"); throw new Error("from the callback"); })).toThrow("from the callback");
            expect(require("./counter.cjs")).toBe(counter);
            expect(jest.isolateModules(() => {})).toBe(jest);
          });

          describe("in a hook", () => {
            let ofHook;
            beforeEach(() => { jest.isolateModules(() => { ofHook = require("./counter.cjs"); }); });

            test("the test doesn't load what the hook loaded", () => {
              ofHook.count++;
              expect(require("./counter.cjs")).not.toBe(ofHook);
              expect(require("./counter.cjs").count).toBe(0);
            });
          });
        `,
        "main.test.cjs": `
          const { expect, jest, test } = require("bun:test");

          test("require.main and process.mainModule inside", () => {
            expect(require.main).toBe(module);
            let inside;
            jest.isolateModules(() => { inside = [require.main, process.mainModule, require("./first.cjs")]; });
            expect(inside[0]).toBe(module);
            expect(inside[1]).toBe(module);
            expect(inside[2].isMain).toBe(false);
            expect(inside[2].main).toBe(module);
            expect([require.main, process.mainModule]).toEqual([module, module]);
          });
        `,
      },
      9,
      args,
    );
  });

  test.each(isolationFlags)("jest.isolateModulesAsync() waits for its callback %j", async args => {
    await expectFixturesToPass(
      {
        ...counted,
        "async.test.ts": `
          import { beforeEach, describe, expect, jest, test } from "bun:test";
          import * as state from "./state";

          test("import() inside, and afterwards", async () => {
            let inner, user;
            const isolated = jest.isolateModulesAsync(async () => {
              inner = await import("./state");
              await Promise.resolve();
              user = await import("./uses-state");
              expect(require("./state")).toBe(inner);
            });
            expect(isolated).toBeInstanceOf(Promise);
            expect(await isolated).toBeUndefined();
            expect(inner.evaluation).toBe(state.evaluation + 1);
            expect(user.state).toBe(inner.state);
            expect((await import("./state")).state).toBe(state.state);
            expect((await user.lazy()).state).toBe(state.state);
          });

          test("a callback that rejects or throws", async () => {
            const counter = require("./counter.cjs");
            const gate = Promise.withResolvers();
            const isolated = jest.isolateModulesAsync(async () => {
              await gate.promise;
              throw new Error("rejected");
            });
            expect(require("./counter.cjs")).not.toBe(counter);
            gate.resolve();
            await expect(isolated).rejects.toThrow("rejected");
            expect(require("./counter.cjs")).toBe(counter);

            const thrown = jest.isolateModulesAsync(() => { throw new Error("thrown"); });
            expect(require("./counter.cjs")).toBe(counter);
            await expect(thrown).rejects.toThrow("thrown");
            expect(await jest.isolateModulesAsync(() => "not a promise")).toBeUndefined();
          });

          test("import() that the callback doesn't wait for loads into the test file's registry", async () => {
            const evaluations = globalThis.states;
            let imported;
            jest.isolateModules(() => { imported = import("./state"); });
            expect((await imported).state).toBe(state.state);
            await jest.isolateModulesAsync(async () => { imported = import("./state"); });
            expect((await imported).state).toBe(state.state);
            expect(globalThis.states).toBe(evaluations);
          });

          // With --isolate the text of a file that was loaded before comes without a wait, and an ES load makes a CommonJS file one turn before it looks for it.
          test("an import() of a CommonJS file that is in flight when a callback starts or ends", async () => {
            expect((await import("./uses-dep.mjs")).value).toBe("cjs");
            const turns = async count => { for (let i = 0; i < count; i++) await null; };
            const imported = [];
            for (let before = 0; before < 10; before++) {
              // Of the test file: the callback starts and ends beside the load.
              for (let during = 0; during < 10; during++) {
                jest.resetModules();
                const ofTestFile = import("./uses-dep.mjs");
                await turns(before);
                await jest.isolateModulesAsync(() => turns(during));
                imported.push((await ofTestFile).value);
              }
              // Of the callback, which doesn't wait for it.
              jest.resetModules();
              let ofCallback;
              await jest.isolateModulesAsync(() => {
                const ended = turns(before);
                ofCallback = import("./uses-dep.mjs");
                return ended;
              });
              imported.push((await ofCallback).value);
            }
            expect(imported).toEqual(Array(110).fill("cjs"));
          });

          describe("in a hook", () => {
            let ofHook;
            beforeEach(async () => { await jest.isolateModulesAsync(async () => { ofHook = await import("./state"); }); });

            test("the test doesn't load what the hook loaded", async () => {
              ofHook.state.count++;
              const loaded = await import("./state");
              expect(loaded).not.toBe(ofHook);
              expect(loaded.state.count).toBe(0);
            });
          });
        `,
        "dep.cjs": `module.exports = { value: "cjs" };`,
        "uses-dep.mjs": `import dep, { value } from "./dep.cjs"; export { dep, value };`,
      },
      5,
      args,
    );
  });

  test("a call inside another one, a value that is not a function, and jest.resetModules()", async () => {
    await expectFixturesToPass(
      {
        ...counted,
        "nested.test.ts": `
          import { expect, jest, test, vi } from "bun:test";
          const inSync = "isolateModules cannot be nested inside another isolateModules or isolateModulesAsync.";
          const inAsync = "isolateModulesAsync cannot be nested inside another isolateModulesAsync or isolateModules.";

          test("a call inside another one throws, or rejects", async () => {
            let nested;
            jest.isolateModules(() => {
              expect(() => jest.isolateModules(() => {})).toThrow(new Error(inSync));
              nested = jest.isolateModulesAsync(async () => {});
            });
            await expect(nested).rejects.toThrow(new Error(inAsync));
            await jest.isolateModulesAsync(async () => {
              expect(() => jest.isolateModules(() => {})).toThrow(new Error(inSync));
              await expect(jest.isolateModulesAsync(async () => {})).rejects.toThrow(new Error(inAsync));
            });
          });

          test("a value that is not a function", async () => {
            const counter = require("./counter.cjs");
            for (const value of [undefined, null, 1, "fn", {}]) {
              expect(() => jest.isolateModules(value)).toThrow(new TypeError("fn is not a function"));
              await expect(jest.isolateModulesAsync(value)).rejects.toThrow(new TypeError("fn is not a function"));
            }
            expect(require("./counter.cjs")).toBe(counter);
          });

          test.each(["jest", "vi"])("%s.resetModules() inside ends the callback's registry, and resets the test file's", api => {
            const counter = require("./counter.cjs");
            const evaluations = globalThis.counters;
            let inner, afterReset;
            jest.isolateModules(() => {
              inner = require("./counter.cjs");
              ({ jest, vi })[api].resetModules();
              afterReset = require("./counter.cjs");
              jest.isolateModules(() => expect(require("./counter.cjs").evaluation).toBe(evaluations + 3));
            });
            expect([inner.evaluation, afterReset.evaluation]).toEqual([evaluations + 1, evaluations + 2]);
            expect(require("./counter.cjs")).toBe(afterReset);
            expect(afterReset).not.toBe(counter);
          });

          test("jest.resetModules() ends a callback that never settles", async () => {
            const counter = require("./counter.cjs");
            jest.isolateModulesAsync(() => new Promise(() => {}));
            const inner = require("./counter.cjs");
            expect(inner).not.toBe(counter);
            expect(() => jest.isolateModules(() => {})).toThrow(inSync);
            jest.resetModules();
            jest.isolateModules(() => {});
            expect(require("./counter.cjs").evaluation).toBe(inner.evaluation + 1);
          });

          test("a callback that settles after jest.resetModules() ended its registry ends no other", async () => {
            const gate = Promise.withResolvers();
            const first = jest.isolateModulesAsync(() => gate.promise);
            jest.resetModules();
            const counter = require("./counter.cjs");
            let inner;
            await jest.isolateModulesAsync(async () => {
              gate.resolve();
              await first;
              inner = require("./counter.cjs");
            });
            expect(inner).not.toBe(counter);
            expect(require("./counter.cjs")).toBe(counter);
          });

          test("Bun.plugin.clearAll() inside leaves the callback its registry", () => {
            const counter = require("./counter.cjs");
            let inner;
            jest.isolateModules(() => {
              Bun.plugin.clearAll();
              inner = require("./counter.cjs");
            });
            expect(inner).not.toBe(counter);
            expect(require("./counter.cjs")).toBe(counter);
          });

          test("called by a bare name", async () => {
            const { isolateModules, isolateModulesAsync } = jest;
            const counter = require("./counter.cjs");
            let inner;
            expect((() => isolateModules(() => { inner = require("./counter.cjs"); }))()).toBeUndefined();
            expect(inner).not.toBe(counter);
            await isolateModulesAsync(async () => { inner = require("./counter.cjs"); });
            expect(inner).not.toBe(counter);
            expect([isolateModules.name, isolateModules.length, isolateModulesAsync.name, isolateModulesAsync.length]).toEqual(["isolateModules", 1, "isolateModulesAsync", 1]);
            expect("isolateModules" in vi).toBe(false);
          });
        `,
      },
      8,
    );
  });

  test.each(isolationFlags)("mocks inside and afterwards %j", async args => {
    await expectFixturesToPass(
      {
        "dep.cjs": `globalThis.deps = (globalThis.deps ?? 0) + 1; module.exports = { name: "real", evaluation: globalThis.deps };`,
        "uses-dep.cjs": `const dep = require("./dep.cjs"); module.exports = { dep, lazy: () => require("./dep.cjs") };`,
        "esm-dep.ts": `export const name = "real";`,
        "uses-esm-dep.ts": `import { name } from "./esm-dep"; export const read = () => name; export const lazy = async () => (await import("./esm-dep")).name;`,
        "mocks.test.ts": `
          import { afterEach, expect, jest, test } from "bun:test";
          let calls = 0;
          const factory = () => ({ name: "mock " + ++calls });
          afterEach(() => {
            jest.dontMock("./dep.cjs");
            jest.dontMock("./esm-dep");
            jest.resetModules();
            calls = 0;
          });

          test("a mock whose factory has run has the same exports inside", () => {
            jest.doMock("./dep.cjs", factory);
            const dep = require("./dep.cjs");
            let inner;
            jest.isolateModules(() => { inner = [require("./dep.cjs"), require("./uses-dep.cjs").dep]; });
            expect(inner).toEqual([dep, dep]);
            expect(inner[0]).toBe(dep);
            expect(inner[1]).toBe(dep);
            expect([require("./dep.cjs"), calls]).toEqual([dep, 1]);
          });

          test("a factory that runs inside for the first time runs again afterwards", () => {
            jest.doMock("./dep.cjs", factory);
            let inner;
            jest.isolateModules(() => { inner = require("./dep.cjs"); });
            const dep = require("./dep.cjs");
            expect([inner.name, dep.name]).toEqual(["mock 1", "mock 2"]);
            jest.isolateModules(() => expect(require("./dep.cjs")).toBe(dep));
            expect(calls).toBe(2);
          });

          test("jest.doMock() inside holds afterwards", () => {
            const dep = require("./dep.cjs");
            const user = require("./uses-dep.cjs");
            let inner;
            jest.isolateModules(() => {
              jest.doMock("./dep.cjs", factory);
              inner = require("./uses-dep.cjs");
            });
            expect(inner.dep.name).toBe("mock 1");
            // What was loaded before keeps the module that it has, and is still loaded.
            expect(user.dep).toBe(dep);
            expect(require("./uses-dep.cjs")).toBe(user);
            expect([require("./dep.cjs").name, user.lazy().name, inner.lazy().name, calls]).toEqual(["mock 2", "mock 2", "mock 2", 2]);
            expect(jest.requireActual("./dep.cjs")).toBe(dep);

            jest.dontMock("./dep.cjs");
            expect(require("./dep.cjs")).toBe(dep);
            expect(globalThis.deps).toBe(dep.evaluation);
          });

          test("jest.doMock() of an ES module inside holds afterwards", async () => {
            const user = await import("./uses-esm-dep");
            let inner;
            await jest.isolateModulesAsync(async () => {
              jest.doMock("./esm-dep", factory);
              inner = await import("./uses-esm-dep");
            });
            expect([inner.read(), user.read(), await user.lazy(), await inner.lazy()]).toEqual(["mock 1", "real", "mock 2", "mock 2"]);
            expect(await import("./uses-esm-dep")).toBe(user);
          });

          test("jest.dontMock() inside holds afterwards", () => {
            jest.doMock("./dep.cjs", factory);
            const mocked = require("./dep.cjs");
            let inner;
            jest.isolateModules(() => {
              jest.dontMock("./dep.cjs");
              inner = require("./dep.cjs");
            });
            expect([mocked.name, inner.name, require("./dep.cjs").name]).toEqual(["mock 1", "real", "real"]);
            expect(require("./dep.cjs")).not.toBe(inner);
          });

          test("a mock that has patched a loaded module, and jest.requireActual() inside", () => {
            const dep = require("./dep.cjs");
            const user = require("./uses-dep.cjs");
            jest.doMock("./dep.cjs", factory);
            expect(user.lazy().name).toBe("mock 1");
            let inner;
            jest.isolateModules(() => { inner = [require("./dep.cjs").name, jest.requireActual("./dep.cjs")]; });
            expect(inner[0]).toBe("mock 1");
            expect(inner[1]).toEqual({ name: "real", evaluation: dep.evaluation + 1 });
            expect(jest.requireActual("./dep.cjs")).toBe(dep);

            jest.dontMock("./dep.cjs");
            expect(require("./dep.cjs")).toBe(dep);
          });
        `,
      },
      6,
      args,
    );
  });

  test.each(isolationFlags)("at the top of a test file, in a hook of a preload, and at the end of a test file %j", async args => {
    await expectFixturesToPass(
      {
        ...counted,
        "plain.json": JSON.stringify(args.length === 0),
        "preload.ts": `
          import { beforeEach, jest } from "bun:test";
          beforeEach(() => {
            const loaded = require("./counter.cjs");
            let inner;
            jest.isolateModules(() => { inner = require("./counter.cjs"); });
            globalThis.ofPreload = [loaded, inner, require("./counter.cjs")];
          });
        `,
        "a.test.ts": `
          import { expect, jest, test } from "bun:test";
          import * as state from "./state";
          import { state as sameState } from "./uses-state";

          const counter = require("./counter.cjs");
          let inner, innerAsync;
          jest.isolateModules(() => { inner = [require("./counter.cjs"), require("./state")]; });
          await jest.isolateModulesAsync(async () => { innerAsync = [require("./counter.cjs"), await import("./state")]; });

          test("at the top of a test file", async () => {
            expect([inner[0].evaluation, innerAsync[0].evaluation]).toEqual([counter.evaluation + 1, counter.evaluation + 2]);
            expect([inner[1].evaluation, innerAsync[1].evaluation]).toEqual([state.evaluation + 1, state.evaluation + 2]);
            expect(require("./counter.cjs")).toBe(counter);
            expect((await import("./state")).state).toBe(sameState);
            expect(await import("./a.test.ts")).toBeObject();
          });

          test("in a hook of a preload", () => {
            const [loaded, isolated, after] = globalThis.ofPreload;
            expect(isolated).not.toBe(loaded);
            expect(after).toBe(loaded);
          });

          test("a callback that never settles", () => {
            globalThis.counterOfA = require("./counter.cjs");
            jest.isolateModulesAsync(() => new Promise(() => {}));
            expect(require("./counter.cjs")).not.toBe(globalThis.counterOfA);
          });
        `,
        "b.test.ts": `
          import { expect, jest, test } from "bun:test";


          test("the next test file has the registry from before it", () => {
            const counter = require("./counter.cjs");
            // Without --isolate it shares the modules of the file before it.
            if (require("./plain.json")) expect(counter).toBe(globalThis.counterOfA);
            let inner;
            jest.isolateModules(() => { inner = require("./counter.cjs"); });
            expect(inner).not.toBe(counter);
            expect(require("./counter.cjs")).toBe(counter);
          });
        `,
      },
      4,
      ["--preload", "./preload.ts", ...args],
    );
  });

  // The addon includes no header of Node-API: the two functions that it calls have a stable ABI.
  const addonDirectory =
    isWindows || !Bun.which("cc")
      ? undefined
      : tempDir("isolate-modules-addon", {
          "addon.c": `
            typedef struct napi_env__* napi_env;
            typedef struct napi_value__* napi_value;
            extern int napi_create_int32(napi_env, int, napi_value*);
            extern int napi_set_named_property(napi_env, napi_value, const char*, napi_value);
            static int loads;
            napi_value napi_register_module_v1(napi_env env, napi_value exports) {
              napi_value count;
              napi_create_int32(env, ++loads, &count);
              napi_set_named_property(env, exports, "loads", count);
              return exports;
            }
          `,
        });
  afterAll(() => addonDirectory?.[Symbol.dispose]());
  // The compiler starts here, so that its first run has the time of the tests above.
  const addons =
    addonDirectory &&
    Promise.all(
      ["before.node", "inside.node"].map(async addon => {
        await using cc = Bun.spawn({
          cmd: ["cc", "-shared", "-fPIC", ...(isMacOS ? ["-undefined", "dynamic_lookup"] : []), "-o", addon, "addon.c"],
          cwd: String(addonDirectory),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([cc.stdout.text(), cc.stderr.text(), cc.exited]);
        return { path: join(String(addonDirectory), addon), stdout, stderr, exitCode };
      }),
    );

  test.skipIf(!addons).each(isolationFlags)(
    "a native addon is loaded once, as after jest.resetModules() %j",
    async args => {
      const [before, inside] = await addons!;
      expect([before, inside]).toEqual([
        { path: before.path, stdout: "", stderr: "", exitCode: 0 },
        { path: inside.path, stdout: "", stderr: "", exitCode: 0 },
      ]);
      await expectFixturesToPass(
        {
          "addons.json": JSON.stringify([before.path, inside.path]),
          "addon.test.cjs": `
            const { expect, jest, test } = require("bun:test");
            const [before, inside] = require("./addons.json");

            test("the callback gets the addon that is loaded, and one that it is the first to load stays loaded", () => {
              const addon = require(before);
              let inner;
              jest.isolateModules(() => { inner = [require(before), require(inside), Object.keys(require.cache).length]; });
              expect(inner[0]).toBe(addon);
              expect(require(inside)).toBe(inner[1]);
              expect([addon.loads, inner[1].loads, inner[2]]).toEqual([1, 1, 2]);
              jest.isolateModules(() => expect([require(before), require(inside)]).toEqual([addon, inner[1]]));
            });
          `,
        },
        1,
        args,
      );
    },
  );

  test("the registries of callbacks are collected, and a Worker has its own", async () => {
    await expectFixturesToPass(
      {
        ...counted,
        "worker.ts": `
          const { jest } = require("bun:test");
          const counter = require("./counter.cjs");
          let inner;
          jest.isolateModules(() => { inner = require("./counter.cjs"); });
          jest.isolateModulesAsync(() => new Promise(() => {}));
          postMessage([inner !== counter, require("./counter.cjs") !== counter]);
        `,
        "collected.test.ts": `
          import { expect, jest, test } from "bun:test";
          import { heapStats } from "bun:jsc";

          test("a Worker has its own", async () => {
            const counter = require("./counter.cjs");
            const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
            const { promise, resolve, reject } = Promise.withResolvers();
            worker.onmessage = event => resolve(event.data);
            worker.onerror = reject;
            expect(await promise).toEqual([true, true]);
            expect(require("./counter.cjs")).toBe(counter);
            jest.isolateModules(() => expect(require("./counter.cjs")).not.toBe(counter));
            await worker.terminate();
          });

          test("the registries of callbacks are collected", async () => {
            const count = () => {
              Bun.gc(true);
              const { ModuleRegistryEntry = 0, Module = 0 } = heapStats().objectTypeCounts;
              return ModuleRegistryEntry + Module;
            };
            const isolate = async () => {
              jest.isolateModules(() => void require("./uses-counter.cjs"));
              await jest.isolateModulesAsync(async () => void (await import("./uses-state")));
            };
            for (let i = 0; i < 5; i++) await isolate();
            const before = count();
            // Each round loads four modules.
            for (let i = 0; i < 40; i++) await isolate();
            expect(count() - before).toBeLessThan(20);
          });
        `,
      },
      2,
    );
  });
});

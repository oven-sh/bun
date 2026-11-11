// mock.module() and the other mock functions resolve a path beside the file of their caller, which they read from the caller's frame.
// A synchronous test or hook that ends in such a call makes a tail call, and a tail call drops that frame. Where the test runner
// called the test or hook, no caller is left on the stack, and the file of the callback that the runner is calling stands for it.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("mock-module-no-caller-frame", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
  expect(exitCode).toBe(0);
}

// What a test file reads: the module that was loaded before the mock call, what a later import of the same path gets, and what
// the same path gets in another folder. mock.module(), vi.mock() and jest.doMock() also patch the module that is loaded already.
const patched = `["mocked", "mocked", "real in another folder"]`;
const onlyLaterImports = `["real", "mocked", "real in another folder"]`;

type Shape = [name: string, register: string, ownTests?: number, read?: string];

const inAnotherFolder = {
  "other/helpers.ts": `
    import { mock } from "bun:test";
    export const read = (path: string) => import(path).then(module => module.value);
    export const forward = (path: string, factory: () => unknown) => mock.module(path, factory);
    const besideThisFile = "./dep-hook-of-another-folder";
    export const mockBesideThisFile = () => mock.module(besideThisFile, () => ({ value: "mocked" }));
    const later = "./dep-continuation";
    export const mockLater = () => Promise.resolve().then(() => mock.module(later, () => ({ value: "mocked" })));
  `,
};

// One test file for each shape, with a module of its own beside it and a module of the same name in another folder.
function fixturesOf(shapes: Shape[]) {
  const files: Record<string, string> = { ...inAnotherFolder };
  let tests = 0;
  for (const [name, register, ownTests = 0, read = patched] of shapes) {
    tests += ownTests + 1;
    files[`tests/dep-${name}.ts`] = `export const value = "real";`;
    files[`other/dep-${name}.ts`] = `export const value = "real in another folder";`;
    files[`tests/${name}.test.ts`] = `
      import * as bunTest from "bun:test";
      import { afterEach, aroundEach, beforeAll, beforeEach, expect, jest, mock, onTestFinished, test, vi } from "bun:test";
      import { AsyncLocalStorage } from "node:async_hooks";
      import * as loaded from "./dep-${name}";
      import { forward as forwardInAnotherFolder, read as readInAnotherFolder } from "../other/helpers";
      const path = "./dep-${name}";
      const factory = () => ({ value: "mocked" });
      ${register}
      test("${name}", async () => {
        expect([loaded.value, (await import(path)).value, await readInAnotherFolder(path)]).toEqual(${read});
      });
    `;
  }
  return { files, tests };
}

test.concurrent("a mock call that ends a test or a hook resolves its path beside that test or hook", async () => {
  const { files, tests } = fixturesOf([
    ["test-body", `test("registers", () => mock.module(path, factory));`, 1],
    ["each-row", `test.each([path])("registers %s", row => mock.module(row, factory));`, 1],
    ["done-style", `test("registers", done => (done(), mock.module(path, factory)));`, 1],
    [
      "concurrent",
      `test.concurrent("registers", () => mock.module(path, factory)); test.concurrent("beside it", () => {});`,
      2,
    ],
    ["before-all", `beforeAll(() => mock.module(path, factory));`],
    ["before-each", `beforeEach(() => mock.module(path, factory));`],
    ["after-each", `afterEach(() => mock.module(path, factory)); test("runs the hook", () => {});`, 1],
    ["around-each", `aroundEach(runTest => (runTest(), mock.module(path, factory)));`],
    ["on-test-finished", `test("registers", () => { onTestFinished(() => mock.module(path, factory)); });`, 1],
    ["declared-function", `beforeAll(function () { return mock.module(path, factory); });`],
    // The runner then holds the callback in a wrapper that knows the store, and a row of .each() in a bound function.
    ["under-a-store", `new AsyncLocalStorage().run(1, () => beforeAll(() => mock.module(path, factory)));`],
    [
      "each-row-under-a-store",
      `new AsyncLocalStorage().run(1, () => test.each([path])("registers %s", row => mock.module(row, factory)));`,
      1,
    ],
  ]);
  await expectFixturesToPass(
    {
      ...files,
      // The hook is written in another folder, and the test file only hands it to the runner.
      "tests/dep-hook-of-another-folder.ts": `export const value = "real";`,
      "other/dep-hook-of-another-folder.ts": `export const value = "real in another folder";`,
      "tests/hook-of-another-folder.test.ts": `
        import { beforeAll, expect, test } from "bun:test";
        import * as besideTheTestFile from "./dep-hook-of-another-folder";
        import * as besideTheHook from "../other/dep-hook-of-another-folder";
        import { mockBesideThisFile } from "../other/helpers";
        beforeAll(mockBesideThisFile);
        test("hook-of-another-folder", () => {
          expect([besideTheTestFile.value, besideTheHook.value]).toEqual(["real", "mocked"]);
        });
      `,
    },
    tests + 1,
  );
});

test.concurrent("whatever the call writes for its path and for its receiver", async () => {
  const { files, tests } = fixturesOf([
    ["joined", `const name = "joined"; beforeAll(() => mock.module("./dep-" + name, factory));`],
    ["file-url", `beforeAll(() => mock.module(import.meta.resolve(path + ".ts"), factory));`],
    ["for-each", `beforeAll(() => [path].forEach(each => mock.module(each, factory)));`],
    ["call", `beforeAll(() => mock.module.call(mock, path, factory));`],
    [
      "either-arm",
      `const mockEither = to => (to ? mock.module(to, factory) : mock.module("./no-file", factory));
       beforeAll(() => mockEither(path));`,
    ],
    // The transpiler knows `mock`, `vi` and `jest` only by the names that the test file imports.
    ["alias-of-mock", `const alias = mock; beforeAll(() => alias.module("./dep-alias-of-mock", factory));`],
    ["namespace", `beforeAll(() => bunTest.mock.module("./dep-namespace", factory));`],
    ["alias-of-vi", `const alias = vi; beforeAll(() => alias.mock("./dep-alias-of-vi", factory));`],
    [
      "do-mock-of-vi",
      `const { doMock } = vi; beforeAll(() => doMock("./dep-do-mock-of-vi", factory));`,
      0,
      onlyLaterImports,
    ],
    ["alias-of-jest", `const alias = jest; beforeAll(() => alias.doMock("./dep-alias-of-jest", factory));`],
    // A path that is handed on is a path of the caller. Here the caller is the hook.
    [
      "forwarded",
      `const forward = (to, make) => mock.module(to, make); beforeAll(() => forward("./dep-forwarded", factory));`,
    ],
    [
      "forwarded-in-another-folder",
      `beforeAll(() => forwardInAnotherFolder("./dep-forwarded-in-another-folder", factory));`,
    ],
  ]);
  await expectFixturesToPass(
    {
      ...files,
      "node_modules/a-package/package.json": JSON.stringify({ name: "a-package", type: "module", main: "./index.js" }),
      "node_modules/a-package/index.js": `export const value = "real";`,
      "tests/package.test.ts": `
        import { beforeAll, expect, mock, test } from "bun:test";
        import * as loaded from "a-package";
        const name = "a-package";
        beforeAll(() => mock.module(name, () => ({ value: "mocked" })));
        test("package", () => expect(loaded.value).toBe("mocked"));
      `,
      // Only strict code makes tail calls.
      "tests/dep-commonjs.cjs": `exports.value = "real";`,
      "other/dep-commonjs.cjs": `exports.value = "real in another folder";`,
      "other/read.cjs": `exports.read = path => require(path).value;`,
      "tests/commonjs.test.cjs": `
        "use strict";
        const { beforeAll, expect, mock, test } = require("bun:test");
        const { read } = require("../other/read.cjs");
        require("./dep-commonjs.cjs");
        beforeAll(() => mock.module("./dep-commonjs.cjs", () => ({ value: "mocked" })));
        test("commonjs", () => {
          expect([require("./dep-commonjs.cjs").value, read("./dep-commonjs.cjs")]).toEqual(["mocked", "real in another folder"]);
        });
      `,
    },
    tests + 2,
  );
});

test.concurrent("so do the functions that take only a path", async () => {
  // Each module says which folder it was loaded from. With no caller, these functions resolve beside the working directory.
  const loads = (name: string, load: string) => ({
    [`dep-${name}.ts`]: `(globalThis.loadedFrom ??= {})["${name}"] = "the working directory"; export const value = 1;`,
    [`tests/dep-${name}.ts`]: `(globalThis.loadedFrom ??= {})["${name}"] = "the folder of the test file"; export const value = 1;`,
    [`tests/${name}.test.ts`]: `
      import { expect, jest, test, vi } from "bun:test";
      const path = "./dep-${name}";
      const ofVi = vi;
      const ofJest = jest;
      test("loads", () => ${load});
      test("${name}", () => expect(globalThis.loadedFrom["${name}"]).toBe("the folder of the test file"));
    `,
  });
  // The call that ends a mock finds it only by the path that the call that made it resolved.
  const ends = (name: string, make: string, end: string) => ({
    [`tests/dep-${name}.ts`]: `export const value = "real";`,
    [`tests/${name}.test.ts`]: `
      import { beforeAll, expect, test, vi } from "bun:test";
      const path = "./dep-${name}";
      const ofVi = vi;
      const factory = () => ({ value: "mocked" });
      beforeAll(${make});
      test("is mocked", async () => expect((await import(path)).value).toBe("mocked"));
      test("ends the mock", ${end});
      test("${name}", async () => expect((await import(path)).value).toBe("real"));
    `,
  });
  await expectFixturesToPass(
    {
      ...loads("import-actual", `ofVi.importActual(path)`),
      ...loads("import-mock", `ofVi.importMock(path)`),
      ...loads("require-actual", `ofJest.requireActual(path)`),
      ...loads("require-mock", `ofJest.requireMock(path)`),
      ...loads("create-mock-from-module", `ofJest.createMockFromModule(path)`),
      ...ends("unmock", `() => ofVi.doMock(path, factory)`, `() => ofVi.doUnmock(path)`),
      ...ends("unmock-in-a-block", `() => ofVi.doMock(path, factory)`, `() => { ofVi.doUnmock(path); }`),
      ...ends("unmock-of-a-mock-in-a-block", `() => { ofVi.doMock(path, factory); }`, `() => ofVi.doUnmock(path)`),
    },
    5 * 2 + 3 * 3,
  );
});

test.concurrent("a hook of a --preload script mocks the file beside the script for every test file", async () => {
  const reads = (own: string) => `
    import { expect, test } from "bun:test";
    import * as besideThePreload from "../setup/dep";
    import * as besideTheTestFile from "./dep";
    test("reads", async () => {
      expect([besideThePreload.value, besideTheTestFile.value, (await import("./dep")).value]).toEqual(["mocked", "${own}", "${own}"]);
    });
  `;
  await expectFixturesToPass(
    {
      "setup/dep.ts": `export const value = "real beside the preload";`,
      "setup/preload.ts": `
        import { beforeAll, mock } from "bun:test";
        const path = "./dep";
        beforeAll(() => mock.module(path, () => ({ value: "mocked" })));
      `,
      "first/dep.ts": `export const value = "real beside the first";`,
      "first/first.test.ts": reads("real beside the first"),
      "second/dep.ts": `export const value = "real beside the second";`,
      "second/second.test.ts": reads("real beside the second"),
    },
    2,
    ["--preload", "./setup/preload.ts", "./first/first.test.ts", "./second/second.test.ts"],
  );
});

test.concurrent("a file: URL that holds a whole path needs no caller", async () => {
  const { files, tests } = fixturesOf([
    // A promise callback has no caller, and the runner is calling nothing when it runs.
    [
      "file-url-in-a-continuation",
      `beforeAll(async () => {
         await Promise.resolve().then(() => mock.module(import.meta.resolve(path + ".ts"), factory));
       });`,
    ],
  ]);
  await expectFixturesToPass(
    {
      ...files,
      "tests/invalid.test.ts": `
        import { expect, mock, test } from "bun:test";
        test("invalid", async () => {
          const withoutCaller = Promise.resolve().then(() => mock.module("file:///a%00b.ts", () => ({})));
          const withCaller = Promise.resolve().then(() => { mock.module("file:///a%00b.ts", () => ({})); });
          expect(await Promise.allSettled([withoutCaller, withCaller])).toEqual([
            { status: "rejected", reason: new TypeError('Invalid "file:" URL') },
            { status: "rejected", reason: new TypeError('Invalid "file:" URL') },
          ]);
        });
      `,
    },
    tests + 1,
  );
});

test.concurrent("the callback stands for the caller only while the runner is calling it", async () => {
  await expectFixturesToPass(
    {
      ...inAnotherFolder,
      // The promise callback runs when the test body has returned: its path is no path of the test file.
      "tests/dep-continuation.ts": `export const value = "real";`,
      "tests/continuation.test.ts": `
        import { expect, test } from "bun:test";
        import * as besideTheTestFile from "./dep-continuation";
        import { mockLater } from "../other/helpers";
        test("queues", () => mockLater());
        test("continuation", () => expect(besideTheTestFile.value).toBe("real"));
      `,
      // A function of the runtime is written in no file, so the path stays as it is written.
      "tests/dep-bound.ts": `export const value = "real";`,
      "tests/bound.test.ts": `
        import { beforeAll, expect, mock, test } from "bun:test";
        import * as loaded from "./dep-bound";
        const path = "./dep-bound";
        beforeAll(mock.module.bind(mock, path, () => ({ value: "mocked" })));
        test("bound", () => expect(loaded.value).toBe("real"));
      `,
      // The runner and its callbacks belong to the main thread.
      "tests/dep-worker.ts": `export const value = "real";`,
      "tests/worker.ts": `
        import { mock } from "bun:test";
        import { value } from "./dep-worker";
        const path = "./dep-worker";
        self.onmessage = ({ data: flags }) => {
          Atomics.wait(flags, 0, 0); // until the main thread is inside its test body
          queueMicrotask(() => mock.module(path, () => ({ value: "mocked" })));
          queueMicrotask(() => {
            Atomics.store(flags, 1, value === "mocked" ? 2 : 1);
            Atomics.notify(flags, 1);
          });
        };
        self.postMessage("ready");
      `,
      "tests/worker.test.ts": `
        import { afterAll, beforeAll, expect, test } from "bun:test";
        const flags = new Int32Array(new SharedArrayBuffer(8));
        let worker: Worker;
        beforeAll(async () => {
          worker = new Worker(new URL("./worker.ts", import.meta.url).href);
          const { promise: ready, resolve, reject } = Promise.withResolvers();
          worker.onmessage = resolve;
          worker.onerror = reject;
          worker.postMessage(flags);
          await ready;
        });
        afterAll(() => worker.terminate());
        test("worker", () => {
          Atomics.store(flags, 0, 1);
          Atomics.notify(flags, 0);
          // This test body is the callback that the runner is calling while the worker makes its call.
          Atomics.wait(flags, 1, 0, 5000);
          // 0: the worker did not answer. 1: its module is real. 2: the path was resolved beside this file.
          expect(Atomics.load(flags, 1)).toBe(1);
        });
      `,
    },
    4,
  );
});

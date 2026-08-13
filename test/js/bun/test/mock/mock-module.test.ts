// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write tests for Promise rejection
// - Write tests for pending promise when a module already exists
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { describe, expect, mock, spyOn, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { default as defaultValue, fn, iCallFn, rexported, rexportedAs, variable } from "./mock-module-fixture";
import * as spyFixture from "./spymodule-fixture";

test("mock.module async", async () => {
  mock.module("i-am-async-and-mocked", async () => {
    await 42;
    await Bun.sleep(0);
    return { a: 123 };
  });

  expect((await import("i-am-async-and-mocked")).a).toBe(123);
});

test("mock.restore", () => {
  const original = spyFixture.iSpy;
  spyOn(spyFixture, "iSpy");
  const mocked = spyFixture.iSpy;
  expect(spyFixture.iSpy).not.toBe(original);
  expect(spyFixture.iSpy).not.toHaveBeenCalled();
  // @ts-expect-error
  spyFixture.iSpy();
  mock.restore();
  expect(spyFixture.iSpy).toBe(original);
});

test("spyOn", () => {
  spyOn(spyFixture, "iSpy");
  expect(spyFixture.iSpy).not.toHaveBeenCalled();
  spyFixture.iSpy(123);
  expect(spyFixture.iSpy).toHaveBeenCalled();
});

test("mocking a module that points to a file which does not resolve successfully still works", async () => {
  mock.module("i-never-existed-and-i-never-will", () => {
    return {
      bar: 42,
    };
  });

  // @ts-expect-error
  const { bar } = await import("i-never-existed-and-i-never-will");

  expect(bar).toBe(42);
});

test("mocking a non-existant relative file with a file URL", async () => {
  expect(() => require.resolve("./hey-hey-you-you2.ts")).toThrow();
  mock.module("file:./hey-hey-you-you2.ts", () => {
    return {
      bar: 42,
    };
  });

  // @ts-expect-error
  const { bar } = await import("./hey-hey-you-you2.ts");
  expect(bar).toBe(42);

  expect(require("./hey-hey-you-you2.ts").bar).toBe(42);
  expect(require.resolve("./hey-hey-you-you2.ts")).toBe(import.meta.resolveSync("./hey-hey-you-you2.ts"));
  expect(require.resolve("./hey-hey-you-you2.ts")).toBe(require.resolve("./hey-hey-you-you2.ts"));
});

test("mocking a non-existant relative file", async () => {
  expect(() => require.resolve("./hey-hey-you-you.ts")).toThrow();
  mock.module("./hey-hey-you-you.ts", () => {
    return {
      bar: 42,
    };
  });

  // @ts-expect-error
  const { bar } = await import("./hey-hey-you-you.ts");
  expect(bar).toBe(42);

  expect(require("./hey-hey-you-you.ts").bar).toBe(42);
  expect(require.resolve("./hey-hey-you-you.ts")).toBe(import.meta.resolveSync("./hey-hey-you-you.ts"));
  expect(require.resolve("./hey-hey-you-you.ts")).toBe(require.resolve("./hey-hey-you-you.ts"));
});

test("mocking a local file", async () => {
  expect(fn()).toEqual(42);
  expect(variable).toEqual(7);
  expect(defaultValue).toEqual("original");
  expect(rexported).toEqual(42);

  mock.module("./mock-module-fixture", () => {
    return {
      fn: () => 1,
      variable: 8,
      default: 42,
      rexported: 43,
    };
  });
  expect(fn()).toEqual(1);
  expect(variable).toEqual(8);
  // expect(defaultValue).toEqual(42);
  expect(rexported).toEqual(43);
  expect(rexportedAs).toEqual(43);
  expect((await import("./re-export-fixture")).rexported).toEqual(43);
  mock.module("./mock-module-fixture", () => {
    return {
      fn: () => 2,
      variable: 9,
    };
  });
  expect(fn()).toEqual(2);
  expect(variable).toEqual(9);
  mock.module("./mock-module-fixture", () => {
    return {
      fn: () => 3,
      variable: 10,
    };
  });
  expect(fn()).toEqual(3);
  expect(variable).toEqual(10);
  expect(require("./mock-module-fixture").fn()).toBe(3);
  expect(require("./mock-module-fixture").variable).toBe(10);
  expect(iCallFn()).toBe(3);
});

test.todo("adding a default on a module with no default", async () => {
  mock.module("./re-export-fixture.ts", () => {
    return {
      default: 42,
    };
  });
  expect((await import("./re-export-fixture")).default).toBe(42);
});

test("mocking a package", async () => {
  mock.module("ha-ha-ha", () => {
    return {
      wow: () => 42,
    };
  });
  const hahaha = await import("ha-ha-ha");
  expect(hahaha.wow()).toBe(42);
  expect(require("ha-ha-ha").wow()).toBe(42);
  mock.module("ha-ha-ha", () => {
    return {
      wow: () => 43,
    };
  });

  expect(hahaha.wow()).toBe(43);
  expect(require("ha-ha-ha").wow()).toBe(43);
});

test("mocking a builtin", async () => {
  mock.module("fs/promises", () => {
    return {
      readFile: () => Promise.resolve("hello world"),
    };
  });

  const { readFile } = await import("node:fs/promises");
  expect(await readFile("hello.txt", "utf8")).toBe("hello world");
});

// `() => mock.module(...)` is a proper tail call (test files are modules, so strict mode), which
// replaces the callback's frame with mock.module's own. When the test runner is what invoked the
// callback, nothing below mock.module on the stack says which file made the call, so the specifier
// has to be resolved against the file the callback was defined in. Each scenario imports the module
// first: the mock only takes effect if the specifier resolves to the path that is already loaded.
describe("mock.module() tail-called from a callback the runner invokes", () => {
  // bun test reports to stderr; the inner test's failure output ends up in the assertion message.
  async function expectBunTestToPass(dir: string, passing: number, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({
      stderr: expect.stringContaining(` ${passing} pass\n`),
      exitCode: 0,
    });
  }

  const dep = `export const value = "real";\n`;
  const mocked = `() => ({ value: "mocked" })`;

  const shapes: [shape: string, register: string, passing: number][] = [
    ["beforeAll", `beforeAll(() => mock.module("./dep", ${mocked}));`, 1],
    ["beforeEach", `beforeEach(() => mock.module("./dep", ${mocked}));`, 1],
    ["describe body", `describe("registers", () => mock.module("./dep", ${mocked}));`, 1],
    ["test body", `test("registers", () => mock.module("./dep", ${mocked}));`, 2],
    ["test.each body", `test.each(["./dep"])("registers %s", specifier => mock.module(specifier, ${mocked}));`, 2],
    ["beforeAll with a relative file: URL", `beforeAll(() => mock.module("file:./dep.ts", ${mocked}));`, 1],
  ];

  test.concurrent.each(shapes)("%s", async (_shape, register, passing) => {
    using dir = tempDir("mock-module-tail-call", {
      "dep.ts": dep,
      "tail.test.ts": `
        import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
        import { value } from "./dep";
        ${register}
        test("mock applied to the already-imported module", () => expect(value).toBe("mocked"));
      `,
    });

    await expectBunTestToPass(String(dir), passing, "tail.test.ts");
  });

  test.concurrent("a package specifier is resolved to the loaded package", async () => {
    using dir = tempDir("mock-module-tail-call-pkg", {
      "node_modules/some-pkg/package.json": `{ "name": "some-pkg", "main": "index.js" }`,
      "node_modules/some-pkg/index.js": dep,
      "tail.test.ts": `
        import { beforeAll, expect, mock, test } from "bun:test";
        import { value } from "some-pkg";
        beforeAll(() => mock.module("some-pkg", ${mocked}));
        test("mock applied to the already-imported package", () => expect(value).toBe("mocked"));
      `,
    });

    await expectBunTestToPass(String(dir), 1, "tail.test.ts");
  });

  // Cross-file layout: the code that calls mock.module("./dep") lives in setup/, next to setup/dep.ts.
  // The dep.ts next to the test file is a decoy: it changes in the assertion if "./dep" gets resolved
  // against the test file instead of against the file that made the call.
  const setupFiles = {
    "setup/dep.ts": dep,
    "dep.ts": `export const value = "decoy";\n`,
    "setup/helpers.ts": `
      import { mock } from "bun:test";
      export function mockDep() {
        mock.module("./dep", ${mocked});
      }
      export const mockDepLater = () => Promise.resolve().then(() => mock.module("./dep", ${mocked}));
    `,
  };
  const assertWhichDepGotMocked = (setupDep: string) => `
    import { expect, test } from "bun:test";
    import { value as setupDep } from "./setup/dep";
    import { value as decoy } from "./dep";
    test("which dep got mocked", () => {
      expect({ setupDep, decoy }).toEqual({ setupDep: ${JSON.stringify(setupDep)}, decoy: "decoy" });
    });
  `;

  test.concurrent("a hook from --preload resolves against the preload file, not the test file", async () => {
    using dir = tempDir("mock-module-tail-call-preload", {
      ...setupFiles,
      "setup/preload.ts": `
        import { beforeAll, mock } from "bun:test";
        beforeAll(() => mock.module("./dep", ${mocked}));
      `,
      "app.test.ts": assertWhichDepGotMocked("mocked"),
    });

    await expectBunTestToPass(String(dir), 1, "--preload", "./setup/preload.ts", "app.test.ts");
  });

  test.concurrent("a caller that still has a frame wins over the callback the runner invoked", async () => {
    using dir = tempDir("mock-module-tail-call-frame-wins", {
      ...setupFiles,
      "app.test.ts": `
        import { beforeAll } from "bun:test";
        import { mockDep } from "./setup/helpers";
        beforeAll(() => {
          mockDep();
        });
        ${assertWhichDepGotMocked("mocked")}
      `,
    });

    await expectBunTestToPass(String(dir), 1, "app.test.ts");
  });

  test.concurrent("a continuation queued by the callback is not resolved against the callback's file", async () => {
    using dir = tempDir("mock-module-tail-call-continuation", {
      ...setupFiles,
      "app.test.ts": `
        import { test } from "bun:test";
        import { mockDepLater } from "./setup/helpers";
        test("registers from a .then() that runs in the microtask drain after the test body", () => mockDepLater());
        ${assertWhichDepGotMocked("real")}
      `,
    });

    await expectBunTestToPass(String(dir), 2, "app.test.ts");
  });

  test.concurrent("a Worker's mock.module() does not pick up the callback running on the main thread", async () => {
    using dir = tempDir("mock-module-tail-call-worker", {
      "dep.ts": dep,
      "worker.ts": `
        import { mock } from "bun:test";
        import { value } from "./dep";
        self.onmessage = ({ data: flags }) => {
          Atomics.wait(flags, 0, 0); // until the main thread is blocked inside its test body
          // A tail call from a native-invoked callback: no JS frame is left below mock.module.
          queueMicrotask(() => mock.module("./dep", ${mocked}));
          queueMicrotask(() => {
            Atomics.store(flags, 1, value === "mocked" ? 2 : 1);
            Atomics.notify(flags, 1);
          });
        };
        self.postMessage("ready");
      `,
      "app.test.ts": `
        import { afterAll, beforeAll, expect, test } from "bun:test";
        const flags = new Int32Array(new SharedArrayBuffer(8));
        let worker: Worker;
        beforeAll(async () => {
          worker = new Worker(new URL("./worker.ts", import.meta.url).href);
          const ready = new Promise(resolve => (worker.onmessage = resolve));
          worker.postMessage(flags);
          await ready;
        });
        afterAll(() => worker.terminate());
        test("the worker still sees the real module", () => {
          Atomics.store(flags, 0, 1);
          Atomics.notify(flags, 0);
          // Block here so this callback is the one the runner has on the stack while the worker runs.
          Atomics.wait(flags, 1, 0);
          // 1: "./dep" stayed unresolved in the worker, as before; 2: it was resolved against this file.
          expect(Atomics.load(flags, 1)).toBe(1);
        });
      `,
    });

    await expectBunTestToPass(String(dir), 1, "app.test.ts");
  });
});

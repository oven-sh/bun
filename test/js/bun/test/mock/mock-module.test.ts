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

// https://github.com/oven-sh/bun/issues/10428
describe("top-level jest.mock/mock.module is hoisted above static imports", () => {
  const lib = `
    export class Client { send() { return "real"; } }
    export const value = "real-value";
    export default "real-default";
  `;
  const consumer = `
    import { Client } from "./lib";
    const client = new Client();
    export const callSend = () => client.send();
  `;

  async function runFixture(files: Record<string, string>, extraArgs: string[] = []) {
    using dir = tempDir("mock-hoist", { "lib.ts": lib, "consumer.ts": consumer, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...extraArgs, "fixture.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("mock.module() installs before a transitively-imported module evaluates", async () => {
    const { stderr, exitCode } = await runFixture({
      "fixture.test.ts": `
        import { expect, test, mock, jest } from "bun:test";
        import { callSend } from "./consumer";
        mock.module("./lib", () => ({
          Client: jest.fn().mockImplementation(() => ({ send: () => "mocked" })),
        }));
        test("t", () => {
          expect(callSend()).toBe("mocked");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test.concurrent("jest.mock() hoists", async () => {
    const { stderr, exitCode } = await runFixture({
      "fixture.test.ts": `
        import { expect, test, jest } from "bun:test";
        import { callSend } from "./consumer";
        jest.mock("./lib", () => ({
          Client: class { send() { return "mocked"; } },
        }));
        test("t", () => { expect(callSend()).toBe("mocked"); });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("vi.mock() hoists", async () => {
    const { stderr, exitCode } = await runFixture({
      "fixture.test.ts": `
        import { expect, test, vi } from "bun:test";
        import { callSend } from "./consumer";
        vi.mock("./lib", () => ({
          Client: class { send() { return "mocked"; } },
        }));
        test("t", () => { expect(callSend()).toBe("mocked"); });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("rewrites default, named, aliased, namespace and side-effect imports", async () => {
    // The consumer captures values at module-evaluation time so we can tell
    // whether the mock was installed before the import graph ran.
    const { stderr, exitCode } = await runFixture({
      "side.ts": `(globalThis as any).__side_ran = true;`,
      "capture.ts": `
        import d from "./lib";
        import { value, Client as C } from "./lib";
        export const captured = { d, value, send: new C().send() };
        export default captured;
      `,
      "fixture.test.ts": `
        import { expect, test, jest } from "bun:test";
        import cap from "./capture";
        import * as capNs from "./capture";
        import { captured as aliased } from "./capture";
        import "./side";
        jest.mock("./lib", () => ({
          default: "mocked-default",
          value: "mocked-value",
          Client: class { send() { return "mocked"; } },
        }));
        test("t", () => {
          expect({
            cap,
            capNs: capNs.captured,
            aliased,
            side: (globalThis as any).__side_ran,
          }).toEqual({
            cap: { d: "mocked-default", value: "mocked-value", send: "mocked" },
            capNs: { d: "mocked-default", value: "mocked-value", send: "mocked" },
            aliased: { d: "mocked-default", value: "mocked-value", send: "mocked" },
            side: true,
          });
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test.concurrent("only jest.mock/vi.mock/mock.module on the bun:test binding trigger the rewrite", async () => {
    // If a non-hoisted member like jest.fn() or a user-declared `mock`
    // triggered the rewrite, "./order-a" would be deferred and "body" would
    // print first.
    const { stdout, stderr, exitCode } = await runFixture({
      "order-a.ts": `console.log("a");`,
      "fixture.test.ts": `
        import { test, jest } from "bun:test";
        console.log("body");
        import "./order-a";
        jest.fn();
        const mock = { module: () => {} };
        mock.module();
        test("t", () => {});
      `,
    });
    expect(stderr).toContain("1 pass");
    // Static ESM: "./order-a" evaluates before module body code.
    expect(stdout).toContain("a\nbody\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("files without a top-level mock call keep native ESM import ordering", async () => {
    const { stdout, stderr, exitCode } = await runFixture({
      "order-a.ts": `console.log("a");`,
      "fixture.test.ts": `
        import { test } from "bun:test";
        console.log("body");
        import "./order-a";
        test("t", () => {});
      `,
    });
    expect(stderr).toContain("1 pass");
    // Static ESM: "./order-a" evaluates before module body code.
    expect(stdout).toContain("a\nbody\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("hoists with injected jest global (no bun:test import)", async () => {
    const { stderr, exitCode } = await runFixture({
      "fixture.test.ts": `
        jest.mock("./lib", () => ({
          Client: class { send() { return "mocked"; } },
        }));
        import { callSend } from "./consumer";
        test("t", () => { expect(callSend()).toBe("mocked"); });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("mock imported from a module other than bun:test does not trigger the rewrite", async () => {
    const { stdout, stderr, exitCode } = await runFixture({
      "order-a.ts": `console.log("a");`,
      "wrapper.ts": `export const mock = { module: (_s: string, _f: () => unknown) => {} };`,
      "fixture.test.ts": `
        import { test } from "bun:test";
        import { mock } from "./wrapper";
        console.log("body");
        import "./order-a";
        mock.module("./lib", () => ({}));
        test("t", () => {});
      `,
    });
    expect(stderr).toContain("1 pass");
    // "./order-a" must stay engine-hoisted because this `mock` is not bun:test's.
    expect(stdout).toContain("a\nbody\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("import attributes are preserved when a mock is hoisted", async () => {
    const { stderr, exitCode } = await runFixture({
      "data.txt": "file-contents",
      "fixture.test.ts": `
        import { expect, test, jest } from "bun:test";
        import data from "./data.txt" with { type: "text" };
        import { callSend } from "./consumer";
        jest.mock("./lib", () => ({
          Client: class { send() { return "mocked"; } },
        }));
        test("t", () => {
          expect(callSend()).toBe("mocked");
          expect(data).toBe("file-contents");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test.concurrent("works under --isolate", async () => {
    const { stderr, exitCode } = await runFixture(
      {
        "fixture.test.ts": `
          import { expect, test, mock } from "bun:test";
          import { callSend } from "./consumer";
          mock.module("./lib", () => ({
            Client: class { send() { return "mocked"; } },
          }));
          test("t", () => { expect(callSend()).toBe("mocked"); });
        `,
      },
      ["--isolate"],
    );
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test.concurrent("imports used only in type position are still elided", async () => {
    const { stderr, exitCode } = await runFixture({
      "fixture.test.ts": `
        import { expect, test, jest } from "bun:test";
        import { OnlyAType } from "this-package-does-not-exist";
        import { callSend } from "./consumer";
        jest.mock("./lib", () => ({
          Client: class { send() { return "mocked"; } },
        }));
        test("t", () => {
          const x: OnlyAType = 1 as any;
          expect(callSend()).toBe("mocked");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("Cannot find");
    expect(exitCode).toBe(0);
  });

  test.concurrent("named/default imports stay live for re-mocks inside tests", async () => {
    const { stderr, exitCode } = await runFixture({
      "fixture.test.ts": `
        import { expect, test, mock } from "bun:test";
        import { value } from "./lib";
        import libDefault from "./lib";
        mock.module("./lib", () => ({ value: "v1", default: "d1" }));
        test("a", () => {
          expect(value).toBe("v1");
          expect(libDefault).toBe("d1");
        });
        test("b", () => {
          mock.module("./lib", () => ({ value: "v2", default: "d2" }));
          expect(value).toBe("v2");
          expect(libDefault).toBe("d2");
        });
      `,
    });
    expect(stderr).toContain("2 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });
});

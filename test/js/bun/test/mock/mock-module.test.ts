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

// https://github.com/oven-sh/bun/issues/7823
// Run in subprocesses so each case observes a clean module registry.
describe.concurrent("mock.restore() reverts mock.module()", () => {
  const depTs = `
    export const getValue = () => "original";
    export const other = 1;
    export default "original-default";
  `;

  async function runFixture(files: Record<string, string>, entries: string[] = ["fixture.test.ts"]) {
    using dir = tempDir("mock-module-restore", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...entries],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function expectFixturePasses(files: Record<string, string>, passes: number, entries?: string[]) {
    const { stderr, exitCode } = await runFixture(files, entries);
    expect(stderr).toContain(` ${passes} pass`);
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  }

  test("restores an already-loaded ESM module's exports", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        import * as dep from "./dep";
        test("t", () => {
          expect(dep.getValue()).toBe("original");
          expect(dep.default).toBe("original-default");
          mock.module("./dep", () => ({
            getValue: () => "mocked",
            default: "mocked-default",
          }));
          expect(dep.getValue()).toBe("mocked");
          expect(dep.default).toBe("mocked-default");
          mock.restore();
          expect(dep.getValue()).toBe("original");
          expect(dep.default).toBe("original-default");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("restores to true originals after multiple re-mocks", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        import { getValue, other } from "./dep";
        test("t", () => {
          expect(getValue()).toBe("original");
          expect(other).toBe(1);
          mock.module("./dep", () => ({ getValue: () => "first" }));
          expect(getValue()).toBe("first");
          // second mock touches a disjoint export; restore must cover both
          mock.module("./dep", () => ({ getValue: () => "second", other: 99 }));
          expect(getValue()).toBe("second");
          expect(other).toBe(99);
          mock.restore();
          expect(getValue()).toBe("original");
          expect(other).toBe(1);
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("restores CJS module.exports", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.cjs": `module.exports = { getValue: () => "original-cjs" };`,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        test("t", () => {
          const dep = require("./dep.cjs");
          expect(dep.getValue()).toBe("original-cjs");
          mock.module("./dep.cjs", () => ({ getValue: () => "mocked-cjs" }));
          expect(require("./dep.cjs").getValue()).toBe("mocked-cjs");
          mock.restore();
          expect(require("./dep.cjs").getValue()).toBe("original-cjs");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("a module first loaded through a mock keeps it; restore only detaches the factories", async () => {
    await expectFixturePasses(
      {
        "dep.ts": depTs,
        "other.ts": `export const name = "real other";`,
        "fixture.test.ts": `
          import { test, expect, mock } from "bun:test";
          test("t", async () => {
            mock.module("./dep.ts", () => ({ getValue: () => "mocked" }));
            mock.module("./other.ts", () => ({ name: "mocked other" }));
            // dep.ts is evaluated from the mock factory; other.ts is never loaded while mocked.
            expect((await import("./dep.ts")).getValue()).toBe("mocked");
            mock.restore();
            expect((await import("./dep.ts")).getValue()).toBe("mocked");
            expect((await import("./other.ts")).name).toBe("real other");
          });
        `,
      },
      1,
    );
  });

  test("beforeEach mock.module + afterEach restore re-mocks a dependency the code under test already imported", async () => {
    // The "Mock Cleanup Patterns" shape from docs/test/mocks.mdx: logger is first loaded through a mock by the
    // module under test, so every later beforeEach has to patch that same module record in place.
    await expectFixturePasses(
      {
        "logger.ts": `export const log = (message: string) => { throw new Error("real logger called: " + message); };`,
        "service.ts": `
          import { log } from "./logger";
          export const run = () => log("ran");
        `,
        "fixture.test.ts": `
          import { test, expect, mock, beforeEach, afterEach } from "bun:test";
          let log: ReturnType<typeof mock>;
          beforeEach(() => {
            log = mock(() => {});
            mock.module("./logger", () => ({ log }));
          });
          afterEach(() => mock.restore());
          test("first", async () => {
            (await import("./service")).run();
            expect(log).toHaveBeenCalledTimes(1);
          });
          test("second gets this test's mock, not the first test's", async () => {
            (await import("./service")).run();
            expect(log).toHaveBeenCalledTimes(1);
          });
        `,
      },
      2,
    );
  });

  test("restores spyOn and mock.module together", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "fixture.test.ts": `
        import { test, expect, mock, spyOn } from "bun:test";
        import * as dep from "./dep";
        test("t", () => {
          const originalOther = dep.other;
          const spy = spyOn(dep, "getValue").mockReturnValue("spied");
          mock.module("./dep", () => ({ other: 42 }));
          expect(dep.getValue()).toBe("spied");
          expect(dep.other).toBe(42);
          mock.restore();
          expect(dep.getValue()).toBe("original");
          expect(dep.other).toBe(originalOther);
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("spyOn and mock.module on the same export restores to the true original", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "fixture.test.ts": `
        import { test, expect, mock, spyOn } from "bun:test";
        import * as dep from "./dep";
        test("spyOn first", () => {
          spyOn(dep, "getValue");
          mock.module("./dep", () => ({ getValue: () => "mocked" }));
          expect(dep.getValue()).toBe("mocked");
          mock.restore();
          expect(dep.getValue()).toBe("original");
        });
        test("mock.module first", () => {
          mock.module("./dep", () => ({ getValue: () => "mocked" }));
          spyOn(dep, "getValue");
          expect(dep.getValue()).toBe("mocked");
          mock.restore();
          expect(dep.getValue()).toBe("original");
        });
      `,
    });
    expect(stderr).toContain("2 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("restores the require cache entry in place while a module born from the mock keeps it", async () => {
    await expectFixturePasses(
      {
        "dep.cjs": `module.exports = { getValue: () => "original-cjs" };`,
        "fixture.test.ts": `
          import { test, expect, mock } from "bun:test";
          test("t", async () => {
            expect(require("./dep.cjs").getValue()).toBe("original-cjs");
            mock.module("./dep.cjs", () => ({ getValue: () => "mocked" }));
            expect(require("./dep.cjs").getValue()).toBe("mocked");
            // First ESM load of dep.cjs happens while mocked, so that record is born from the mock.
            expect((await import("./dep.cjs")).getValue()).toBe("mocked");
            mock.restore();
            expect(require("./dep.cjs").getValue()).toBe("original-cjs");
            expect((await import("./dep.cjs")).getValue()).toBe("mocked");
          });
        `,
      },
      1,
    );
  });

  test("leaves Bun.plugin virtual modules alone", async () => {
    const { stderr, exitCode } = await runFixture({
      "preload.ts": `
        Bun.plugin({
          name: "p",
          setup(build) {
            build.module("plugin-virtual", () => ({ exports: { hi: 123 }, loader: "object" }));
          },
        });
      `,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        test("t", () => {
          expect(require("plugin-virtual").hi).toBe(123);
          mock.restore();
          expect(require("plugin-virtual").hi).toBe(123);
        });
      `,
      "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("reinstates a Bun.plugin virtual module that mock.module() overwrote", async () => {
    const { stderr, exitCode } = await runFixture({
      "preload.ts": `
        Bun.plugin({
          name: "p",
          setup(build) {
            build.module("plugin-virtual", () => ({ exports: { hi: 123 }, loader: "object" }));
          },
        });
      `,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        test("t", () => {
          expect(require("plugin-virtual").hi).toBe(123);
          mock.module("plugin-virtual", () => ({ hi: 999 }));
          expect(require("plugin-virtual").hi).toBe(999);
          mock.restore();
          expect(require("plugin-virtual").hi).toBe(123);
        });
      `,
      "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("preload-installed mock.module() survives mock.restore()", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./dep.ts", () => ({ getValue: () => "preload-mock" }));
      `,
      "fixture.test.ts": `
        import { test, expect, mock, afterEach } from "bun:test";
        import { getValue } from "./dep.ts";
        afterEach(() => mock.restore());
        test("first", () => {
          expect(getValue()).toBe("preload-mock");
        });
        test("second still sees preload mock", () => {
          expect(getValue()).toBe("preload-mock");
        });
      `,
      "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
    });
    expect(stderr).toContain("2 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("test-time re-mock of a preload-installed mock restores to the preload mock", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./dep.ts", () => ({ getValue: () => "preload-mock" }));
      `,
      "fixture.test.ts": `
        import { test, expect, mock, afterEach } from "bun:test";
        import { getValue } from "./dep.ts";
        afterEach(() => mock.restore());
        test("a overrides", () => {
          mock.module("./dep.ts", () => ({ getValue: () => "per-test" }));
          expect(getValue()).toBe("per-test");
        });
        test("b sees preload mock again", async () => {
          expect(getValue()).toBe("preload-mock");
          expect((await import("./dep.ts")).getValue()).toBe("preload-mock");
        });
      `,
      "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
    });
    expect(stderr).toContain("2 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });
  test("mocks installed at the file's top level survive restore; mocks installed from hooks do not", async () => {
    await expectFixturePasses(
      {
        "dep.ts": depTs,
        "hooked.ts": `export const name = "real hooked";`,
        "fixture.test.ts": `
          import { test, expect, mock, beforeAll, afterEach } from "bun:test";
          import { getValue } from "./dep";
          import { name } from "./hooked";
          mock.module("./dep", () => ({ getValue: () => "top-level mock" }));
          beforeAll(() => {
            mock.module("./hooked", () => ({ name: "hook mock" }));
          });
          afterEach(() => mock.restore());
          test("first", () => {
            expect(getValue()).toBe("top-level mock");
            expect(name).toBe("hook mock");
          });
          test("second", () => {
            expect(getValue()).toBe("top-level mock");
            expect(name).toBe("real hooked");
          });
        `,
      },
      2,
    );
  });

  test("jest.mock at the top level survives afterEach(jest.restoreAllMocks)", async () => {
    await expectFixturePasses(
      {
        "dep.ts": depTs,
        "fixture.test.ts": `
          import { test, expect, jest, afterEach } from "bun:test";
          import { getValue } from "./dep";
          jest.mock("./dep", () => ({ getValue: () => "jest mock" }));
          afterEach(() => jest.restoreAllMocks());
          test("first", () => expect(getValue()).toBe("jest mock"));
          test("second", () => expect(getValue()).toBe("jest mock"));
        `,
      },
      2,
    );
  });

  test("mocks installed in a describe body survive restore", async () => {
    await expectFixturePasses(
      {
        "dep.ts": depTs,
        "fixture.test.ts": `
          import { test, expect, mock, describe, afterEach } from "bun:test";
          import { getValue } from "./dep";
          describe("suite", () => {
            mock.module("./dep", () => ({ getValue: () => "describe mock" }));
            afterEach(() => mock.restore());
            test("first", () => expect(getValue()).toBe("describe mock"));
            test("second", () => expect(getValue()).toBe("describe mock"));
          });
        `,
      },
      2,
    );
  });

  test("a test-time mock on top of a top-level mock restores to the top-level mock", async () => {
    await expectFixturePasses(
      {
        "dep.ts": depTs,
        "fixture.test.ts": `
          import { test, expect, mock, afterEach } from "bun:test";
          import { getValue } from "./dep";
          mock.module("./dep", () => ({ getValue: () => "file mock" }));
          afterEach(() => mock.restore());
          test("override", () => {
            mock.module("./dep", () => ({ getValue: () => "test mock" }));
            expect(getValue()).toBe("test mock");
          });
          test("back to the file's mock", async () => {
            expect(getValue()).toBe("file mock");
            expect((await import("./dep")).getValue()).toBe("file mock");
          });
        `,
      },
      2,
    );
  });

  test("a barrel and its leaf mocked in the same test restore to the real export in either order", async () => {
    await expectFixturePasses(
      {
        "leaf.ts": `export const value = "real";`,
        "barrel.ts": `export { value } from "./leaf";`,
        "fixture.test.ts": `
          import { test, expect, mock, afterEach } from "bun:test";
          import * as leaf from "./leaf";
          import * as barrel from "./barrel";
          afterEach(() => mock.restore());
          test("leaf first", () => {
            mock.module("./leaf", () => ({ value: "leaf mock" }));
            mock.module("./barrel", () => ({ value: "barrel mock" }));
            expect([leaf.value, barrel.value]).toEqual(["barrel mock", "barrel mock"]);
            mock.restore();
            expect([leaf.value, barrel.value]).toEqual(["real", "real"]);
          });
          test("barrel first", () => {
            mock.module("./barrel", () => ({ value: "barrel mock" }));
            mock.module("./leaf", () => ({ value: "leaf mock" }));
            expect([leaf.value, barrel.value]).toEqual(["leaf mock", "leaf mock"]);
            mock.restore();
            expect([leaf.value, barrel.value]).toEqual(["real", "real"]);
          });
        `,
      },
      2,
    );
  });

  test("mock.module on a module that is still evaluating (import cycle) does not throw on its TDZ bindings", async () => {
    await expectFixturePasses(
      {
        "a.ts": `
          import "./b";
          export const value = "from a";
        `,
        "b.ts": `
          import { mock } from "bun:test";
          import "./a";
          // a.ts is linked but has not run yet, so the binding for value is still in its TDZ.
          mock.module("./a", () => ({ value: "mocked" }));
          export const loaded = true;
        `,
        "fixture.test.ts": `
          import { test, expect, mock } from "bun:test";
          test("t", async () => {
            const a = await import("./a");
            expect(a.value).toBe("from a");
            mock.restore();
            expect(a.value).toBe("from a");
          });
        `,
      },
      1,
    );
  });
  test("a file's top-level mock is not undone by log entries an earlier file's test left behind", async () => {
    // Without --isolate both files share one process. a.test.ts mocks from a test and never restores (a no-op on
    // older versions, so existing suites do this); b.test.ts's own setup must still survive its afterEach(restore).
    await expectFixturePasses(
      {
        "dep.ts": depTs,
        "dep.cjs": `module.exports = { getValue: () => "original-cjs" };`,
        "a.test.ts": `
          import { test, expect, mock } from "bun:test";
          import { getValue } from "./dep";
          test("mocks without restoring", () => {
            mock.module("./dep", () => ({ getValue: () => "a's mock" }));
            mock.module("./dep.cjs", () => ({ getValue: () => "a's cjs mock" }));
            expect(getValue()).toBe("a's mock");
            expect(require("./dep.cjs").getValue()).toBe("a's cjs mock");
          });
        `,
        "b.test.ts": `
          import { test, expect, mock, afterEach } from "bun:test";
          import { getValue } from "./dep";
          mock.module("./dep", () => ({ getValue: () => "b's mock" }));
          mock.module("./dep.cjs", () => ({ getValue: () => "b's cjs mock" }));
          afterEach(() => mock.restore());
          test("first", () => {
            expect(getValue()).toBe("b's mock");
            expect(require("./dep.cjs").getValue()).toBe("b's cjs mock");
          });
          test("second", () => {
            expect(getValue()).toBe("b's mock");
            expect(require("./dep.cjs").getValue()).toBe("b's cjs mock");
          });
        `,
      },
      3,
      ["a.test.ts", "b.test.ts"],
    );
  });
});

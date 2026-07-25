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

  async function runFixture(files: Record<string, string>, entry = "fixture.test.ts") {
    using dir = tempDir("mock-module-restore", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
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

  test("mock installed before first load is cleared so next import loads the real module", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        test("t", async () => {
          mock.module("./dep.ts", () => ({ getValue: () => "mocked" }));
          expect((await import("./dep.ts")).getValue()).toBe("mocked");
          mock.restore();
          expect((await import("./dep.ts")).getValue()).toBe("original");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
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

  test("re-mock after the first mock preceded first load still restores to the real module", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.ts": depTs,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        test("t", async () => {
          mock.module("./dep.ts", () => ({ getValue: () => "first" }));
          expect((await import("./dep.ts")).getValue()).toBe("first");
          mock.module("./dep.ts", () => ({ getValue: () => "second" }));
          expect((await import("./dep.ts")).getValue()).toBe("second");
          mock.restore();
          expect((await import("./dep.ts")).getValue()).toBe("original");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
  });

  test("evicts the loader that was populated after mock.module() when the other was patched in place", async () => {
    const { stderr, exitCode } = await runFixture({
      "dep.cjs": `module.exports = { getValue: () => "original-cjs" };`,
      "fixture.test.ts": `
        import { test, expect, mock } from "bun:test";
        test("t", async () => {
          expect(require("./dep.cjs").getValue()).toBe("original-cjs");
          mock.module("./dep.cjs", () => ({ getValue: () => "mocked" }));
          expect(require("./dep.cjs").getValue()).toBe("mocked");
          expect((await import("./dep.cjs")).getValue()).toBe("mocked");
          mock.restore();
          expect(require("./dep.cjs").getValue()).toBe("original-cjs");
          expect((await import("./dep.cjs")).getValue()).toBe("original-cjs");
        });
      `,
    });
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("fail)");
    expect(exitCode).toBe(0);
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
});

// Tests for the vitest compatibility surface of bun:test (issue #40990).
// `bun test` aliases the "vitest" specifier to "bun:test", so this file
// imports through the alias on purpose.
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import * as vitestModule from "vitest";
import { bench, describe, expect, onTestFailed, suite, test, vi, vitest } from "vitest";

suite("suite is describe", () => {
  test("suite registers a describe block", () => {
    expect(suite).toBe(describe as unknown as typeof suite);
  });
});

suite.each([[1], [2]])("suite.each %i", n => {
  test("runs", () => {
    expect(n).toBeGreaterThan(0);
  });
});

test("vitest is an alias of vi", () => {
  expect(vitest).toBe(vi);
});

describe("unimplemented exports are throwing stubs, not missing", () => {
  const stubNames = [
    "assert",
    "assertType",
    "aroundAll",
    "aroundEach",
    "BenchmarkRunner",
    "chai",
    "createExpect",
    "EvaluatedModules",
    "inject",
    "recordArtifact",
    "should",
    "Snapshots",
    "TestRunner",
  ] as const;

  test.each([...stubNames])("%s is exported and throws on call with its own name", name => {
    const member = (vitestModule as Record<string, unknown>)[name];
    expect(typeof member).toBe("function");
    expect(() => (member as () => void)()).toThrow(`${name}() is not yet implemented in bun:test`);
  });
});

test("bench is a no-op that never runs its callback", () => {
  expect(typeof bench).toBe("function");
  expect(() =>
    bench("name", () => {
      throw new Error("bench callback must not run");
    }),
  ).not.toThrow();
});

describe("vi members", () => {
  test("vi.setSystemTime and vi.getMockedSystemTime", () => {
    expect(vi.getMockedSystemTime()).toBeNull();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    try {
      expect(Date.now()).toBe(1577836800000);
      const mocked = vi.getMockedSystemTime();
      expect(mocked).toBeInstanceOf(Date);
      expect(mocked!.getTime()).toBe(1577836800000);
    } finally {
      vi.setSystemTime();
    }
    expect(vi.getMockedSystemTime()).toBeNull();
  });

  test("vi.getRealSystemTime ignores the mocked clock", () => {
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    try {
      const real = vi.getRealSystemTime();
      expect(typeof real).toBe("number");
      expect(real).toBeGreaterThan(1577836800000);
    } finally {
      vi.setSystemTime();
    }
  });

  test("vi.isMockFunction", () => {
    expect(vi.isMockFunction(vi.fn())).toBe(true);
    expect(vi.isMockFunction(vi.spyOn({ a() {} }, "a"))).toBe(true);
    expect(vi.isMockFunction(() => {})).toBe(false);
    expect(vi.isMockFunction(undefined)).toBe(false);
    expect(vi.isMockFunction(42)).toBe(false);
  });

  test("vi.mocked returns its argument", () => {
    const fn = vi.fn();
    expect(vi.mocked(fn)).toBe(fn);
    const plain = {};
    expect(vi.mocked(plain)).toBe(plain);
  });

  test("vi.stubEnv and vi.unstubAllEnvs", () => {
    process.env.VITEST_COMPAT_EXISTING = "original";
    delete process.env.VITEST_COMPAT_ADDED;
    try {
      vi.stubEnv("VITEST_COMPAT_EXISTING", "stubbed");
      vi.stubEnv("VITEST_COMPAT_EXISTING", "stubbed-twice");
      vi.stubEnv("VITEST_COMPAT_ADDED", "added");
      expect(process.env.VITEST_COMPAT_EXISTING).toBe("stubbed-twice");
      expect(process.env.VITEST_COMPAT_ADDED).toBe("added");

      vi.unstubAllEnvs();
      expect(process.env.VITEST_COMPAT_EXISTING).toBe("original");
      expect(process.env.VITEST_COMPAT_ADDED).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      delete process.env.VITEST_COMPAT_EXISTING;
      delete process.env.VITEST_COMPAT_ADDED;
    }
  });

  test("vi.stubEnv(name, undefined) removes the variable", () => {
    process.env.VITEST_COMPAT_REMOVE = "here";
    try {
      vi.stubEnv("VITEST_COMPAT_REMOVE", undefined);
      expect(process.env.VITEST_COMPAT_REMOVE).toBeUndefined();
      vi.unstubAllEnvs();
      expect(process.env.VITEST_COMPAT_REMOVE).toBe("here");
    } finally {
      vi.unstubAllEnvs();
      delete process.env.VITEST_COMPAT_REMOVE;
    }
  });

  test("vi.stubGlobal and vi.unstubAllGlobals", () => {
    const originalFetch = globalThis.fetch;
    try {
      vi.stubGlobal("__vitest_compat_new__", 42);
      expect((globalThis as Record<string, unknown>).__vitest_compat_new__).toBe(42);

      vi.stubGlobal("fetch", "not-a-function");
      expect(globalThis.fetch as unknown).toBe("not-a-function");

      vi.unstubAllGlobals();
      expect("__vitest_compat_new__" in globalThis).toBe(false);
      expect(globalThis.fetch).toBe(originalFetch);
    } finally {
      vi.unstubAllGlobals();
      globalThis.fetch = originalFetch;
      delete (globalThis as Record<string, unknown>).__vitest_compat_new__;
    }
  });

  test.skipIf(!isWindows)("vi.stubEnv dedups names case-insensitively on Windows", () => {
    process.env.VITEST_COMPAT_CASE = "original";
    try {
      vi.stubEnv("VITEST_COMPAT_CASE", "one");
      vi.stubEnv("vitest_compat_case", "two");
      expect(process.env.VITEST_COMPAT_CASE).toBe("two");
      vi.unstubAllEnvs();
      expect(process.env.VITEST_COMPAT_CASE).toBe("original");
    } finally {
      vi.unstubAllEnvs();
      delete process.env.VITEST_COMPAT_CASE;
    }
  });

  test("vi.stubEnv('TZ', ...) fires the timezone side effect", () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "Etc/UTC";
    try {
      vi.stubEnv("TZ", "Etc/GMT-2");
      expect(new Date(0).getTimezoneOffset()).toBe(-120);
      vi.unstubAllEnvs();
      expect(new Date(0).getTimezoneOffset()).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      if (originalTZ === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTZ;
      }
    }
  });

  test("vi.stubGlobal(name, undefined) defines undefined instead of deleting", () => {
    const original = globalThis.structuredClone;
    try {
      vi.stubGlobal("structuredClone", undefined);
      expect(globalThis.structuredClone).toBeUndefined();
      expect("structuredClone" in globalThis).toBe(true);
      vi.unstubAllGlobals();
      expect(globalThis.structuredClone).toBe(original);
    } finally {
      vi.unstubAllGlobals();
      globalThis.structuredClone = original;
    }
  });

  test("an integer-like name stubs and restores without crashing", () => {
    const g = globalThis as Record<string, unknown>;
    try {
      vi.stubGlobal("0", "zero");
      expect(g["0"]).toBe("zero");
      vi.unstubAllGlobals();
      expect("0" in g).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      delete g["0"];
    }
  });

  test("stubbing an inherited name restores by delete", () => {
    const g = globalThis as Record<string, unknown>;
    try {
      vi.stubGlobal("hasOwnProperty", "stubbed");
      expect(g.hasOwnProperty).toBe("stubbed");
      vi.unstubAllGlobals();
      // The name only existed on Object.prototype, so restore removes the
      // own property instead of copying the inherited value onto globalThis.
      expect(Object.getOwnPropertyDescriptor(globalThis, "hasOwnProperty")).toBeUndefined();
      expect(typeof g.hasOwnProperty).toBe("function");
    } finally {
      vi.unstubAllGlobals();
      delete g.hasOwnProperty;
    }
  });

  test("restore keeps a global that was already undefined", () => {
    const g = globalThis as Record<string, unknown>;
    try {
      g.__vitest_compat_undef__ = undefined;
      vi.stubGlobal("__vitest_compat_undef__", "stubbed");
      expect(g.__vitest_compat_undef__).toBe("stubbed");
      vi.unstubAllGlobals();
      // The property existed with the value undefined, so restore keeps it
      // instead of deleting it.
      expect("__vitest_compat_undef__" in g).toBe(true);
      expect(g.__vitest_compat_undef__).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      delete g.__vitest_compat_undef__;
    }
  });

  test("non-ASCII names stub and restore correctly", () => {
    const g = globalThis as Record<string, unknown>;
    try {
      vi.stubGlobal("π", 3.14);
      expect(g["π"]).toBe(3.14);
      vi.stubEnv("ÜBER_COMPAT", "ja");
      expect(process.env["ÜBER_COMPAT"]).toBe("ja");

      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      expect("π" in g).toBe(false);
      expect(process.env["ÜBER_COMPAT"]).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      delete g["π"];
      delete process.env["ÜBER_COMPAT"];
    }
  });

  test("stub calls chain like vitest's utils object", () => {
    try {
      expect(vi.stubEnv("VITEST_COMPAT_CHAIN", "1").stubGlobal("__vitest_compat_chain__", 2)).toBe(vi);
      expect(vi.unstubAllGlobals().unstubAllEnvs()).toBe(vi);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  test("vi.stubEnv rejects a non-string name", () => {
    expect(() => (vi.stubEnv as (k: unknown, v: unknown) => void)(42, "x")).toThrow(
      "vi.stubEnv() expects a string name",
    );
  });
});

describe("async fake timer variants", () => {
  test("advanceTimersByTimeAsync flushes an awaiting callback", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      setTimeout(async () => {
        await Promise.resolve();
        done = true;
      }, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("advanceTimersByTimeAsync flushes microtasks between timers", async () => {
    // Pins vitest semantics: timer A's continuation (after an await) schedules
    // timer B inside the advanced window, and B must fire in the same advance.
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      setTimeout(async () => {
        order.push("A");
        await Promise.resolve();
        setTimeout(() => order.push("B"), 50);
      }, 100);
      await vi.advanceTimersByTimeAsync(200);
      expect(order).toEqual(["A", "B"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("runAllTimersAsync and friends resolve", async () => {
    vi.useFakeTimers();
    try {
      let count = 0;
      setTimeout(() => count++, 1);
      setTimeout(() => count++, 2);
      await vi.runAllTimersAsync();
      expect(count).toBe(2);

      setTimeout(() => count++, 1);
      await vi.advanceTimersToNextTimerAsync();
      expect(count).toBe(3);

      setTimeout(() => count++, 1);
      await vi.runOnlyPendingTimersAsync();
      expect(count).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  test("jest object also has the async variants", () => {
    const { jest } = vitestModule as unknown as { jest: Record<string, unknown> };
    expect(typeof jest.advanceTimersByTimeAsync).toBe("function");
    expect(typeof jest.runAllTimersAsync).toBe("function");
    expect(typeof jest.runOnlyPendingTimersAsync).toBe("function");
    expect(typeof jest.advanceTimersToNextTimerAsync).toBe("function");
  });
});

describe("test and describe modifiers", () => {
  test.fails("test.fails expects the test to fail", () => {
    throw new Error("expected failure");
  });

  test.runIf(true)("test.runIf(true) runs", () => {
    expect(true).toBe(true);
  });

  test.runIf(false)("test.runIf(false) skips", () => {
    throw new Error("must not run");
  });

  describe.sequential("describe.sequential works", () => {
    test("runs", () => {
      expect(true).toBe(true);
    });
  });

  test.sequential("test.sequential runs", () => {
    expect(true).toBe(true);
  });
});

describe("onTestFailed", () => {
  let passHookRan = false;
  test("does not run after a passing test", () => {
    onTestFailed(() => {
      passHookRan = true;
    });
    expect(true).toBe(true);
  });
  test("(checked in the next test)", () => {
    expect(passHookRan).toBe(false);
  });

  test.concurrent("runs after a failing test, in registration context", async () => {
    using dir = tempDir("vitest-compat-failhook", {
      "failhook.test.ts": `
        import { test, onTestFailed, onTestFinished, expect } from "vitest";
        test("fails sync", () => {
          onTestFailed(() => console.log("FAILED_HOOK_SYNC"));
          onTestFinished(() => console.log("FINISHED_HOOK"));
          expect(1).toBe(2);
        });
        test("fails async", async () => {
          onTestFailed(async () => {
            await Promise.resolve();
            console.log("FAILED_HOOK_ASYNC");
          });
          throw new Error("boom");
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "failhook.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("FAILED_HOOK_SYNC");
    expect(stdout).toContain("FINISHED_HOOK");
    expect(stdout).toContain("FAILED_HOOK_ASYNC");
    expect(stderr).toContain("2 fail");
    expect(exitCode).toBe(1);
  });

  test.concurrent("runs for failure modes decided at sequence completion", async () => {
    using dir = tempDir("vitest-compat-failhook-deferred", {
      "deferred.test.ts": `
        import { test, onTestFailed, onTestFinished, expect } from "vitest";
        test("assertion count mismatch", () => {
          onTestFailed(() => console.log("FAILED_HOOK_ASSERTIONS"));
          expect.assertions(2);
          expect(1).toBe(1);
        });
        test.fails("test.fails whose body passes", () => {
          onTestFailed(() => console.log("FAILED_HOOK_FAILS_PASSED"));
          expect(1).toBe(1);
        });
        test.fails("test.fails whose body throws", () => {
          onTestFailed(() => console.log("FAILED_HOOK_FAILS_THREW"));
          throw new Error("expected");
        });
        test("onTestFinished failure still triggers an earlier onTestFailed", () => {
          onTestFailed(() => console.log("FAILED_AFTER_FINISHED"));
          onTestFinished(() => {
            throw new Error("finished boom");
          });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "deferred.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("FAILED_HOOK_ASSERTIONS");
    expect(stdout).toContain("FAILED_HOOK_FAILS_PASSED");
    // A test.fails test whose body throws ends up passing, so its hook must not run.
    expect(stdout).not.toContain("FAILED_HOOK_FAILS_THREW");
    expect(stdout).toContain("FAILED_AFTER_FINISHED");
    expect(stderr).toContain("3 fail");
    expect(exitCode).toBe(1);
  });

  test.concurrent("cannot be called outside of a test", async () => {
    using dir = tempDir("vitest-compat-failhook-outside", {
      "outside.test.ts": `
        import { test, onTestFailed } from "vitest";
        onTestFailed(() => {});
        test("never runs", () => {});
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "outside.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Cannot call onTestFailed() outside of a test");
    // The file fails at load, so no test registers or passes.
    expect(stderr).not.toContain("(pass)");
    expect(exitCode).toBe(1);
  });
});

test.concurrent("stub stores reset at the --isolate file boundary", async () => {
  using dir = tempDir("vitest-compat-isolate-stubs", {
    "a.test.ts": `
      import { test, vi, expect } from "vitest";
      test("stub env and global, never unstub", () => {
        process.env.ISO_LEAK = "original";
        vi.stubEnv("ISO_LEAK", "stubbed");
        vi.stubGlobal("structuredClone", "broken");
        expect(process.env.ISO_LEAK).toBe("stubbed");
      });
    `,
    "b.test.ts": `
      import { test, vi, expect } from "vitest";
      test("previous file's stub records are gone", () => {
        // The realm swap rebuilt process.env, and the boundary cleared the
        // stub stores: unstubAll* must be no-ops, not restore stale values
        // recorded in the previous file's realm.
        const cloneBefore = globalThis.structuredClone;
        expect(typeof cloneBefore).toBe("function");
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        expect(process.env.ISO_LEAK).toBeUndefined();
        expect(globalThis.structuredClone).toBe(cloneBefore);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "a.test.ts", "b.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).not.toContain("ISO_LEAK");
  expect(stderr).toContain("2 pass");
  expect(exitCode).toBe(0);
});

test.concurrent("a static import of a previously missing export no longer kills the file", async () => {
  using dir = tempDir("vitest-compat-static-import", {
    "static-import.test.ts": `
      import { test, suite, vitest, onTestFailed, assert, chai } from "vitest";
      suite("loads", () => {
        test("passes", () => {
          vitest.fn();
          // assert and chai are importable; only calling them throws.
          void assert;
          void chai;
          void onTestFailed;
        });
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "static-import.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("SyntaxError");
  expect(stdout).not.toContain("SyntaxError");
  expect(exitCode).toBe(0);
});

test.concurrent("vi.stubEnv outside bun test throws", async () => {
  using dir = tempDir("vitest-compat-stub-outside", {
    "stub-outside.ts": `
      import { vi } from "bun:test";
      try {
        vi.stubEnv("X", "1");
        console.log("NO_THROW");
      } catch (e) {
        console.log("THREW:", (e as Error).message);
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "stub-outside.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("THREW: vi.stubEnv() can only be used in bun test");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

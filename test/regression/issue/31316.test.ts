// https://github.com/oven-sh/bun/issues/31316
//
// `mock.module()` mutated a process-global registry on the `ZigGlobalObject`
// that was never reset between test files. Running two test files in the
// same `bun test` process leaked a partial mock from the first file into the
// second — which broke ESM binding to the dropped exports.
//
// Per-file scoping matches Vitest and Jest semantics and removes the need to
// spawn one process per file for correctness under `bun test`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("mock.module per-file scoping", () => {
  test("mock.module does not leak into sibling test files", async () => {
    using dir = tempDir("issue-31316", {
      "dep.ts": `
        export const a = "REAL_A";
        export const b = "REAL_B";
      `,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ a: "MOCK_A" }));
        import { a } from "./dep";
        it("A sees mock", () => {
          expect(a).toBe("MOCK_A");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { a, b } from "./dep";
        it("B sees real", () => {
          expect(a).toBe("REAL_A");
          expect(b).toBe("REAL_B");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `bun test` writes pass/fail counts to stderr; stdout is captured so it
    // surfaces in failure logs alongside stderr.
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("mock.module still persists within its own file", async () => {
    // Regression guard: the per-file cleanup should run at file boundaries,
    // not between individual tests in the same file.
    using dir = tempDir("issue-31316-same-file", {
      "dep.ts": `export const v = "REAL";`,
      "same.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ v: "MOCK" }));
        import { v } from "./dep";
        it("first", () => { expect(v).toBe("MOCK"); });
        it("second (same file)", () => { expect(v).toBe("MOCK"); });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "same.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("preload-installed mock.module persists across files", async () => {
    // `mock.module()` from a `--preload` script is process-lifetime, not
    // per-test-file. The per-file cleanup must leave it alone.
    using dir = tempDir("issue-31316-preload", {
      "dep.ts": `export const v = "REAL";`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./dep", () => ({ v: "PRELOAD_MOCK" }));
      `,
      "one.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        it("one", () => { expect(v).toBe("PRELOAD_MOCK"); });
      `,
      "two.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        it("two", () => { expect(v).toBe("PRELOAD_MOCK"); });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "one.test.ts", "two.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("transient mock is cleared through a re-export barrel", async () => {
    // `mock.module('./dep', ...)` writes into `./dep`'s module environment
    // via `overrideExportValue`. A cached intermediate `./consumer` that
    // re-exports from `./dep` binds through that same env slot, so if we
    // only evict `./dep` the re-exporter still observes the mocked value in
    // the next file. Per-file teardown now restores the env slot *before*
    // evicting so re-exporters revert to the real module.
    using dir = tempDir("issue-31316-reexport", {
      "dep.ts": `export const v = "REAL";`,
      "consumer.ts": `export { v } from "./dep";`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        import { v } from "./consumer";
        mock.module("./dep", () => ({ v: "MOCK_A" }));
        it("A sees the mock through consumer", () => {
          expect(v).toBe("MOCK_A");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./consumer";
        it("B sees real through consumer", () => {
          expect(v).toBe("REAL");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("test-file mock that shadows a preload mock restores the preload mock", async () => {
    // When a test file re-mocks the same path a `--preload` already mocked,
    // teardown must restore the preload's mock — not leak the test file's
    // mock into siblings.
    using dir = tempDir("issue-31316-preload-shadow", {
      "dep.ts": `export const v = "REAL";`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./dep", () => ({ v: "PRELOAD" }));
      `,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ v: "A_MOCK" }));
        import { v } from "./dep";
        it("A sees its own mock", () => {
          expect(v).toBe("A_MOCK");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        it("B sees the preload mock, not A's", () => {
          expect(v).toBe("PRELOAD");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("mock.module inside a preload beforeAll persists across files", async () => {
    // A hook registered during --preload runs once, during the first file's
    // execution phase (after vm.is_in_preload is cleared). Mocks it installs
    // must still be process-lifetime: the hook never re-runs for later files.
    using dir = tempDir("issue-31316-preload-hook", {
      "dep.ts": `export const v = "REAL";`,
      "preload.ts": `
        import { beforeAll, mock } from "bun:test";
        beforeAll(async () => {
          await Promise.resolve();
          mock.module("./dep", () => ({ v: "PRELOAD_HOOK" }));
        });
      `,
      "one.test.ts": `
        import { it, expect } from "bun:test";
        it("one", async () => {
          const { v } = await import("./dep");
          expect(v).toBe("PRELOAD_HOOK");
        });
      `,
      "two.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        it("two", () => { expect(v).toBe("PRELOAD_HOOK"); });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "one.test.ts", "two.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("mock installed before first load is cleared through a dynamically imported barrel", async () => {
    // When mock.module() runs before ./dep was ever loaded, a later dynamic
    // import materializes ./dep's module record *from the mock factory* —
    // there are no original env values to restore. The cached barrel binding
    // into that record must be evicted transitively.
    using dir = tempDir("issue-31316-mock-born", {
      "dep.ts": `export const v = "REAL";`,
      "consumer.ts": `export { v } from "./dep";`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ v: "MOCK_A" }));
        it("A sees mock through dynamically imported consumer", async () => {
          const { v } = await import("./consumer");
          expect(v).toBe("MOCK_A");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./consumer";
        it("B sees real through consumer", () => {
          expect(v).toBe("REAL");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("require() of a preload-shadowed path sees the preload mock in the next file", async () => {
    // Install writes the transient mock's exports in place into the cached
    // CJS module; teardown must drop that require-cache entry so the next
    // file's require() re-runs the restored preload factory.
    using dir = tempDir("issue-31316-preload-shadow-cjs", {
      "dep.ts": `export const v = "REAL";`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./dep", () => ({ v: "PRELOAD" }));
      `,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        const before = require("./dep");
        mock.module("./dep", () => ({ v: "A_MOCK" }));
        it("A sees its own mock via require", () => {
          expect(before.v).toBe("A_MOCK");
          expect(require("./dep").v).toBe("A_MOCK");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        it("B sees the preload mock via require", () => {
          expect(require("./dep").v).toBe("PRELOAD");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("re-mocking the same path with disjoint exports restores both through a barrel", async () => {
    // The first mock overrides `a`, the second overrides `b`. Teardown must
    // restore each export from the snapshot taken the first time *that name*
    // was overridden, not discard the second snapshot wholesale.
    using dir = tempDir("issue-31316-disjoint-remock", {
      "dep.ts": `
        export const a = "REAL_A";
        export const b = "REAL_B";
      `,
      "consumer.ts": `export { a, b } from "./dep";`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        import { a, b } from "./consumer";
        mock.module("./dep", () => ({ a: "M1" }));
        mock.module("./dep", () => ({ b: "M2" }));
        it("A sees both mocks", () => {
          expect(a).toBe("M1");
          expect(b).toBe("M2");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { a, b } from "./consumer";
        it("B sees both real values through consumer", () => {
          expect(a).toBe("REAL_A");
          expect(b).toBe("REAL_B");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("preload-shadowing mock installed before first load is cleared on teardown", async () => {
    // Preload mocks ./dep; the test file re-mocks it before anything loaded
    // it, then dynamically imports it (materializing the record from the
    // transient factory). Teardown must evict that record so the next file
    // resolves through the restored preload shim.
    using dir = tempDir("issue-31316-preload-shadow-dynamic", {
      "dep.ts": `export const v = "REAL";`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./dep", () => ({ v: "PRELOAD" }));
      `,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ v: "A_MOCK" }));
        it("A sees its own mock via dynamic import", async () => {
          const { v } = await import("./dep");
          expect(v).toBe("A_MOCK");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        it("B sees the preload mock", () => {
          expect(v).toBe("PRELOAD");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("CJS consumer that captured a mock-born value is re-run in the next file", async () => {
    // A pure-CJS consumer copies values out of the mocked module at require
    // time and never appears in the ESM registry, so clearing the mock can't
    // restore it in place — teardown must evict it from the require cache so
    // the next file's require() re-runs it against the real module.
    using dir = tempDir("issue-31316-cjs-capture", {
      "dep.ts": `export const v = "REAL";`,
      "consumer.cjs": `module.exports.v = require("./dep").v;`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ v: "MOCK_A" }));
        it("A sees the captured mock value", () => {
          expect(require("./consumer.cjs").v).toBe("MOCK_A");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        it("B sees the captured real value", () => {
          expect(require("./consumer.cjs").v).toBe("REAL");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("mock.module inside a preload beforeEach is scoped per file", async () => {
    // Per-test hooks registered in preload run inside test sequences and can
    // interleave with concurrent test bodies, so their mocks are transient —
    // they re-run before every test anyway. Observable contract: the next
    // file's *top-level import* binds the real module (a persistent mock
    // would shim it at import time), and the re-run hook re-installs the
    // mock before the test body executes.
    using dir = tempDir("issue-31316-preload-each", {
      "dep.ts": `export const v = "REAL";`,
      "preload.ts": `
        import { beforeEach, mock } from "bun:test";
        beforeEach(() => {
          mock.module("./dep", () => ({ v: "EACH_MOCK" }));
        });
      `,
      "a.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        it("a", () => { expect(v).toBe("EACH_MOCK"); });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./dep";
        const atImportTime = v;
        it("b", () => {
          expect(atImportTime).toBe("REAL");
          expect(v).toBe("EACH_MOCK");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("re-mocking a mock-born path still evicts its cached importers", async () => {
    // The first mock installs before ./dep is loaded (mock-born); a dynamic
    // import materializes dep from the factory; a second mock then finds the
    // mock-born registry entry. Snapshotting that entry would record the
    // first mock's values as "originals" and suppress the transitive
    // eviction, leaking M1 into the next file through the cached barrel.
    using dir = tempDir("issue-31316-remock-born", {
      "dep.ts": `export const v = "REAL";`,
      "consumer.ts": `export { v } from "./dep";`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./dep", () => ({ v: "M1" }));
        it("a", async () => {
          const { v } = await import("./consumer");
          expect(v).toBe("M1");
          mock.module("./dep", () => ({ v: "M2" }));
          const { v: v2 } = await import("./consumer");
          expect(v2).toBe("M2");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        import { v } from "./consumer";
        it("b sees real through consumer", () => {
          expect(v).toBe("REAL");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("mocking a dep that was require-cached before the mock keeps pre-mock requirers cached", async () => {
    // service.cjs required ./config during --preload and captured the real
    // value; a later transient mock of ./config replaces the cache entry's
    // exports object in place, so service's captured values stay correct.
    // Teardown must not evict service (and its ancestors) through config's
    // m_parent back-edge — that re-runs preload side effects every file.
    using dir = tempDir("issue-31316-premock-parent", {
      "config.ts": `export const key = "REAL";`,
      "service.cjs": `
        const { key } = require("./config");
        console.log("service evaluated");
        module.exports = { key };
      `,
      "preload.ts": `require("./service.cjs");`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        import { key } from "./config";
        mock.module("./config", () => ({ key: "MOCK" }));
        it("a sees mock", () => {
          expect(key).toBe("MOCK");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        it("b gets the cached service", () => {
          expect(require("./service.cjs").key).toBe("REAL");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("service evaluated").length - 1).toBe(1);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("mocking a plain-CJS dep that was require-cached before the mock keeps pre-mock requirers cached", async () => {
    // Same as above but the mocked dep is plain CJS, so the pre-mock
    // requirer holds an m_children edge to the kept cache entry (not just
    // the m_parent back-edge). Teardown must not poison the kept entry, or
    // the transitive CJS walk evicts and re-runs the preload requirer.
    using dir = tempDir("issue-31316-premock-cjs", {
      "config.cjs": `module.exports = { key: "REAL" };`,
      "service.cjs": `
        const { key } = require("./config.cjs");
        console.log("service evaluated");
        module.exports = { key };
      `,
      "preload.ts": `require("./service.cjs");`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        mock.module("./config.cjs", () => ({ key: "MOCK" }));
        it("a sees mock", () => {
          expect(require("./config.cjs").key).toBe("MOCK");
        });
      `,
      "b.test.ts": `
        import { it, expect } from "bun:test";
        it("b gets the cached service", () => {
          expect(require("./service.cjs").key).toBe("REAL");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("service evaluated").length - 1).toBe(1);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("a later file can re-mock a path a previous file mocked through a shared barrel", async () => {
    // Teardown restores dep's env slots in place, so the registry entry is
    // fully correct and must stay reachable: evicting it orphans the record
    // that the cached barrel still binds through, so the next file's
    // mock.module() finds no registry entry and never overrides the slots.
    using dir = tempDir("issue-31316-remock-barrel", {
      "dep.ts": `export const v = "REAL";`,
      "consumer.ts": `export { v } from "./dep";`,
      "a.test.ts": `
        import { mock, it, expect } from "bun:test";
        import { v } from "./consumer";
        mock.module("./dep", () => ({ v: "A" }));
        it("a sees its own mock", () => {
          expect(v).toBe("A");
        });
      `,
      "b.test.ts": `
        import { mock, it, expect } from "bun:test";
        import { v } from "./consumer";
        mock.module("./dep", () => ({ v: "B" }));
        it("b sees its own mock", () => {
          expect(v).toBe("B");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr + stdout).toContain("2 pass");
    expect(stderr + stdout).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});

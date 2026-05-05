// https://github.com/oven-sh/bun/issues/30205
//
// `bun test --isolate` / `--parallel` creates a fresh Zig::GlobalObject per
// file and gcUnprotect()s the previous one. NapiEnv holds a raw
// `Zig::GlobalObject*` in m_globalObject; for non-experimental addons
// (nm_version != NAPI_VERSION_EXPERIMENTAL), napi finalizers are deferred to
// the event loop as NapiFinalizerTask. Objects rooted on the old global only
// become collectable when the swap unprotects it, so their finalizers run
// while loading the *next* file. Finalizer.run → NapiHandleScope::open then
// reads and writes the dead old global (NapiHandleScopeImplStructure(),
// m_currentNapiHandleScopeImpl.set()). Debug builds hit
//   ASSERTION FAILED: isMarked(cell)                    (Heap::addToRememberedSet)
//   ASSERTION FAILED: m_cellState == DefinitelyWhite    (JSCell::JSCell)
// release builds segfault at 0x68 / 0xD0 in visitChildren.
//
// Also covers the coordinator behaviour: --parallel used to silently retry a
// file once after its worker crashed, which hid exactly this panic and made
// the run exit 0. A fatal-signal crash now aborts the whole run.

import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const napiAppDir = join(import.meta.dir, "..", "..", "napi", "napi-app");
const addon = join(napiAppDir, "build", "Debug", "isolate_finalizer_addon.node");

describe("#30205", () => {
  beforeAll(() => {
    if (existsSync(addon)) return;
    // Same one-shot build pattern as test/napi/napi.test.ts; the addon is
    // tiny but node-gyp's toolchain detection is the slow part.
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: napiAppDir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success) throw new Error("node-gyp build failed");
  }, 120_000);

  // CI's ASAN lane runs this file with BUN_JSC_validateExceptionChecks=1,
  // which leaks into the spawned subprocesses via bunEnv → process.env.
  // The napi layer has a known unchecked ThrowScope between
  // napi_create_function and napi_set_named_property (see the "3rd party
  // napi" section in test/no-validate-exceptions.txt — every napi test is
  // excluded); under collectContinuously the simulated-throw counter lands
  // on the addon's init path and the subprocess aborts before the fixture
  // even runs. That's orthogonal to the GC UAF this test covers, so strip
  // the validator from the child env only.
  const env = {
    ...bunEnv,
    BUN_JSC_collectContinuously: "1",
    BUN_JSC_validateExceptionChecks: undefined,
    BUN_JSC_dumpSimulatedThrows: undefined,
  };

  // The crash is a GC-timing race; collectContinuously + per-file
  // `Bun.gc(true)` before loading the addon makes the previous global's napi
  // objects collect *before* any event-loop tick has drained their
  // finalizers, so it reproduces deterministically on Linux x64 ASAN too.
  // On unpatched main this hits the JSCell cellState assertion on file 2.
  // `await 0` at module scope makes loadEntryPointForTestRunner go through
  // waitForPromise → event_loop.tick(), which is where the enqueued
  // NapiFinalizerTask actually runs.
  function makeFixtures(n: number): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      files[`f${i}.test.js`] = `
        import { test, expect } from "bun:test";
        Bun.gc(true);
        const addon = require(${JSON.stringify(addon)});
        globalThis.__wrapped = [];
        for (let j = 0; j < 1000; j++)
          globalThis.__wrapped.push(addon.wrap({ j, pad: new Array(100).fill(j) }));
        Bun.gc(true);
        await 0;
        test("f${i}", () => { expect(globalThis.__wrapped.length).toBe(1000); });
      `;
    }
    return files;
  }

  // collectContinuously is prohibitively slow under Windows CI (same as the
  // 29519 regression test); the swap/finalizer path being exercised is
  // platform-agnostic, so POSIX coverage is sufficient.
  test.skipIf(isWindows).concurrent(
    "--isolate: deferred napi finalizers from the previous global don't write to its dead cell",
    async () => {
      using dir = tempDir("isolate-napi-uaf", makeFixtures(8));
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "."],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // On crash the summary line is never reached; assert on it (and the pass
      // count) first so the diff is the actual crash output, not just "expected
      // 0, got 134".
      expect(stderr).toContain("8 pass");
      expect(stderr).toContain("0 fail");
      expect(stderr).toContain("Ran 8 tests across 8 files.");
      expect(exitCode).toBe(0);
    },
    120_000,
  );

  test.skipIf(isWindows).concurrent(
    "--parallel: same scenario via the worker path",
    async () => {
      using dir = tempDir("parallel-napi-uaf", makeFixtures(8));
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--parallel=2", "."],
        env: { ...env, BUN_TEST_PARALLEL_SCALE_MS: "0" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("8 pass");
      expect(stderr).toContain("0 fail");
      expect(stderr).toContain("Ran 8 tests across 8 files.");
      expect(exitCode).toBe(0);
    },
    120_000,
  );

  // Bun's panic handler ends in @trap(), so a real worker panic surfaces
  // as a fatal signal (SIGILL/SIGTRAP). Previously the coordinator printed
  // "⟳ crashed running …, retrying" and re-ran the file in a fresh worker;
  // if the retry happened to pass the whole run exited 0 and the panic was
  // invisible. Now a fatal signal aborts the entire run. SIGABRT is used
  // here rather than inducing a real @panic so the test doesn't depend on
  // JIT fault-handler behaviour; from the coordinator's point of view
  // SIGABRT is indistinguishable from a JSC assertion failure. Windows has
  // no process.kill() signals, and the panic-signal classification is
  // POSIX-specific anyway (Windows abort() surfaces as exit code 3 and
  // falls into the non-panic branch below).
  test.skipIf(isWindows)(
    "--parallel: worker killed by a fatal signal aborts the run instead of retrying",
    async () => {
      using dir = tempDir("parallel-panic-no-retry", {
        "ok.test.js": `import {test,expect} from "bun:test"; test("ok",()=>expect(1).toBe(1));`,
        "boom.test.js": `import {test} from "bun:test"; test("boom",()=>process.kill(process.pid, "SIGABRT"));`,
      });
      // CI lanes with coredump-upload flag any new core file in coresDir as a
      // test failure — including the one the worker deliberately produces
      // here. ulimit -c 0 on the coordinator is inherited by the workers;
      // the test is POSIX-only so /bin/sh is available. Same reasoning as
      // the setrlimit(RLIMIT_CORE, {0,0}) in BunProcess.cpp's execve path.
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", bunExe(), "test", "--parallel=2", "."],
        env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // No "⟳ … retrying" line; instead the coordinator reports the crash,
      // names the signal, and aborts remaining work.
      expect(stderr).not.toContain("retrying");
      expect(stderr).toContain("worker crashed: SIGABRT");
      expect(stderr).toMatch(/a test worker process crashed with SIGABRT while running .*boom\.test\.js/);
      expect(stderr).toContain("Aborting");
      expect(exitCode).not.toBe(0);
    },
    60_000,
  );

  // process.exit() is a deliberate user action, not a Bun bug. The file is
  // marked failed (not retried) and the run continues so the other files'
  // results are still reported.
  test("--parallel: worker process.exit() is a non-retried failure, not a panic-abort", async () => {
    using dir = tempDir("parallel-exit-no-retry", {
      "a.test.js": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
      "b.test.js": `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`,
      "boom.test.js": `import {test} from "bun:test"; test("boom",()=>process.exit(7));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "."],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("retrying");
    expect(stderr).toContain("(worker crashed: exit code 7)");
    // Not a panic → no whole-run abort; the other two files still ran.
    expect(stderr).not.toContain("Aborting");
    expect(stderr).toContain("Ran 3 tests across 3 files.");
    expect(stderr).toMatch(/\b1 fail\b/);
    expect(exitCode).toBe(1);
  }, 60_000);
});

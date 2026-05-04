// https://github.com/oven-sh/bun/issues/30205
//
// `bun test --isolate` swaps the Zig::GlobalObject between test files while
// keeping the JSC::VM alive. NapiEnv caches the global as a raw pointer; when
// deferred NAPI finalizers (NapiFinalizerTask) from a previous file ran after
// the swap, they opened a handle scope on the old, already-swept global and
// hit Heap::addToRememberedSet(!isMarked(cell)) → segfault at 0x68/0xD0.
//
// collectContinuously keeps the concurrent collector running so the old
// global and its wrapped objects are reliably swept between files.

import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const napiAppDir = join(import.meta.dir, "..", "..", "napi", "napi-app");
const addonPath = join(napiAppDir, "build", "Debug", "async_finalize_addon.node");

// collectContinuously is very slow under Windows + ASAN in CI (see 29519);
// the path under test is platform-agnostic so posix coverage is sufficient.
describe.skipIf(isWindows)("bun test --isolate with NAPI finalizers pending across files", () => {
  beforeAll(() => {
    // async_finalize_addon uses NAPI_VERSION 8 (not experimental), so its
    // napi_wrap finalizers are deferred to the event loop via
    // NapiFinalizerTask instead of running during the GC sweep.
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: napiAppDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "inherit",
    });
    if (!install.success) {
      throw new Error("napi-app build failed:\n" + install.stderr.toString());
    }
  }, 120_000);

  test("deferred finalizers from a prior file see a live global", async () => {
    const files: Record<string, string> = {};
    // Zig::GlobalObject sits in an IsoSubspace whose slot isn't recycled
    // until enough swaps have accumulated; 20 files is the minimum observed
    // to reliably reuse the old global's memory under a release build.
    for (let i = 0; i < 20; i++) {
      // Each file loads the addon (fresh NapiEnv per global), wraps a batch
      // of objects, then roots some Buffer ballast on globalThis so the old
      // global's object graph is non-trivial when the next file's allocations
      // trigger a sweep. That sweep collects the wrapped objects and their
      // weak-handle callbacks enqueue NapiFinalizerTasks still holding the
      // previous file's NapiEnv.
      files[`file-${i}.test.ts`] = `
        import { test, expect } from "bun:test";
        const addon = require(${JSON.stringify(addonPath)});
        test("wrap pressure ${i}", () => {
          for (let j = 0; j < 500; j++) addon.create_ref();
          globalThis.__leak = [];
          for (let j = 0; j < 500; j++) {
            globalThis.__leak.push(Buffer.alloc(8192, j));
            addon.create_ref();
          }
          expect(typeof addon.create_ref).toBe("function");
        });
      `;
    }

    using dir = tempDir("napi-isolate-finalizer", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "."],
      env: {
        ...bunEnv,
        BUN_JSC_collectContinuously: "1",
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The addon's finalizer prints "finalizer" to stdout for every wrapped
    // object. Seeing them proves deferred finalizers actually ran (against a
    // live global) rather than being silently dropped.
    expect(stdout).toContain("finalizer");
    // On crash the runner aborts mid-run and never prints the pass/fail
    // summary; assert the summary before the exit code for a readable diff.
    expect(stderr).toContain("20 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }, 120_000);
});

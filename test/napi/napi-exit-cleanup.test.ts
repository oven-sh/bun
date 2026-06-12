// https://github.com/oven-sh/bun/issues/32144
//
// Every `bun test` exit site (and the --parallel worker exit in
// test/parallel/runner.rs) jumped straight to VirtualMachine::global_exit()
// without draining RareData::cleanup_hooks, the list on which each NapiEnv
// registers its at-exit cleanup. Consequences:
//   - napi_add_env_cleanup_hook hooks silently never ran under `bun test`
//     (Node runs them whenever the environment tears down);
//   - with BUN_DESTRUCT_VM_ON_EXIT=1 the final GC deferred the swept wraps'
//     finalizers as NapiFinalizerTasks parked on that same never-walked
//     list, which LeakSanitizer reports at exit (the intermittent exit-134
//     failures of test/regression/issue/30205.test.ts on the asan CI lane).
//
// The fix drains the cleanup hooks in global_exit(). Pending napi_wrap
// finalizers are deliberately NOT run on this path: unlike `bun run`, the
// test runner exits without draining the event loop, so addons may still
// have queued async work whose teardown references wraps the finalizer pass
// would have deleted (duckdb's Task destructor Unref()s its Connection).
// Node does not guarantee wrap finalizers run at process exit either.
//
// This file lives apart from napi.test.ts only because that 100-test
// concurrent suite is too heavy to run as a whole alongside these.

import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const napiAppDir = join(import.meta.dir, "napi-app");
const hookAddon = join(napiAppDir, "build", "Debug", "test_cleanup_hook_order.node");
const wrapAddon = join(napiAppDir, "build", "Debug", "test_wrap_cleanup_order.node");

// CI's ASAN lane sets BUN_JSC_validateExceptionChecks=1, which leaks into the
// spawned bun processes via bunEnv. The napi addon init path has a known
// unchecked ThrowScope (see the "3rd party napi" section in
// test/no-validate-exceptions.txt), so the child aborts while loading the
// addon, before the fixture runs. Strip the validator from the child env
// only, same as test/regression/issue/30205.test.ts.
const childEnv = {
  ...bunEnv,
  BUN_JSC_validateExceptionChecks: undefined,
  BUN_JSC_dumpSimulatedThrows: undefined,
};

describe.concurrent("napi cleanup at bun test exit", () => {
  beforeAll(() => {
    if (existsSync(hookAddon) && existsSync(wrapAddon)) return;
    // Same one-shot build pattern as test/regression/issue/30205.test.ts.
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

  test("napi env cleanup hooks run when the process exits from bun test", async () => {
    using dir = tempDir("napi-cleanup-hooks-bun-test", {
      "hooks.test.js": `
        import { test, expect } from "bun:test";
        const addon = require(${JSON.stringify(hookAddon)});
        addon.test();
        test("registers env cleanup hooks", () => expect(1).toBe(1));
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "test", "hooks.test.js"],
      env: childEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The addon registers hooks 1, 2, 3; they must fire at exit in reverse
    // order, same as when the process exits from `bun run`.
    expect(stdout).toContain("hook3 executed at position 0");
    expect(stdout).toContain("hook2 executed at position 1");
    expect(stdout).toContain("hook1 executed at position 2");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("pending napi_wrap finalizers are skipped at bun test exit", async () => {
    // Negative contract for the hooks-only drain: wraps still rooted when
    // `bun test` exits must NOT have their finalizers run (the event loop
    // was never drained, so running them can touch wraps that abandoned
    // async work still references), and the process must exit cleanly. The
    // equivalent `bun run` exit does run them; that behavior is covered by
    // "napi_wrap finalizers run in LIFO order during env teardown" in
    // napi.test.ts.
    using dir = tempDir("napi-wrap-teardown-bun-test", {
      "wrap.test.js": `
        import { test, expect } from "bun:test";
        const addon = require(${JSON.stringify(wrapAddon)});
        globalThis.keep = addon.createParentAndChildren(32);
        test("wraps stay rooted until exit", () => expect(globalThis.keep.length).toBe(33));
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "test", "wrap.test.js"],
      env: childEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The addon prints "finalize order: ..." if any wrap finalizer runs.
    expect(stdout).not.toContain("finalize order:");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});

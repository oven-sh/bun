// https://github.com/oven-sh/bun/issues/32144
//
// Every `bun test` exit site (and the --parallel worker exit in
// test/parallel/runner.rs) jumped straight to VirtualMachine::global_exit()
// without draining RareData::cleanup_hooks, the list on which each NapiEnv
// registers its at-exit cleanup (NapiEnv::cleanup: env cleanup hooks +
// pending napi_wrap finalizers). Consequences:
//   - napi_add_env_cleanup_hook hooks silently never ran under `bun test`
//     (Node runs them whenever the environment tears down);
//   - napi_wrap at-exit finalizers never ran, so with
//     BUN_DESTRUCT_VM_ON_EXIT=1 the final GC deferred them as
//     NapiFinalizerTasks parked on that same never-walked list, which
//     LeakSanitizer reports at exit (the intermittent exit-134 failures of
//     test/regression/issue/30205.test.ts on the asan CI lane).
//
// These two tests are the deterministic, build-independent half: they fail
// on an unfixed build on every platform because the hook/finalizer output
// never appears. They live in their own file (rather than napi.test.ts)
// only because that 100-test concurrent suite is too heavy to run as a
// whole alongside these.

import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const napiAppDir = join(import.meta.dir, "napi-app");
const hookAddon = join(napiAppDir, "build", "Debug", "test_cleanup_hook_order.node");
const wrapAddon = join(napiAppDir, "build", "Debug", "test_wrap_cleanup_order.node");

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
      env: bunEnv,
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

  test("napi_wrap finalizers run during env teardown when exiting from bun test", async () => {
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
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The addon prints the accumulated LIFO order once the parent (id 0) is
    // finalized; stdout also carries the test runner's version banner, so
    // assert the exact line rather than the whole stream. No trailing
    // newline in the needle: the addon's printf("\n") arrives as CRLF on
    // Windows (text-mode CRT stdout).
    expect(stdout).toContain(
      "finalize order: " +
        Array.from({ length: 32 }, (_, i) => 32 - i)
          .concat(0)
          .join(" "),
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});

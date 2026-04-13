// Regression test for https://github.com/oven-sh/bun/issues/29260:
//
// NAPI modules like ffi-napi call libuv thread functions during module
// init. Before the fix, uv_thread_self was a stub that panicked with
// "unsupported uv function: uv_thread_self" and Bun would abort before
// the user's require('ffi-napi') even returned.
//
// uv_thread_addon.c is a NAPI module whose init function calls every
// thread primitive we now polyfill (uv_thread_self, uv_thread_equal,
// uv_thread_create, uv_thread_join, uv_thread_detach, uv_thread_create_ex)
// and verifies they work. A require() of the module would panic Bun if
// any of them regress back to a stub.
import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const napiAppDir = join(import.meta.dir, "..", "..", "napi", "napi-app");
const addonPath = join(napiAppDir, "build", "Debug", "uv_thread_addon.node");

// We use real libuv on Windows, so the POSIX stubs don't apply there.
describe.if(!isWindows)("issue/29260", () => {
  beforeAll(
    () => {
      // Build the NAPI addon if it hasn't been built in a previous run.
      // node-gyp is slow (30s+), so skip when the output is already on disk.
      if (existsSync(addonPath)) return;
      const install = spawnSync({
        cmd: [bunExe(), "install"],
        cwd: napiAppDir,
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      if (!install.success) {
        throw new Error("failed to build napi-app (node-gyp)");
      }
    },
    // node-gyp cold-build of the whole napi-app is slow.
    5 * 60_000,
  );

  test("uv_thread_self and friends no longer panic when a NAPI module calls them", { timeout: 30_000 }, async () => {
    // -p prints the expression value. The addon's init returns `true` if
    // every thread op succeeds — if any uv_thread_* symbol were still a
    // stub, Bun would panic here instead of printing "boolean".
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `typeof require(${JSON.stringify(addonPath)})`],
      env: bunEnv,
      cwd: napiAppDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Diagnose before the assertion so test output is useful on failure.
    if (exitCode !== 0 || !stdout.includes("boolean")) {
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    // The addon's init returns `true` only if every thread op succeeds.
    // Without the polyfill, Bun panics during require() and `typeof` never
    // gets printed — so checking stdout + exit code is enough to detect
    // both the regression and the fix.
    expect(stdout).toContain("boolean");
    expect(exitCode).toBe(0);
  });
});

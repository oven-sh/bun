// https://github.com/oven-sh/bun/issues/29260
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
      // node-gyp is slow (30s+); skip when the prebuilt output is on disk.
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

  test("uv_thread_self and friends no longer panic when a NAPI module calls them", async () => {
    // The addon's NAPI_MODULE_INIT returns `true` iff every thread op
    // succeeds, and napi_throw_error otherwise. We print the returned
    // value directly (not `typeof`) so the assertion fails if the addon
    // ever silently returns `false` or a non-boolean.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `require(${JSON.stringify(addonPath)})`],
      env: bunEnv,
      cwd: napiAppDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Diagnose before the assertion so test output is useful on failure.
    if (exitCode !== 0 || stdout.trim() !== "true") {
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    expect(stdout.trim()).toBe("true");
    expect(exitCode).toBe(0);
  });
});

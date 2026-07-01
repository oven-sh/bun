import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons } from "harness";
import { join } from "path";

const addonPath = join(__dirname, "napi-app/build/Debug/test_delete_ref_in_finalizer_experimental.node");

beforeAll(() => {
  if (!canBuildNodeAddons()) return;
  // Build the native addons in napi-app, but only if the one this test needs
  // is missing (napi.test.ts or a previous run usually has built it already).
  // The addon doesn't link against bun, so an existing binary stays valid
  // across bun builds; skipping the install avoids re-running the node-gyp
  // rebuild, which is slow and occasionally flaky under resource pressure.
  if (existsSync(addonPath)) {
    return;
  }
  for (let attempt = 0; ; attempt++) {
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (install.success && existsSync(addonPath)) {
      return;
    }
    if (attempt >= 1) {
      throw new Error("building napi-app addons failed");
    }
  }
}, 300_000);

it.skipIf(!canBuildNodeAddons())(
  "napi_delete_reference can be called from finalizers during GC in experimental modules",
  async () => {
    // Finalizers in NAPI_VERSION_EXPERIMENTAL modules run synchronously while
    // the garbage collector is sweeping. Unlike napi_reference_unref (which
    // really is forbidden there, see "napi_reference_unref is blocked from
    // finalizers in experimental modules" in napi.test.ts), Node.js still
    // allows napi_delete_reference during GC: it takes node_api_basic_env,
    // and deleting the reference returned by napi_wrap is documented to be
    // done from the finalize callback (node-addon-api's ObjectWrap destructor
    // does exactly this). Bun used to abort with a "napi_reference_unref"
    // panic.
    const code = `
      const addon = require(${JSON.stringify(
        join(__dirname, "napi-app/build/Debug/test_delete_ref_in_finalizer_experimental.node"),
      )});
      function makeGarbage() {
        addon.createWrapped(50);
        addon.createWithFinalizer(50);
      }
      makeGarbage();
      Bun.gc(true);
      Bun.gc(true);
      const stats = addon.getStats();
      if (stats.finalizersCalled === 0) {
        throw new Error("test bug: no finalizers ran during Bun.gc");
      }
      if (stats.deletesSucceeded !== stats.finalizersCalled) {
        throw new Error(
          \`napi_delete_reference failed in \${stats.finalizersCalled - stats.deletesSucceeded} of \${stats.finalizersCalled} finalizers\`,
        );
      }
      console.log("SUCCESS");
    `;
    const { BUN_INSPECT_CONNECT_TO: _, ASAN_OPTIONS, ...rest } = bunEnv;
    await using proc = spawn({
      cmd: [bunExe(), "-e", code],
      env: {
        ...rest,
        // If the GC check wrongly fires, die with a plain abort instead of
        // hanging in the crash reporter / ASAN symbolizer.
        BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1",
        ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("FATAL ERROR");
    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  },
  30_000,
);

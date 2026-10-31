import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, tempDir } from "harness";
import { join } from "path";

const napiAppDir = join(__dirname, "napi-app");
const addonName = "test_isolate_env_cleanup";
const addonPath = join(napiAppDir, `build/Debug/${addonName}.node`);

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
  // Fast path: `bun install` runs napi-app's install script, a full
  // `node-gyp rebuild` of every addon target in binding.gyp. This test needs
  // exactly one single-source-file target, so install the toolchain without
  // running that script and ask node-gyp to build only this target.
  if (!existsSync(join(napiAppDir, "node_modules/node-gyp"))) {
    spawnSync({
      cmd: [bunExe(), "install", "--ignore-scripts", "--verbose"],
      cwd: napiAppDir,
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
  }
  spawnSync({
    // Same invocation as napi-app's install script, minus `clean` and scoped
    // to one target (node-gyp forwards trailing args as make/msbuild targets).
    cmd: [bunExe(), "--bun", "node-gyp", "configure", "build", "--debug", "-j", "max", addonName],
    cwd: napiAppDir,
    stderr: "inherit",
    env: bunEnv,
    stdout: "inherit",
    stdin: "inherit",
  });
  if (existsSync(addonPath)) {
    return;
  }
  // Fallback: the full install + rebuild of everything, retried once.
  for (let attempt = 0; ; attempt++) {
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: napiAppDir,
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
  "bun test --isolate does not keep every file's global alive through a napi reference nothing deletes",
  async () => {
    // `bun test --isolate` runs every file in a fresh global. An addon holding a class constructor in a reference it
    // never deletes, and a threadsafe function with a callback (as napi-rs does), pinned each file's global for the rest of the run.
    const files: Record<string, string> = {};
    const count = 6;
    for (let i = 0; i < count; i++) {
      files[`file${i}.test.ts`] = `
        import { test, expect } from "bun:test";
        import { heapStats } from "bun:jsc";
        require(${JSON.stringify(addonPath)});
        test("file ${i}", () => {
          Bun.gc(true);
          Bun.gc(true);
          console.log("RESULT " + heapStats().objectTypeCounts.GlobalObject);
          expect(1).toBe(1);
        });
      `;
    }
    using dir = tempDir("napi-isolate-env-cleanup", files);
    const { BUN_INSPECT_CONNECT_TO: _, ...rest } = bunEnv;
    await using proc = spawn({
      cmd: [bunExe(), "test", "--isolate"],
      cwd: String(dir),
      env: rest,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const results = [...(stdout + stderr).matchAll(/RESULT (\d+)/g)].map(m => Number(m[1]));
    expect(results).toHaveLength(count);
    // The current file's global and at most the previous one's, as without an addon.
    expect(Math.max(...results)).toBeLessThanOrEqual(2);
    expect(exitCode).toBe(0);
  },
  60_000,
);

// Regression test for oven-sh/bun#36828: threadsafe function calls deadlocked
// under `bun test` when a callback blocked in a nested event loop
// (expect(promise).resolves / .rejects waits that way).
import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons } from "harness";
import { join } from "path";

const napiAppDir = join(__dirname, "napi-app");
const addonName = "tsfn_nested_wait_addon";
const addonPath = join(napiAppDir, `build/Debug/${addonName}.node`);

beforeAll(() => {
  if (!canBuildNodeAddons()) return;
  // Build the native addons in napi-app, but only if the one this test needs
  // is missing or older than its inputs (napi.test.ts or a previous run
  // usually has built it already). The addon doesn't link against bun, so an
  // existing binary stays valid across bun builds; skipping the install avoids
  // re-running the node-gyp rebuild, which is slow and occasionally flaky
  // under resource pressure.
  if (existsSync(addonPath)) {
    const built = statSync(addonPath).mtimeMs;
    const inputs = [join(napiAppDir, "tsfn_nested_wait_addon.cpp"), join(napiAppDir, "binding.gyp")];
    if (inputs.every(f => statSync(f).mtimeMs < built)) {
      return;
    }
  }
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
  "threadsafe function calls are dispatched while a callback blocks in a nested promise wait",
  async () => {
    await using proc = spawn({
      cmd: [bunExe(), "test", join(napiAppDir, "tsfn-nested-wait.fixture.ts")],
      cwd: napiAppDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  },
  60_000,
);

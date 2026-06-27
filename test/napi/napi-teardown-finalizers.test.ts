import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons } from "harness";
import { join } from "path";

const addonPath = join(__dirname, "napi-app/build/Debug/test_teardown_finalizers.node");

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

async function runFixture(code: string) {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `const addon = require(${JSON.stringify(addonPath)});\n${code}`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const finalized = stderr
    .split("\n")
    .filter(l => l.startsWith("finalize: "))
    .map(l => l.slice("finalize: ".length))
    .sort();
  return { stdout, stderr, exitCode, finalized };
}

it.skipIf(!canBuildNodeAddons())(
  "finalizers from every registration API run at env teardown",
  async () => {
    // Every object is kept strongly reachable until exit so GC never collects
    // any of them; env teardown is the finalizers' only chance to run. Node.js
    // runs all four. Bun used to drain only napi_wrap's finalizers at teardown
    // and silently drop the rest, leaking whatever native state they owned.
    const { stdout, exitCode, finalized } = await runFixture(`
      const o1 = {}, o2 = {}, o3 = {};
      addon.wrap(o1, "wrap");
      addon.addFinalizer(o2, "add_finalizer", false);
      addon.addFinalizer(o3, "add_finalizer_ref", true);
      globalThis.__keep = [o1, o2, o3, addon.createExternal("external")];
    `);
    expect(stdout).toBe("");
    expect(finalized).toEqual(["add_finalizer", "add_finalizer_ref", "external", "wrap"]);
    expect(exitCode).toBe(0);
  },
  30_000,
);

it.skipIf(!canBuildNodeAddons())(
  "a finalizer already run by GC does not run again at env teardown",
  async () => {
    // "gc_*" objects become garbage and are finalized by Bun.gc(); "exit_*"
    // objects stay rooted until teardown. Each name must appear exactly once:
    // a duplicate would be a double-invocation (double free in a real addon),
    // a missing "gc_*" would mean GC-time finalization regressed.
    const { stdout, exitCode, finalized } = await runFixture(`
      function makeGarbage() {
        addon.addFinalizer({}, "gc_add_finalizer", false);
        addon.createExternal("gc_external");
      }
      makeGarbage();
      Bun.gc(true);
      Bun.gc(true);
      const kept = {};
      addon.addFinalizer(kept, "exit_add_finalizer", false);
      globalThis.__keep = [kept, addon.createExternal("exit_external")];
    `);
    expect(stdout).toBe("");
    expect(finalized).toEqual(["exit_add_finalizer", "exit_external", "gc_add_finalizer", "gc_external"]);
    expect(exitCode).toBe(0);
  },
  30_000,
);

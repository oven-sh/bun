import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons } from "harness";
import { join } from "path";

const addonDir = join(__dirname, "napi-app");
const addonSource = join(addonDir, "test_teardown_finalizers.c");
const addonPath = join(addonDir, "build/Debug/test_teardown_finalizers.node");

// Printed by the fixture after the gc_* finalizers are observed so the test can
// prove they ran during Bun.gc(), not only at env teardown. The addon writes to
// stdout (a spawned child's stderr is unreliable on some CI lanes), so this does too.
const GC_BARRIER = "--gc-barrier--";

beforeAll(() => {
  if (!canBuildNodeAddons()) return;
  // Build the napi-app addons only if the one this test needs is missing or older
  // than its inputs. It doesn't link against bun, so an existing binary stays valid
  // across bun builds, and skipping the slow node-gyp rebuild avoids flakes.
  if (existsSync(addonPath)) {
    const built = statSync(addonPath).mtimeMs;
    const inputs = [addonSource, join(addonDir, "binding.gyp")];
    if (inputs.every(f => statSync(f).mtimeMs <= built)) {
      return;
    }
  }
  for (let attempt = 0; ; attempt++) {
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: addonDir,
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
    // Strip JSC exception-scope validation if a CI agent has it set (like the
    // JSC_useJIT strip in harness.ts): Node-API has no place for an exception check
    // between two napi calls, so any addon callback making two aborts under it.
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: undefined, BUN_JSC_dumpSimulatedThrows: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // On Windows the C runtime writes \r\n, so split on either line ending.
  const lines = stdout.split(/\r?\n/).filter(l => l.startsWith("finalize: ") || l === GC_BARRIER);
  const names = (ls: string[]) => ls.map(l => l.slice("finalize: ".length)).sort();
  const finalized = names(lines.filter(l => l !== GC_BARRIER));
  // If nothing fired, the child never got that far (crashed, require failed, or
  // the finalizers regressed); surface its raw output in the failure diff.
  const childOutputIfNothingFinalized = finalized.length === 0 ? { stdout, stderr } : null;
  return { stdout, stderr, exitCode, lines, names, finalized, childOutputIfNothingFinalized };
}

it.skipIf(!canBuildNodeAddons())("finalizers from every registration API run at env teardown", async () => {
  // Every object is kept strongly reachable until exit so GC never collects any
  // of them: env teardown is the finalizers' only chance to run. Node runs all four.
  const { exitCode, finalized, childOutputIfNothingFinalized } = await runFixture(`
      const o1 = {}, o2 = {}, o3 = {};
      addon.wrap(o1, "wrap");
      addon.addFinalizer(o2, "add_finalizer", false);
      addon.addFinalizer(o3, "add_finalizer_ref", true);
      globalThis.__keep = [o1, o2, o3, addon.createExternal("external")];
    `);
  expect({ exitCode, finalized, childOutputIfNothingFinalized }).toEqual({
    exitCode: 0,
    finalized: ["add_finalizer", "add_finalizer_ref", "external", "wrap"],
    childOutputIfNothingFinalized: null,
  });
});

it.skipIf(!canBuildNodeAddons())("a finalizer already run by GC does not run again at env teardown", async () => {
  // The fixture forces GC until the gc_* finalizers have observably run, prints
  // the barrier, then roots the exit_* objects until teardown. Each group landing
  // on its own side of the barrier exactly once proves no finalizer runs twice.
  const { exitCode, lines, names, childOutputIfNothingFinalized } = await runFixture(`
      function makeGarbage() {
        addon.addFinalizer({}, "gc_add_finalizer", false);
        addon.createExternal("gc_external");
      }
      makeGarbage();
      for (let i = 0; addon.finalizeCount() < 2; i++) {
        if (i > 500) throw new Error("gc-time finalizers never ran; count=" + addon.finalizeCount());
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      console.log(${JSON.stringify(GC_BARRIER)});
      const kept = {};
      addon.addFinalizer(kept, "exit_add_finalizer", false);
      globalThis.__keep = [kept, addon.createExternal("exit_external")];
    `);
  const barrier = lines.indexOf(GC_BARRIER);
  expect({
    exitCode,
    beforeGcBarrier: barrier === -1 ? "missing barrier" : names(lines.slice(0, barrier)),
    afterGcBarrier: barrier === -1 ? "missing barrier" : names(lines.slice(barrier + 1)),
    childOutputIfNothingFinalized,
  }).toEqual({
    exitCode: 0,
    beforeGcBarrier: ["gc_add_finalizer", "gc_external"],
    afterGcBarrier: ["exit_add_finalizer", "exit_external"],
    childOutputIfNothingFinalized: null,
  });
});

it.skipIf(!canBuildNodeAddons())(
  "finalizers registered by a teardown finalizer also run in the same teardown",
  async () => {
    // nesting_finalize registers two more finalizers (napi_create_external and
    // napi_add_finalizer) while the env is already draining its finalizer list.
    // Both must still run before the list is freed out from under their owners.
    const { exitCode, finalized, childOutputIfNothingFinalized } = await runFixture(`
      const o = {};
      addon.wrapNesting(o, "outer", "nested_external", "nested_add_finalizer");
      globalThis.__keep = [o];
    `);
    expect({ exitCode, finalized, childOutputIfNothingFinalized }).toEqual({
      exitCode: 0,
      finalized: ["nested_add_finalizer", "nested_external", "outer"],
      childOutputIfNothingFinalized: null,
    });
  },
);

it.skipIf(!canBuildNodeAddons())("a finalizer registered after deleting a ref during teardown still runs", async () => {
  // recycle_finalize deletes the "saved" ref during teardown, then registers a
  // new finalizer; the allocator commonly hands back the just-freed NapiRef
  // address. "recycled" must still run, and the deleted "saved" must not.
  const { exitCode, finalized, childOutputIfNothingFinalized } = await runFixture(`
      const o1 = {}, o2 = {};
      addon.addFinalizerSaveRef(o2, "saved");
      addon.wrapRecycling(o1, "outer", "recycled");
      globalThis.__keep = [o1, o2];
    `);
  expect({ exitCode, finalized, childOutputIfNothingFinalized }).toEqual({
    exitCode: 0,
    finalized: ["outer", "recycled"],
    childOutputIfNothingFinalized: null,
  });
});

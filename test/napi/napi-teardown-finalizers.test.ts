import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons } from "harness";
import { join } from "path";

const addonDir = join(__dirname, "napi-app");
const addonSource = join(addonDir, "test_teardown_finalizers.c");
const addonPath = join(addonDir, "build/Debug/test_teardown_finalizers.node");

// Printed by the fixture after the gc_* finalizers have been observed, so the
// test can prove they ran during Bun.gc(), not only at env teardown. The
// addon writes to stdout (not stderr) because on bun's ASAN CI lane a spawned
// child's stderr arrives empty, so the barrier goes to stdout too.
const GC_BARRIER = "--gc-barrier--";

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
    // JSC_useJIT strip in harness.ts). Every napi_* call opens a ThrowScope that
    // simulates a throw on return into the addon's C frame, and Node-API has no
    // place for an exception check between two napi calls, so any addon callback
    // making two of them aborts under the validator regardless of this fix.
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: undefined, BUN_JSC_dumpSimulatedThrows: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // On Windows the C runtime writes \r\n, so split on either line ending.
  const lines = stdout.split(/\r?\n/).filter(l => l.startsWith("finalize: ") || l === GC_BARRIER);
  const names = (ls: string[]) => ls.map(l => l.slice("finalize: ".length)).sort();
  const finalized = names(lines.filter(l => l !== GC_BARRIER));
  // If nothing fired, the child never got that far (crashed, require failed,
  // or the finalizers regressed). Surface its raw output in the failure diff
  // instead of an unreadable empty array.
  const childOutputIfNothingFinalized = finalized.length === 0 ? { stdout, stderr } : null;
  return { stdout, stderr, exitCode, lines, names, finalized, childOutputIfNothingFinalized };
}

it.skipIf(!canBuildNodeAddons())(
  "finalizers from every registration API run at env teardown",
  async () => {
    // Every object is kept strongly reachable until exit so GC never collects
    // any of them; env teardown is the finalizers' only chance to run. Node.js
    // runs all four. Bun used to drain only napi_wrap's finalizers at teardown
    // and silently drop the rest, leaking whatever native state they owned.
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
  },
  30_000,
);

it.skipIf(!canBuildNodeAddons())(
  "a finalizer already run by GC does not run again at env teardown",
  async () => {
    // The gc_* objects become garbage; the fixture forces GC until their
    // finalizers have observably run (the addon defers them to the event loop,
    // so it polls a native counter rather than assuming Bun.gc is synchronous),
    // then prints the barrier and registers the exit_* objects, which stay
    // rooted until teardown. Asserting the two groups land on opposite sides of
    // the barrier, each exactly once, proves both that GC-time finalization
    // still works and that teardown does not re-run a finalizer GC already ran.
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
  },
  30_000,
);

it.skipIf(!canBuildNodeAddons())(
  "finalizers registered by a teardown finalizer also run in the same teardown",
  async () => {
    // nesting_finalize runs during env teardown and registers two more
    // finalizers (napi_create_external + napi_add_finalizer) while the env is
    // already draining its finalizer list. Bun accepts those calls there, so
    // it must drain the entries they append: a single reverse pass followed by
    // a bulk free of the list never ran them, and freeing them left the
    // still-live NapiExternal / NapiRef holding a dangling pointer to its list
    // entry (a use-after-free on the next sweep).
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
  30_000,
);

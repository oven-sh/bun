// Verifies the OS memory-pressure watcher (src/aio/MemoryPressureWatcher.zig).
//
// Real OS pressure can't be triggered deterministically in CI, so:
//   - the response path is exercised via the debug-only
//     Bun.unsafe.simulateMemoryPressure() seam,
//   - install/uninstall is smoke-tested via the BUN_DEBUG_MemoryPressure log,
//   - and we assert the watcher never keeps the event loop alive.
//
// Manual end-to-end repro (run alongside
// `BUN_DEBUG_MemoryPressure=1 BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER=1 bun --watch script.js`
// and watch for "memory pressure (critical); shrinking footprint" + an RSS drop):
//   macOS:   sudo memory_pressure -S -l critical
//   Linux:   stress-ng --vm 1 --vm-bytes 90% -t 30
//   Windows: Sysinternals testlimit -d, or a tight allocator loop in another process

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux } from "harness";

const flagOn = {
  ...bunEnv,
  BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER: "1",
  // Output.scoped logs go to stdout in debug builds; QUIET_LOGS hushes every
  // other scope so we can grep for just [memorypressure] lines.
  BUN_DEBUG_MemoryPressure: "1",
  BUN_DEBUG_QUIET_LOGS: "1",
};

async function run(env: Record<string, string | undefined>, code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Output.scoped(.MemoryPressure) writes to stdout. Pull those lines out so
  // tests can assert on them separately from the user script's own output.
  const debug = stdout
    .split("\n")
    .filter(l => l.includes("[memorypressure]"))
    .join("\n");
  const out = stdout
    .split("\n")
    .filter(l => !l.includes("[memorypressure]"))
    .join("\n");
  return { out, debug, stderr, exitCode };
}

describe("MemoryPressureWatcher", () => {
  test.skipIf(!isDebug)("respond() runs a sync GC and bumps the analytics counter", async () => {
    // The simulate seam runs the same JS-thread respond() the OS callback would.
    // Heap-size deltas are too noisy to assert on (JSC keeps block capacity
    // around after a collection), so use a WeakRef as the deterministic signal
    // that runGC(true) ran: the referent must be gone afterwards.
    const code = /* js */ `
      function makeRef() { return new WeakRef({ sentinel: true }); }
      const ref = makeRef();
      const aliveBefore = ref.deref() !== undefined;
      const counter = Bun.unsafe.simulateMemoryPressure();
      const aliveAfter = ref.deref() !== undefined;
      process.stdout.write(JSON.stringify({ aliveBefore, aliveAfter, counter }));
    `;
    const { out, debug, stderr, exitCode } = await run(flagOn, code);
    expect({ debug, stderr }).toEqual({
      debug: expect.stringContaining("shrinking footprint"),
      stderr: expect.not.stringContaining("error"),
    });
    expect(JSON.parse(out.trim())).toEqual({
      aliveBefore: true,
      aliveAfter: false,
      counter: 1,
    });
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isDebug)("installs when the flag is on, and does not keep the loop alive", async () => {
    // exitCode === 0 here is the loop-keepalive guard: if the watcher's
    // libuv handle / dispatch source / PSI thread accidentally ref'd the
    // loop, this child would never exit and the assertion would fail on
    // bun:test's default timeout instead.
    const { debug, exitCode } = await run(flagOn, `await Bun.sleep(50)`);
    if (isLinux) {
      // System-wide PSI triggers (/proc/pressure/memory) need CAP_SYS_RESOURCE
      // on most kernels, so containers commonly fall through to "unavailable".
      // Either outcome is fine; just prove the install path ran and reported one.
      expect(debug).toMatch(/installed \(.*PSI\)|PSI unavailable/);
    } else {
      expect(debug).toContain("installed");
    }
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isDebug)("does not install when the feature flag is off (default)", async () => {
    const flagOff = { ...flagOn };
    delete flagOff.BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER;
    const { debug, exitCode } = await run(flagOff, `await Bun.sleep(50)`);
    expect(debug).not.toContain("installed");
    expect(exitCode).toBe(0);
  });
});

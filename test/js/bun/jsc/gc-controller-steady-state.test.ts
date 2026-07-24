import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/35436
// Under a steady workload whose heap size jitters every tick (an HTTP server
// replacing entries in a large in-memory cache, for example), the GC
// controller used to force an eden collection every ~16ms, paced by wall
// clock rather than by allocation. Each forced collection re-marks the
// remembered set, which is O(live heap) once a large long-lived object is
// dirtied, so on big heaps GC dominated request CPU (oven-sh/bun#35436).
// Steady-state collections should be paced by allocation (JSC's heuristics
// plus the controller's repeating timer), not by the 16ms watch timer.
//
// The fixture must run from a file: `bun -e` takes the one-shot startup path,
// which does not exhibit the forced-GC cadence.
test("GC controller does not force eden collections on steady-state heap jitter", async () => {
  using dir = tempDir("gc-controller-steady-state", {
    "churn.js": `
      const map = new Map();
      // Small live set on purpose: collections stay cheap even in debug+ASAN
      // builds, so the unfixed wall-clock cadence (~180 collections in 3s)
      // shows up regardless of how slow the build is.
      const N = 2000;
      const blob = Buffer.alloc(64, "x").toString();
      const rec = i => ({ id: i, name: "item-" + i, blob: blob + i });
      for (let i = 0; i < N; i++) map.set(i, rec(i));
      const deadline = Date.now() + 3000;
      let iters = 0;
      while (Date.now() < deadline) {
        // Churn the live set so the heap size keeps changing between event
        // loop ticks, without allocating fast enough to trip JSC's own
        // allocation-based collection heuristics more than a few times.
        for (let k = 0; k < 10; k++) {
          const id = (iters * 7919 + k) % N;
          map.set(id, rec(id));
        }
        iters++;
        await Bun.sleep(1);
      }
      console.log("ITER=" + iters);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "churn.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_JSC_logGC: "1",
      BUN_GC_TIMER_DISABLE: undefined,
      BUN_GC_TIMER_INTERVAL: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("ITER=");
  // One collection per 16ms tick comes to ~180 over the 3s window (~110 in
  // debug+ASAN builds); an allocation-paced run stays in the single digits.
  const edenCollections = (stderr.match(/EdenCollection/g) ?? []).length;
  expect(edenCollections).toBeLessThan(50);
  expect(exitCode).toBe(0);
}, 20_000);

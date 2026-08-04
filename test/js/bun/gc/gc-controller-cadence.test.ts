import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Bun's GarbageCollectionController used to sample `blockBytesAllocated +
// extraMemorySize` on every event-loop tick and arm a 16 ms one-shot whenever
// that value changed at all. The collection's own perturbation of those counters
// re-armed the timer, producing ~60 stop-the-world eden collections per second
// whenever the loop was active, independent of allocation volume. The controller
// is now just a 1 s / 30 s idle timer; eden pacing is left to JSC's own
// allocation budget (GCActivityCallback / collectIfNecessaryOrDefer). See
// https://github.com/oven-sh/bun/blob/main/src/jsc/GarbageCollectionController.rs
//
// These tests drive a setInterval workload with BUN_JSC_logGC and count the
// EdenCollection lines JSC prints.
//
// The symptom is release-only: on debug+ASAN a collection cycle takes ~100 ms
// so JSC coalesces dozens of collect requests into 2-3 actual collections and
// the count cannot distinguish fixed from unfixed. Release cycles are ~1 ms and
// each request lands as its own collection (observed 128 vs 3).

// `bytesPerTick` of short-lived garbage every `intervalMs` for `ticks` iterations.
const workload = (ticks: number, bytesPerTick: number, intervalMs: number) => `
  let n = 0;
  const fill = Buffer.alloc(80, "x").toString();
  const id = setInterval(() => {
    const arr = [];
    for (let i = 0; i < ${Math.ceil(bytesPerTick / 100)}; i++) arr.push({ i, s: fill + i });
    globalThis.sink = arr;
    if (++n >= ${ticks}) { clearInterval(id); process.exit(0); }
  }, ${intervalMs});
`;

async function countEdenCollections(
  extraEnv: Record<string, string | undefined>,
  ticks: number,
  bytesPerTick: number,
  intervalMs = 20,
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", workload(ticks, bytesPerTick, intervalMs)],
    env: {
      ...bunEnv,
      BUN_GC_TIMER_DISABLE: undefined,
      BUN_GC_TIMER_INTERVAL: undefined,
      BUN_JSC_logGC: "true",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const log = stdout + stderr;
  const eden = (log.match(/=> EdenCollection/g) ?? []).length;
  expect(exitCode, log).toBe(0);
  return { eden };
}

// The controller's fast→slow transition (30 consecutive ticks with no heap
// growth) schedules `collectNow(Sync, Full)` so CodeBlock old-age jettison can
// run and swept blocks get decommitted. Before this, the idle timer only
// requested `collectAsync()`, and an otherwise-idle server stayed at its
// post-burst RSS plateau.
//
// `collectNow(Sync, ...)` is the only path that calls `sweepSynchronously()`,
// which JSC logs as "Full sweep:" under `logGC`. JSC's own `GCActivityCallback`
// issues `collectAsync` requests (which the log shows as FullCollection /
// EdenCollection without a sweep line), so counting "Full sweep:" isolates the
// controller's contribution.
test.concurrent("idle fast→slow transition schedules a synchronous full collection", async () => {
  // Allocate briefly, then sit idle long enough for 30 consecutive controller
  // ticks to see no heap growth. With a 20 ms fast interval that is ~600 ms;
  // 3 s gives a wide margin.
  const src = `
    const fill = Buffer.alloc(80, "x").toString();
    for (let k = 0; k < 30; k++) {
      const arr = [];
      for (let i = 0; i < 30000; i++) arr.push({ i, s: fill + i });
      globalThis.sink = arr;
      await new Promise(r => setTimeout(r, 5));
    }
    globalThis.sink = null;
    await new Promise(r => setTimeout(r, 3000));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: {
      ...bunEnv,
      BUN_GC_TIMER_DISABLE: undefined,
      BUN_GC_TIMER_INTERVAL: "20",
      BUN_JSC_logGC: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const log = stdout + stderr;
  const fullSweeps = (log.match(/Full sweep:/g) ?? []).length;
  expect(exitCode, log.slice(-2000)).toBe(0);
  // One from the transition tick itself. The second is scheduled for the next
  // slow tick 30 s later, outside this window.
  expect(fullSweeps).toBeGreaterThanOrEqual(1);
});

describe.skipIf(isDebug)("GarbageCollectionController eden cadence", () => {
  // 100 ticks allocating ~50 KB each is ~5 MB total over ~2 s. Before the fix
  // this produced ~128 eden collections (one per ~16 ms of wall time). With the
  // per-tick sampler gone, only the 1 s idle timer and JSC's own allocation
  // budget contribute, neither of which reaches 30 at this volume.
  test.concurrent("low-allocation setInterval does not trigger an eden GC per tick", async () => {
    const { eden } = await countEdenCollections({}, 100, 50_000);
    // Observed ~128 before the fix. A generous ceiling keeps this robust
    // against JSC heuristic changes while still failing hard on the ~60/s
    // regression.
    expect(eden).toBeLessThan(30);
  });

  // `BUN_GC_TIMER_DISABLE` / `BUN_GC_TIMER_INTERVAL` were read via the dotenv
  // loader before it had loaded the process environment, so the knobs were
  // silently ignored. With the idle timer actually off nothing in Bun requests
  // collections at all; JSC's own budget is not reached at this allocation
  // volume either.
  test.concurrent("BUN_GC_TIMER_DISABLE=1 disables the controller", async () => {
    const { eden } = await countEdenCollections({ BUN_GC_TIMER_DISABLE: "1" }, 100, 50_000);
    // Observed ~128 before the fix (env var ignored).
    expect(eden).toBeLessThan(5);
  });
});

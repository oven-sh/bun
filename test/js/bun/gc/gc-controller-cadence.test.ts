import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

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

// https://github.com/oven-sh/bun/issues/13666
// After a burst of allocation (webpack compile, big JSON parse, ...) the idle
// timer's collectAsync() picks Eden every tick because there is no allocation
// pressure, so old-generation garbage is never swept and RSS stays at the
// post-burst peak. The controller now runs one Full collectNow + allocator
// scavenge once the heap has been stable for 30 ticks, and the stability check
// tolerates the few-KB jitter in extraMemorySize between eden sweeps.
describe("GarbageCollectionController idle memory reducer", () => {
  // ~130 MB of retained objects/strings that stay live for the whole run, so
  // block_bytes_allocated is well above the 16 MB reducer floor and the only
  // heap movement is the GC timer itself. 50 setInterval ticks at 50 ms with a
  // 50 ms GC timer interval reaches 30 stable ticks around the 1.5 s mark and
  // then spends the rest of the run in slow mode.
  const fixture = `
    const hold = [];
    for (let i = 0; i < 1024; i++) {
      const s = Buffer.alloc(32 * 1024).toString("base64");
      hold.push({ id: i, s, nested: { a: s.slice(1), b: s.slice(2) } });
    }
    globalThis.__hold = hold;
    let n = 0;
    const id = setInterval(() => { if (++n >= 50) clearInterval(id); }, 50);
  `;

  async function runFixture(extraEnv: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: "50",
        BUN_JSC_logGC: "true",
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const reducerFires = (stderr.match(/IdleMemoryReducer fired/g) ?? []).length;
    const eden = (stderr.match(/=> EdenCollection/g) ?? []).length;
    expect(exitCode, stderr).toBe(0);
    return { reducerFires, eden };
  }

  test.concurrent(
    "runs a full GC + scavenge once the heap has been stable",
    async () => {
      const r = await runFixture({});
      // Before the fix the reducer did not exist (0 fires).
      expect(r.reducerFires).toBeGreaterThanOrEqual(1);
      // The exact-equality stability check never matched (extraMemorySize
      // jitters by a few KB each eden sweep), so the timer stayed in 50 ms fast
      // mode for the whole 2.5 s (~50 eden collections). With the
      // tolerance-based check it drops to slow mode after 30 ticks. Debug+ASAN
      // coalesces collect requests (see the cadence tests above) so the count
      // cannot distinguish there.
      if (!isDebug && !isASAN) {
        expect(r.eden).toBeLessThan(45);
      }
    },
    20_000,
  );

  test.concurrent(
    "BUN_IDLE_MEMORY_REDUCER_DISABLE=1 turns the reducer off",
    async () => {
      const r = await runFixture({ BUN_IDLE_MEMORY_REDUCER_DISABLE: "1" });
      expect(r.reducerFires).toBe(0);
    },
    20_000,
  );
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Bun's GarbageCollectionController samples `blockBytesAllocated + extraMemorySize`
// on every event-loop tick and arms a 16 ms one-shot when it sees growth. With an
// any-change comparison (`heap_size != prev`) the collection's own perturbation of
// those counters re-armed the timer, producing ~60 stop-the-world eden collections
// per second whenever the loop was active, independent of allocation volume. See
// https://github.com/oven-sh/bun/blob/main/src/jsc/GarbageCollectionController.rs
//
// These tests drive a setInterval workload with BUN_JSC_logGC and count the
// EdenCollection lines JSC prints.
//
// The symptom is release-only: the controller calls `collectAsync()` ~60/s on
// both build types, but on debug+ASAN a collection cycle takes ~100 ms so JSC
// coalesces dozens of requests into 2-3 actual collections, and the count cannot
// distinguish fixed from unfixed. Release cycles are ~1 ms and each request
// lands as its own collection (observed 128 vs 3).

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
      BUN_GC_TIMER_THRESHOLD: undefined,
      BUN_JSC_logGC: "true",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const log = stdout + stderr;
  const eden = (log.match(/=> EdenCollection/g) ?? []).length;
  const full = (log.match(/=> FullCollection/g) ?? []).length;
  expect(exitCode).toBe(0);
  return { eden, full };
}

describe.skipIf(isDebug)("GarbageCollectionController eden cadence", () => {
  // 100 ticks allocating ~50 KB each is ~5 MB total over ~2 s. Before the fix
  // this produced ~128 eden collections (one per ~16 ms of wall time). With a
  // 32 MB growth floor the one-shot never re-arms at this allocation volume, so
  // only the 1 s repeating timer and JSC's own budget contribute.
  test.concurrent("low-allocation setInterval does not trigger an eden GC per tick", async () => {
    const { eden } = await countEdenCollections({}, 100, 50_000);
    // Observed ~128 before the fix. A generous ceiling keeps this robust
    // against JSC heuristic changes and ASAN overhead while still failing hard
    // on the ~60/s regression.
    expect(eden).toBeLessThan(30);
  });

  // `BUN_GC_TIMER_DISABLE` / `BUN_GC_TIMER_INTERVAL` were read via the dotenv
  // loader before it had loaded the process environment, so the knobs were
  // silently ignored. Drive the controller with a tiny growth threshold so the
  // enabled case diverges sharply from disabled; each assertion below pins one
  // clause of the env-var fix.
  test.concurrent("BUN_GC_TIMER_DISABLE honours truthiness and disables the controller", async () => {
    const low = { BUN_GC_TIMER_THRESHOLD: "1024" };
    const [disabled, zero] = await Promise.all([
      countEdenCollections({ ...low, BUN_GC_TIMER_DISABLE: "1" }, 100, 50_000),
      countEdenCollections({ ...low, BUN_GC_TIMER_DISABLE: "0" }, 100, 50_000),
    ]);
    // Regressing the getenv_z fallback: `=1` ignored AND THRESHOLD ignored →
    // runs at the 32 MB default → ~3, still < 5; but `=0` then also sees ~3
    // and fails the >= 5 below. Regressing the truthiness filter: `=0`
    // disables → ~1, fails >= 5.
    expect(disabled.eden).toBeLessThan(5);
    expect(zero.eden).toBeGreaterThanOrEqual(5);
  });
});

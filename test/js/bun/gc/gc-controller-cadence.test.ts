import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

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

// Bun used to request a collection (`perform_gc()`) right before waiting on the
// entry point's promise, once more per preload, and again for a worker's entry
// point. The heap holds little more than the fresh global object at that point,
// so JSC served each request as an eden collection that freed nothing, on the
// main thread, before the first line of the program ran. These programs are too
// small to reach JSC's own allocation budget, so any eden collection JSC logs
// was requested by Bun. The full collections Bun runs on purpose are left out:
// tearing the VM down at exit (BUN_DESTRUCT_VM_ON_EXIT, which the ASAN lanes
// set), and, for a worker, once after its entry point ran and once at teardown.
describe.concurrent("no collection is requested while starting up", () => {
  const env = {
    ...bunEnv,
    // The startup requests and the idle timer both go through
    // GarbageCollectionController::perform_gc(), so BUN_GC_TIMER_DISABLE would
    // hide the requests too. Instead keep the timer from firing while a slow
    // (debug, ASAN) child is still starting its worker.
    BUN_GC_TIMER_DISABLE: undefined,
    BUN_GC_TIMER_INTERVAL: String(2 ** 31 - 1),
    // The CI runner sets 1, which makes some test-runner paths request collections.
    BUN_GARBAGE_COLLECTOR_LEVEL: "0",
    BUN_JSC_logGC: "true",
  };

  // `ran` is what the program prints once the code under test has run.
  async function edenCollectionsLoggedBy(cmd: string[], cwd?: string, ran = "entry ran") {
    await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const log = stdout + stderr;
    expect(log).toContain(ran);
    expect(exitCode, log).toBe(0);
    return log.match(/=> EdenCollection/g) ?? [];
  }

  test("running a script", async () => {
    expect(await edenCollectionsLoggedBy([bunExe(), "-e", `console.log("entry ran")`])).toEqual([]);
  });

  test("running a script with a preload", async () => {
    using dir = tempDir("gc-startup-preload", {
      "preload.js": `globalThis.preloaded = true;`,
      "entry.js": `console.log("entry ran", globalThis.preloaded);`,
    });
    const cmd = [bunExe(), "--preload", "./preload.js", "entry.js"];
    expect(await edenCollectionsLoggedBy(cmd, String(dir), "entry ran true")).toEqual([]);
  });

  test("running a test file", async () => {
    using dir = tempDir("gc-startup-test", {
      "entry.test.js": `
        import { test } from "bun:test";
        test("entry ran", () => {});
      `,
    });
    expect(await edenCollectionsLoggedBy([bunExe(), "test", "./entry.test.js"], String(dir))).toEqual([]);
  });

  test("starting a worker", async () => {
    using dir = tempDir("gc-startup-worker", {
      "entry.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        worker.onmessage = ({ data }) => {
          console.log(data);
          worker.terminate();
        };
      `,
      "worker.js": `postMessage("entry ran");`,
    });
    expect(await edenCollectionsLoggedBy([bunExe(), "entry.js"], String(dir))).toEqual([]);
  });
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

// After BUN_IDLE_GC_SECONDS of timer ticks in which the JS heap did not grow,
// the controller requests a full collection (so JSC can age out code that no
// longer runs and return memory). An app parked at a prompt still fires the odd
// timer and still counts as idle.
describe("idle release", () => {
  // Count FullCollection lines from BUN_JSC_logGC=1 while the script sits idle for a few seconds. Nothing allocates in
  // that window, so a full collection there is the idle one.
  const script = `
    setTimeout(() => console.error("MARK"), 1200);
    setTimeout(() => console.error("DONE"), 4200);
  `;

  async function run(seconds: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_JSC_logGC: "1",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Startup and (with BUN_DESTRUCT_VM_ON_EXIT) teardown do collections of their own; only count the idle window.
    const fulls = (stderr.slice(stderr.indexOf("MARK"), stderr.indexOf("DONE")).match(/FullCollection/g) || []).length;
    return { fulls, exitCode };
  }

  test.concurrent("requests a full collection once the heap has been quiet long enough", async () => {
    const { fulls, exitCode } = await run("2");
    expect(fulls).toBeGreaterThanOrEqual(1);
    expect(exitCode).toBe(0);
  });

  test.concurrent("BUN_IDLE_GC_SECONDS=0 disables it", async () => {
    const { fulls, exitCode } = await run("0");
    expect(fulls).toBe(0);
    expect(exitCode).toBe(0);
  });
});

// Those idle full collections are tagged (GCRequest::isIdle) so JSC may also let idle FTL code — which has no execution
// counter of its own and pins every baseline CodeBlock it inlined — age out in them, and only in them: a program that
// forces collections itself while running hot code must not lose that code. Eager JIT TTLs make it observable in seconds.
describe("idle release lets FTL code age out", () => {
  const script = /* js */ `
    const { heapStats, noInline } = require("bun:jsc");
    const fns = [];
    for (let i = 0; i < 40; i++) {
      const f = new Function("o", "h", "let s = 0; for (let k = 0; k < 40; k++) s += h(o, k) + " + i + "; return s;");
      noInline(f);
      fns.push(f);
    }
    const helper = (o, k) => o.a * k + o.b;
    const o = { a: 1, b: 2 };
    globalThis.keep = [helper, o, fns];
    for (let r = 0; r < 100000; r++) for (let j = 0; j < fns.length; j++) fns[j](o, helper);
    const count = () => heapStats().objectTypeCounts.FunctionCodeBlock ?? 0;
    Bun.gc(true);
    const before = count();
    if (process.env.MODE === "forced") {
      let n = 0;
      const id = setInterval(() => {
        Bun.gc(true);
        if (++n >= 6) { clearInterval(id); console.log(JSON.stringify({ before, after: count() })); }
      }, 700);
    } else {
      setTimeout(() => { Bun.gc(true); console.log(JSON.stringify({ before, after: count() })); }, 4500);
    }
  `;

  async function run(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        BUN_JSC_useEagerCodeBlockJettisonTiming: "1",
        BUN_JSC_optimizedCodeAgingQuietSeconds: "0.5",
        ...env,
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const counts = (stdout.trim().startsWith("{") ? JSON.parse(stdout.trim()) : {}) as {
      before?: number;
      after?: number;
    };
    return { ...counts, stdout, exitCode };
  }

  test.concurrent("the idle collections drop the warmed-up code", async () => {
    const { before, after, stdout, exitCode } = await run({ BUN_IDLE_GC_SECONDS: "1,1,1" });
    expect(before, stdout).toBeGreaterThan(40);
    expect(after, stdout).toBeLessThan(before! / 4);
    expect(exitCode).toBe(0);
  });

  test.concurrent("collections the program forces itself do not", async () => {
    const { before, after, stdout, exitCode } = await run({ BUN_IDLE_GC_SECONDS: "0", MODE: "forced" });
    expect(before, stdout).toBeGreaterThan(40);
    expect(after, stdout).toBeGreaterThan(before! / 2);
    expect(exitCode).toBe(0);
  });
});

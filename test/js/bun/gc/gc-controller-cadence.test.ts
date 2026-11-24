import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";

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

  // A parked app whose timers still allocate a little (a TUI redrawing its prompt) is idle: after 30 ticks in which the
  // heap grew by less than the slack, the tick goes from BUN_GC_TIMER_INTERVAL to 30 s. The back-off used to test for no
  // growth at all, so a trickle of a few KB per tick kept it requesting an eden collection on every tick for as long as
  // the app sat there (20 ms ticks, 4 KB every 20 ms for 1.6 s: ~80 collections before, ~32 after).
  test.concurrent("the tick backs off while timers allocate a trickle", async () => {
    const { eden } = await countEdenCollections({ BUN_GC_TIMER_INTERVAL: "20" }, 80, 4_000, 20);
    expect(eden).toBeLessThan(55);
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

  // Every JS thread runs them for its own heap: a Worker that has finished a burst and sits idle gives its garbage back
  // like the main thread does (a pool of 8 Workers with 50 MB each held on to 400 MB for good when only the main thread
  // ran them). The Worker's 100 MB have survived a full collection before nothing refers to them any more, so only
  // another full collection of the Worker's heap frees them, and nothing but its idle collection asks for one. Linux: it
  // reads /proc; ASAN and debug builds take too long to fill the heap.
  (!isLinux || isASAN || isDebug ? test.skip : test.concurrent)(
    "a Worker's garbage is given back by the Worker's own idle collection",
    async () => {
      using dir = tempDir("idle-worker", {
        "worker.js": `
          let junk = Array.from({ length: 100 }, (_, i) => new Array(128 * 1024).fill(i));
          Bun.gc(true);
          postMessage("full");
          setTimeout(() => { junk = null; }, 300);
          setInterval(() => {}, 1000);
        `,
        "main.js": `
          const resident = () => Number(/^VmRSS:\\s+(\\d+) kB/m.exec(require("fs").readFileSync("/proc/self/status", "utf8"))[1]) >> 10;
          globalThis.worker = new Worker(new URL("./worker.js", import.meta.url).href);
          worker.onmessage = () => {
            const full = resident();
            const deadline = performance.now() + 8000;
            const timer = setInterval(() => {
              const now = resident();
              if (now >= full - 80 && performance.now() < deadline) return;
              console.log(JSON.stringify({ full, now }));
              process.exit(0);
            }, 100);
          };
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "main.js")],
        env: { ...bunEnv, BUN_IDLE_GC_SECONDS: "2", BUN_GC_TIMER_DISABLE: undefined, BUN_GC_TIMER_INTERVAL: undefined },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const { full, now } = JSON.parse(stdout);
      expect(full).toBeGreaterThan(100);
      expect(now).toBeLessThan(full - 80);
      expect(exitCode).toBe(0);
    },
    15_000, // It fills 100 MB and waits for the collection.
  );

  // A requested collection advances at the mutator's safepoints while the mutator holds the collector's conn, and a
  // program parked in the event loop has none: a heap that does not finish marking in the first increment used to sit in
  // its concurrent phase until the program did something (the timer's eden requests are subsumed by it and provide no
  // safepoint). The JS thread now parks without heap access while an idle collection is unfinished, so the collector
  // thread finishes it. Not on Windows (libuv), where the ticks still drive it; debug/ASAN builds take too long to build
  // the heap. The child exits by itself so that JSC's buffered GC log is complete when it is read.
  (isWindows || isASAN || isDebug ? test.skip : test.concurrent)(
    "an idle collection finishes while the program is parked",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `globalThis.live = new Map();
           for (let i = 0; i < 400_000; i++) live.set(i, { id: i, name: "user-" + i, tags: ["a" + i, "b" + i], extra: { a: i, c: [i, i + 1] } });
           Bun.gc(true);
           console.error("PARKED");
           setTimeout(() => process.exit(0), 4000);`,
        ],
        env: {
          ...bunEnv,
          BUN_IDLE_GC_SECONDS: "1",
          BUN_JSC_logGC: "1",
          BUN_GC_TIMER_DISABLE: undefined,
          BUN_GC_TIMER_INTERVAL: undefined,
          // No courtesy safepoints on the first parks after JS ran: the collection gets none unless the park provides for it.
          BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS: "0",
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const log = stderr.slice(stderr.indexOf("PARKED"));
      // Every full collection that started while parked (the idle one starts ~1 s in) has ended by the time the program exits.
      const starts = [...log.matchAll(/=> FullCollection/g)].map(m => m.index);
      expect(starts.length, log).toBeGreaterThan(0);
      for (const start of starts)
        expect(log.indexOf("END]", start), log.slice(start, start + 600)).toBeGreaterThan(start);
      expect(exitCode).toBe(0);
    },
    20_000,
  );

  // An idle collection is requested, not run: it proceeds at the mutator's safepoints, and in a program that runs no JS
  // there are none once it parks in the event loop. With the collection requested on the 30 s tick (a 20 ms tick goes
  // slow after 0.6 s) a server held on to 1.5 GB of a burst's garbage for a minute and a half after its traffic stopped:
  // the JS thread now gives up heap access while it is parked with such a collection unfinished, and the collector thread
  // finishes it. 50 MB stay alive so that the collection does not finish in the step that starts it; the 300 MB that
  // nothing refers to any more a second in have survived a full collection, so only another one frees them. Linux: it
  // reads /proc; ASAN and debug builds take too long to fill the heap.
  (!isLinux || isASAN || isDebug ? test.skip : test.concurrent)(
    "a burst's garbage is given back within seconds of the idle collection",
    async () => {
      using dir = tempDir("idle-garbage", {
        "child.js": `
        const entry = i => ({ id: i, name: "user-" + i + "-" + "x".repeat(200), tags: ["a" + i, "b" + i], extra: { a: i, c: [i, i + 1] } });
        globalThis.live = new Map();
        for (let i = 0; i < 90_000; i++) live.set(i, entry(i));
        globalThis.junk = Array.from({ length: 300 }, (_, i) => new Array(128 * 1024).fill(i));
        Bun.gc(true);
        console.log("full");
        setTimeout(() => { globalThis.junk = null; }, 1000);
        process.stdin.once("data", () => process.exit(0));
      `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "child.js")],
        env: { ...bunEnv, BUN_IDLE_GC_SECONDS: "2", BUN_GC_TIMER_DISABLE: undefined, BUN_GC_TIMER_INTERVAL: "20" },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const resident = () =>
        Number(/^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${proc.pid}/status`, "utf8"))![1]) >> 10;
      await proc.stdout.getReader().read();
      const full = resident();
      expect(full).toBeGreaterThan(330);
      const deadline = performance.now() + 6000;
      let now = resident();
      while (now >= full - 250 && performance.now() < deadline) {
        await Bun.sleep(100);
        now = resident();
      }
      expect(now).toBeLessThan(full - 250);
      proc.stdin.write("exit\n");
      await proc.stdin.flush();
      expect(await proc.exited).toBe(0);
    },
    15_000, // It fills 350 MB and waits for the collection.
  );
});

// The JS thread conducts the collections it requests, and such a collection goes on only at that thread's polls. When
// marking is not done by the end of the first pause, the thread resumes itself, and a program with nothing else to do
// waits in the event loop. Helper threads mark meanwhile, but a heap with one GC marker has none (`bun -e`,
// BUN_JSC_numberOfGCMarkers=1): its collection stayed as it was for as long as the program allocated nothing, later
// requests were subsumed by it, and nothing that the program had dropped was freed. When such a wait has lasted 10 ms
// with nothing ready, the JS thread now gives up heap access for the rest of it, and the heap's collector thread ends
// the collection.
//
// Each child keeps objects alive so that marking outlasts the first pause, and stays until its stdin closes, so that a
// failure leaves no process behind. Most drop 64 objects and exit with 0 when a FinalizationRegistry callback for one
// of them runs, which takes a collection that began after the drop and ended. Before, that callback never ran.
// Only where the collector thread takes over. Not on Windows: libuv dispatches inside its poll, so the loop cannot take
// heap access back in time. Not with one CPU: the collector thread would mark on the JS thread's.
const collectorThreadTakesOver = (isLinux || isMacOS) && availableParallelism() > 1;
describe.skipIf(!collectorThreadTakesOver)("with one GC marker, a collection ends while the program waits", () => {
  const env = {
    ...bunEnv,
    // Full collections only: the first that begins after a drop and ends frees what was dropped.
    BUN_JSC_useGenerationalGC: "0",
    // The scheduled idle collections already go to the collector thread, and what is unfinished then goes with them.
    BUN_IDLE_GC_SECONDS: "0",
    // The CI runner sets 1, which makes some runtime paths request collections.
    BUN_GARBAGE_COLLECTOR_LEVEL: "0",
  };
  const ticking = { ...env, BUN_GC_TIMER_DISABLE: undefined, BUN_GC_TIMER_INTERVAL: "100" };
  const timerOff = { ...env, BUN_GC_TIMER_DISABLE: "1" };
  const oneMarker = { BUN_JSC_numberOfGCMarkers: "1" };

  // Enough for marking to outlast the first pause. A debug build marks far slower.
  const live = isDebug ? 2_000 : 100_000;
  const keep = `
  globalThis.live = new Map();
  for (let i = 0; i < ${live}; i++) live.set(i, { id: i, name: "user-" + i, tags: ["a" + i, "b" + i], extra: { a: i, c: [i, i + 1] } });
`;
  const stay = `
  process.stdin.on("end", () => process.exit(1)).resume();
`;
  // Each scenario starts in a timer, after the full collection that follows a script's entry point: that one frees
  // what the script drops sooner, and ends a collection that the script begins sooner. A script cannot see it end.
  const afterStartup = 50;
  const drop = (finalized: string) => `
  const registry = new FinalizationRegistry(() => { ${finalized} });
  setTimeout(() => { for (let i = 0; i < 64; i++) registry.register({ i }, i); }, ${afterStartup});
`;
  const request = `
  setInterval(() => Bun.gc(false), 100);
`;
  // A request is served at the thread's next poll, and an allocation has one: the collection begins here.
  const begin = `
  Bun.gc(false);
  globalThis.young = Array.from({ length: 2_000 }, (_, i) => ({ i }));
`;

  async function exitCode(cmd: string[], env: Record<string, string | undefined>, cwd?: string) {
    await using proc = Bun.spawn({ cmd, env, cwd, stdin: "pipe", stdout: "ignore", stderr: "inherit" });
    return await proc.exited;
  }

  test.concurrent("requested by the GC timer, in `bun -e`", async () => {
    expect(await exitCode([bunExe(), "-e", keep + stay + drop("process.exit(0)")], ticking)).toBe(0);
  });

  test.concurrent("requested by the GC timer, with BUN_JSC_numberOfGCMarkers=1", async () => {
    using dir = tempDir("gc-parked-ticks", { "main.js": keep + stay + drop("process.exit(0)") });
    expect(await exitCode([bunExe(), "main.js"], { ...ticking, ...oneMarker }, String(dir))).toBe(0);
  });

  test.concurrent("requested by the program", async () => {
    const script = keep + stay + drop("process.exit(0)") + request;
    expect(await exitCode([bunExe(), "-e", script], { ...timerOff, ...oneMarker })).toBe(0);
  });

  // An eden collection marks what was allocated since the collection before it and is still alive.
  test.concurrent("of the young generation", async () => {
    const script = `
      const registry = new FinalizationRegistry(() => process.exit(0));
      setTimeout(() => {
        globalThis.cache = new Map();
        for (let i = 0; i < ${live}; i++) cache.set("k" + i, { i, s: "x" + i, t: [i] });
        for (let i = 0; i < 64; i++) registry.register({ i }, i);
      }, ${afterStartup});
    `;
    const generational = { ...ticking, ...oneMarker, BUN_JSC_useGenerationalGC: undefined };
    expect(await exitCode([bunExe(), "-e", keep + stay + script], generational)).toBe(0);
  });

  test.concurrent("in a Worker", async () => {
    using dir = tempDir("gc-parked-worker", {
      "worker.js": keep + drop(`postMessage("finalized")`) + request,
      "main.js":
        stay +
        `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      worker.onmessage = () => process.exit(0);
    `,
    });
    expect(await exitCode([bunExe(), "main.js"], { ...timerOff, ...oneMarker }, String(dir))).toBe(0);
  });

  // A wakeup from another thread is still counted when the loop comes back to wait, and the loop does not call its park
  // hook then: it expects the wait to return at once. With epoll the wait blocks if the wakeup was already consumed, and
  // an unfinished collection waited through it. Five messages, so that what they allocate stays far below what makes
  // the JS thread finish the marking by itself.
  test.concurrent("begun in a callback that another thread's wakeup delivered", async () => {
    using dir = tempDir("gc-parked-wakeup", {
      "worker.js": `
      let sent = 0;
      const timer = setInterval(() => { postMessage(sent); if (++sent === 5) clearInterval(timer); }, 200);
      setTimeout(() => {}, 2 ** 31 - 1);
    `,
      "main.js":
        keep +
        stay +
        drop("process.exit(0)") +
        `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      worker.onmessage = () => { ${begin} };
    `,
    });
    expect(await exitCode([bunExe(), "main.js"], { ...timerOff, ...oneMarker }, String(dir))).toBe(0);
  });

  // Bun.build() waits for a plugin's setup() inside the call, so the loop runs below the caller's frame. What only that
  // frame refers to has to survive a collection that the collector thread ends meanwhile. `held` and `twin` are
  // reachable through WeakMap entries, which are marked last, until the collection has begun.
  test.concurrent("inside a call that waits for a promise", async () => {
    using dir = tempDir("gc-parked-nested", {
      "entry.js": `export default 1;`,
      "main.js":
        keep +
        stay +
        `
      const entries = new WeakMap(), heldKey = {}, twinKey = {};
      let twinFinalized = () => {};
      const registry = new FinalizationRegistry(token => { if (token === "held") process.exit(3); twinFinalized(); });
      let heldRef;
      (function () {
        const graph = () => ({ leaves: Array.from({ length: 200 }, (_, j) => ({ j, s: "leaf-" + j })) });
        const held = graph(), twin = graph();
        entries.set(heldKey, held);
        entries.set(twinKey, twin);
        registry.register(held, "held");
        registry.register(twin, "twin");
        heldRef = new WeakRef(held);
      })();
      setTimeout(() => {
        ${begin}
        const held = entries.get(heldKey);
        entries.delete(heldKey);
        entries.delete(twinKey);
        const again = setInterval(() => Bun.gc(false), 100);
        Bun.build({
          entrypoints: [require("path").join(import.meta.dir, "entry.js")],
          plugins: [{ name: "wait", async setup() { await new Promise(resolve => (twinFinalized = resolve)); } }],
        }).catch(() => {});
        clearInterval(again);
        process.exit(heldRef.deref() === held && held.leaves.length === 200 ? 0 : 2);
      }, ${afterStartup});
    `,
    });
    expect(await exitCode([bunExe(), "main.js"], { ...timerOff, ...oneMarker }, String(dir))).toBe(0);
  });

  // Only the JS thread runs the epilogue of a collection. The collector thread wakes the JS thread for it: nothing else
  // in this child does. The request comes a second in, when the sweeper that start-up's own collection left on a
  // 100 ms timer has finished. `C` is the collector thread in JSC's GC log.
  test.concurrent("and the JS thread is woken for its epilogue", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", keep + stay + `setTimeout(() => Bun.gc(false), 1000);`],
      env: { ...timerOff, ...oneMarker, BUN_JSC_logGC: "1" },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let log = "";
    // False if the child's log ends first.
    async function logHas(found: () => boolean) {
      while (!found()) {
        const { value, done } = await reader.read();
        if (done) return false;
        log += decoder.decode(value, { stream: true });
      }
      return true;
    }
    let ended = -1;
    expect(await logHas(() => (ended = log.search(/^\[GC<[^>]*>: C .*END\]$/m)) !== -1), log).toBe(true);
    expect(await logHas(() => log.includes("epilogue", ended)), log).toBe(true);
  });

  // The JS thread gives up heap access only in a wait that has lasted 10 ms with nothing ready. The echo leaves no such
  // wait, and allocates far less than what makes the JS thread finish the marking by itself: the collection ends after
  // it, when the program waits. Nothing tells that it will not be handed over, so the echo goes on for 400 ms, which is
  // many times what a hand-over and the collection take.
  test.concurrent("but not while the loop has something ready", async () => {
    const script = `
      let busy = false;
      const registry = new FinalizationRegistry(() => process.exit(busy ? 2 : 0));
      setTimeout(() => {
        for (let i = 0; i < 64; i++) registry.register({ i }, i);
        ${begin}
        busy = true;
        const until = performance.now() + 400;
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(socket, chunk) { socket.write(chunk); } } });
        Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: {
          open(socket) { socket.write("x"); },
          data(socket, chunk) {
            if (performance.now() < until) return void socket.write(chunk);
            busy = false;
            socket.end();
            server.stop(true);
          },
        } });
      }, ${afterStartup});
    `;
    const echo = {
      ...timerOff,
      ...oneMarker,
      // JSC's other scheduler, its choice below 4 cores, lets the JS thread mark in slices at its polls.
      BUN_JSC_useStochasticMutatorScheduler: "1",
      // The JS thread also finishes the marking when it has allocated a share of the heap's size meanwhile.
      BUN_JSC_concurrentGCMaxHeadroom: "100",
    };
    expect(await exitCode([bunExe(), "-e", keep + stay + script], echo)).toBe(0);
  });

  // The collector thread cannot stop a thread that runs JS. When marking ends while a callback runs, it leaves the last
  // phase to the JS thread, which runs it at its next poll: in the loop, before a wait whose timeout is already chosen.
  // That phase arms the sweeper's timer, so the loop comes around for it. Before, what the collection freed stayed
  // until something else woke the loop. The garbage is dropped a second and a half in, when the sweeper that start-up's
  // own collections left on a timer has finished: that timer would turn the loop too.
  // Linux: it reads /proc. ASAN and debug builds take too long to fill the heap.
  (!isLinux || isASAN || isDebug ? test.skip : test.concurrent)(
    "and is swept when the JS thread ends it at a poll of the loop",
    async () => {
      const script = `
        globalThis.garbage = [];
        for (let i = 0; i < 1_500_000; i++) garbage.push({ i, s: "g" + i, t: [i, i + 1] });
        Bun.gc(true);
        console.log("full");
        setTimeout(() => {
          globalThis.garbage = null;
          ${begin}
          // Runs while the collector thread marks, which begins 10 ms in, and polls nowhere.
          setTimeout(() => { const until = performance.now() + 300; while (performance.now() < until); }, 15);
        }, 1500);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", keep + stay + script],
        env: { ...timerOff, ...oneMarker },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const resident = () =>
        Number(/^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${proc.pid}/status`, "utf8"))![1]) >> 10;
      await proc.stdout.getReader().read();
      const full = resident();
      expect(full).toBeGreaterThan(250);
      const deadline = performance.now() + 6000;
      let now = full;
      while (now >= full - 150 && performance.now() < deadline) {
        await Bun.sleep(50);
        now = resident();
      }
      expect(now).toBeLessThan(full - 150);
    },
    15_000, // It fills 360 MB, drops them a second and a half in, and waits for the sweep.
  );

  // Where the collector thread does not take over, the collection stays with the JS thread. Nothing tells that it will
  // not be handed over, so the child waits for 300 ms, which is many times what a hand-over takes, and then ends the
  // collection itself.
  test.concurrent.each([
    ["with helper threads", { BUN_JSC_numberOfGCMarkers: "2" }],
    ["with one CPU", { WTF_numberOfProcessorCores: "1" }],
    ["with an inspector", { ...oneMarker, BUN_INSPECT_CONNECT_TO: "unix:///no-such-socket" }],
  ])("but not %s", async (_, gate) => {
    const script = `
      setTimeout(() => {
        console.error("REQUESTED");
        ${begin}
        setTimeout(() => { Bun.gc(true); process.exit(0); }, 300);
      }, ${afterStartup});
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", keep + stay + script],
      env: { ...timerOff, BUN_JSC_logGC: "1", ...gate },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const log = stderr.slice(stderr.indexOf("REQUESTED"));
    expect({
      // The collection was unfinished when the JS thread resumed: its first line ends like this.
      unfinished: /^\[GC<[^>]*>: START .*$/m.exec(log)?.[0].endsWith("...]"),
      byCollectorThread: /^\[GC<[^>]*>: (START )?C /m.test(log),
      exitCode,
    }).toEqual({ unfinished: true, byCollectorThread: false, exitCode: 0 });
  });
});

// Before the last idle collection the controller asks JSC to let go of what it gets back cheaply
// (VM::shrinkFootprintNow): for a --compile --bytecode executable, the unlinked bytecode of functions that have no linked
// code any more (an earlier idle collection unlinked it), which is decoded again from the executable when such a
// function is next called. Debug and ASAN executables are too big to compile a copy of per run.
let dir: ReturnType<typeof tempDir> | undefined;
afterAll(() => dir?.[Symbol.dispose]());
describe.skipIf(isDebug || isASAN)("the last idle collection drops code that can be decoded again", () => {
  const app = `
    import { heapStats } from "bun:jsc";
    ${Array.from({ length: 60 }, (_, i) => `function f${i}(a) { let s = a + ${i}; for (let k = 0; k < 3; k++) s += k * ${i + 1}; return [s, "f${i}"].join(":"); }`).join("\n    ")}
    const all = [${Array.from({ length: 60 }, (_, i) => `f${i}`).join(", ")}];
    const run = () => all.map((f, i) => f(i)).join("|");
    const count = () => heapStats().objectTypeCounts.UnlinkedFunctionCodeBlock ?? 0;
    const expected = run();
    Bun.gc(true);
    const before = count();
    console.error("COUNTED " + before);
    // Says what the count is four times a second, on the stream the collections are logged on, and ends when it has dropped.
    const report = after => {
      console.log(JSON.stringify({ before, after, same: run() === expected }));
      process.exit(0);
    };
    setInterval(() => {
      const now = count();
      console.error("COUNT " + now);
      if (now < before - 40) report(now);
    }, 250);
    setTimeout(() => report(count()), 12_000);
  `;

  // Built by whichever of the two tests gets there first (no hooks in here: the tests run alongside the rest of the file).
  let built: Promise<string> | undefined;
  const executable = () =>
    (built ??= (async () => {
      dir = tempDir("idle-drop-code", { "app.js": app });
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--outfile", "app", "app.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(exitCode, out + err).toBe(0);
      return join(String(dir), "app" + (isWindows ? ".exe" : ""));
    })());

  // `endAfter`: the run is ended (the child killed) once it has said its count after that many full collections have been
  // logged since it counted (the collection it forces in order to count is logged before).
  async function run(seconds: string, endAfter = Infinity) {
    const exe = await executable();
    await using proc = Bun.spawn({
      cmd: [exe],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_JSC_logGC: "1",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        // Code ages in milliseconds instead of the seconds it normally takes, so that an idle collection finds the
        // functions' CodeBlocks old as it would a minute into a real idle period.
        BUN_JSC_useEagerCodeBlockJettisonTiming: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    let log = "";
    // The last count the child has said, and how many full collections had been logged before it (tearing the VM down
    // at exit, as the ASAN lanes do, logs one after).
    const observed = () => {
      const [, before, rest = ""] = /COUNTED (\d+)([^]*)/.exec(log) ?? [];
      const said = rest.slice(0, rest.lastIndexOf("COUNT "));
      const after = /COUNT (\d+)\s*$/.exec(rest.slice(said.length).split("\n")[0])?.[1];
      return {
        before: Number(before),
        idleCollections: said.split("=> FullCollection").length - 1,
        after: after === undefined ? undefined : Number(after),
      };
    };
    const reading = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr) {
        log += decoder.decode(chunk, { stream: true });
        const { idleCollections, after } = observed();
        if (idleCollections >= endAfter && after !== undefined) proc.kill();
      }
    })();
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited, reading]);
    const same = stdout.trim().startsWith("{") ? (JSON.parse(stdout.trim()).same as boolean) : undefined;
    return { ...observed(), same, log, exitCode };
  }

  test.concurrent(
    "the second of two drops it, and it comes back",
    async () => {
      const { before, after, same, idleCollections, log, exitCode } = await run("1,1");
      expect(before, log).toBeGreaterThan(60);
      expect(idleCollections, log).toBeGreaterThanOrEqual(2);
      expect(after, log).toBeLessThan(before - 40);
      expect(same, log).toBe(true);
      expect(exitCode).toBe(0);
    },
    15_000, // It may be the one that writes the executable, of 100 MB and more.
  );

  // The first of two is a collection like any other: it has run, and the code is still there.
  test.concurrent(
    "the first of two does not",
    async () => {
      const { before, after, idleCollections, log } = await run("1,30", 1);
      expect(before, log).toBeGreaterThan(60);
      expect(idleCollections, log).toBe(1);
      expect(after, log).toBeGreaterThan(before - 40);
    },
    15_000,
  );
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

// A leak test reads the footprint right after Bun.gc(true). The allocator hands freed pages back after a purge delay, on
// its own thread, so what the collection had just freed was still resident then: 250 MB of dead typed arrays left RSS
// where it was. MADV_FREE (macOS) and ASAN's allocator do not show in RSS either way.
test.skipIf(!isLinux || isASAN)("Bun.gc(true) returns what it freed to the OS before it returns", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const rss = () => process.memoryUsage.rss() / 1048576;
        let arrays = [];
        for (let i = 0; i < 2000; i++) arrays.push(new Uint8Array(128 * 1024).fill(1));
        const held = rss();
        arrays = null;
        Bun.gc(true);
        console.log(JSON.stringify({ released: held - rss() }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout).released).toBeGreaterThan(200);
  expect(exitCode).toBe(0);
});

// One thread at a time hands the allocator's free ranges back, and its own purge thread is often the one: it starts on what
// was freed once the purge delay has passed, and a few hundred MB keep it busy for tens of milliseconds. Bun.gc(true) in the
// middle of that found the purge taken, skipped its own, and returned with all of it still resident.
test.skipIf(!isLinux || isASAN)(
  "Bun.gc(true) returns what is free to the OS while the purge thread is at work",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const rss = () => process.memoryUsage.rss() / 1048576;
          // The allocator starts its purge thread the first time a thread blocks.
          await Bun.sleep(1);
          const rounds = [];
          for (let round = 0; round < 3; round++) {
            const arrays = [];
            for (let i = 0; i < 48; i++) arrays.push(new Uint8Array(8 * 1024 * 1024).fill(1));
            const held = rss();
            // transfer(0) frees the 8 MB here and now, no collection involved. They stay resident until they are purged.
            for (const array of arrays) array.buffer.transfer(0);
            // Wait for the purge thread to start on them, which it does once the purge delay (100 ms) has passed. A round in
            // which it was not seen at work says nothing about the two at once, so it does not count as passed.
            const deadline = performance.now() + 1000;
            let started = false;
            while (!(started = rss() <= held - 32) && performance.now() < deadline);
            Bun.gc(true);
            rounds.push({ held, started, released: held - rss() });
          }
          console.log(JSON.stringify(rounds));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    for (const { started, released } of JSON.parse(stdout)) {
      expect(started, stdout).toBe(true);
      expect(released, stdout).toBeGreaterThan(300);
    }
    expect(exitCode).toBe(0);
  },
);

// JSC paces collections on the bytes a program allocates, and it decides between an eden and a full collection by the
// size of the heap after the last one. Both numbers were wrong for typed arrays and ArrayBuffers that die young, which
// is every chunk of a node:fs, node:stream or node:zlib style loop (oven-sh/WebKit#684).
describe("short-lived typed arrays and ArrayBuffers", () => {
  // With the concurrent collector off, a collection runs at the allocation that passes the budget. The collections
  // then follow from what the heap counted as allocated and from nothing else: 5000 arrays of 32 KB against the 8 MB
  // budget of a small heap are 19 eden collections.
  async function run(loopBody: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `for (let i = 0; i < 5000; i++) { ${loopBody}; }`],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_JSC_useConcurrentGC: "0",
        BUN_JSC_logGC: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const log = stdout + stderr;
    expect(exitCode, log).toBe(0);
    const eden = (log.match(/=> EdenCollection/g) ?? []).length;
    const full = (log.match(/=> FullCollection/g) ?? []).length;
    return { eden, full, total: eden + full };
  }

  // Several tests look at the same loop. Each loop runs once, so the file starts six children and not nine.
  const runs = new Map<string, ReturnType<typeof run>>();
  function collectionsIn(loopBody: string) {
    let result = runs.get(loopBody);
    if (!result) runs.set(loopBody, (result = run(loopBody)));
    return result;
  }

  // A typed array of more than 1000 elements owns a malloc'ed vector, and the heap counts that vector when the array
  // allocates it. `.buffer`, `subarray()` and Buffer's `slice()` wrap the same vector in an ArrayBuffer. The heap
  // counted the whole vector as allocated a second time there, and the loop ran 39 collections. A count well under
  // that of the array alone would mean the vector is not counted at all.
  test.concurrent.each([
    ["new Uint8Array(32768).buffer", "new Uint8Array(32768)"],
    ["new Uint8Array(32768).subarray(0, 10)", "new Uint8Array(32768)"],
    ["Buffer.allocUnsafe(32768).slice(0, 10)", "Buffer.allocUnsafe(32768)"],
  ])("the vector of %s counts as allocated once", async (withArrayBuffer, arrayAlone) => {
    const [alone, withBuffer] = await Promise.all([collectionsIn(arrayAlone), collectionsIn(withArrayBuffer)]);
    expect(alone.total).toBeGreaterThan(10);
    expect(withBuffer.total).toBeGreaterThanOrEqual(alone.total * 0.75);
    expect(withBuffer.total).toBeLessThanOrEqual(alone.total * 1.25);
  });

  // An eden collection frees the ArrayBuffers that died young, but the size of the heap kept counting them until the
  // next full collection. One eden's worth of dead buffers made the heap look full, so every second collection was a
  // full one: 9 of 19 here. What is left is a full collection at exit in the builds that tear the VM down.
  test.concurrent.each([
    "new ArrayBuffer(32768)",
    "new Uint8Array(32768).buffer",
    "Buffer.allocUnsafe(32768).slice(0, 10)",
  ])("%s that die young do not make every second collection a full one", async loopBody => {
    const { full, total } = await collectionsIn(loopBody);
    expect(full).toBeLessThanOrEqual(2);
    expect(total).toBeGreaterThan(10);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, statfsSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";

// Bun's GarbageCollectionController used to sample `blockBytesAllocated +
// extraMemorySize` on every event-loop tick and arm a 16 ms one-shot whenever
// that value changed at all. The collection's own perturbation of those counters
// re-armed the timer, producing ~60 stop-the-world eden collections per second
// whenever the loop was active, independent of allocation volume. The controller
// is now an idle timer (1 s; 30 s once the program has been quiet for half a
// minute) and the idle ladder further down; eden pacing is left to JSC's own
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

  // 30 ticks that allocate next to nothing put the timer on its 30 s tick. Work that starts then must get the fast
  // tick back at once, not half a minute later: with a 20 ms tick that shows as dozens of requested collections in the
  // second after a 15 MB burst instead of the one or two JSC decides on by itself.
  // Counts requested collections; ASAN builds fold dozens of requests into a few cycles (see the top of the file).
  (isASAN ? test.skip : test.concurrent)(
    "a burst of allocation during the 30 s tick brings the fast tick back",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          setTimeout(() => console.error("QUIET"), 1000);
          setTimeout(() => {
            console.error("BURST");
            const fill = Buffer.alloc(80, "x").toString();
            let n = 0;
            for (let i = 0; i < 180_000; i++) n += { i, s: fill + i }.s.length;
            globalThis.sink = n;
            console.error("MARK");
            setTimeout(() => { console.error("DONE"); process.exit(0); }, 1000);
          }, 1500);
        `,
        ],
        env: {
          ...bunEnv,
          BUN_GC_TIMER_DISABLE: undefined,
          BUN_GC_TIMER_INTERVAL: "20",
          BUN_IDLE_GC_SECONDS: "0",
          BUN_JSC_logGC: "true",
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      // The timer was on its 30 s tick when the burst came: nothing was requested in the half second before it.
      const beforeBurst = stderr.slice(stderr.indexOf("QUIET")).split("BURST")[0];
      expect(beforeBurst.match(/=> EdenCollection/g) ?? []).toEqual([]);
      const afterBurst = stderr.slice(stderr.indexOf("MARK")).split("DONE")[0];
      expect((afterBurst.match(/=> EdenCollection/g) ?? []).length).toBeGreaterThan(10);
      expect(exitCode).toBe(0);
    },
  );
});

// Once the program has not been loud for a BUN_IDLE_GC_SECONDS entry, the controller runs a full collection (so JSC can
// age out code that no longer runs and return memory): a ladder of up to three rungs, the entries being the seconds
// before the first and between the others. A tick is loud when the program allocated faster than 1/64 per second of what
// the collector lets it allocate before it collects by itself (128 KB a second in these small programs), whether or not
// its heap grows, or when it came seconds late. The first tick sees what starting up allocated and is loud. An app parked
// at a prompt still fires timers and runs the odd background job and is not. The second rung is followed by the page-out
// further down.
// These measure seconds of idleness: each takes between 2 and 7 s, and they run side by side.
describe.concurrent("idle release", () => {
  // The child makes a little garbage in a timer, as a parked program does (a collection that was requested starts when
  // the program next allocates), and stamps its stderr with its own clock there, which is how the parent tells when a
  // collection was logged however late it gets to read the pipe. It exits when its stdin says so or at `deadlineMs`,
  // after a last stamp: tearing the VM down (BUN_DESTRUCT_VM_ON_EXIT, which the ASAN lanes set) collects once more.
  const child = (deadlineMs: number, body = "") => `
    ${body}
    const stamp = (what = "") => console.error("T" + Math.round(performance.now()) + what);
    const exit = () => { stamp(" EXIT"); process.exit(0); };
    setInterval(() => { globalThis.sink = new Array(64).fill(0); stamp(); }, 50);
    setTimeout(exit, ${deadlineMs});
    process.stdin.once("data", exit);
  `;

  // Runs `script` with the list `seconds` on the default 1 s ticks and returns when (ms into the child's life)
  // BUN_JSC_logGC=1 logged each full collection after the first 300 ms (loading the entry point collects once) and before
  // the child's EXIT stamp. With `exitAfter`, the child is told to exit 200 ms after the parent has seen that many rungs,
  // which leaves the rung time to finish. minEdenToOldGenerationRatio=0 keeps JSC from making one of the timer's other
  // collections a full one by itself.
  async function fullCollections(script: string, seconds: string, exitAfter = Infinity) {
    // From a file: -e and --print run with a single GC marker thread (numberOfGCMarkers=1), and then the first rung's
    // concurrent collection stays open until a synchronous one, with the second rung's request folded into it.
    using dir = tempDir("idle-release", { "child.js": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "child.js")],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_JSC_logGC: "1",
        BUN_JSC_minEdenToOldGenerationRatio: "0",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let log = "";
    let told = false;
    const parse = () => {
      const at: number[] = [];
      let stamp = 0;
      for (const [, time, full] of log.split(" EXIT")[0].matchAll(/^T(\d+)$|(FullCollection)/gm)) {
        if (time) stamp = Number(time);
        else if (full && stamp >= 300) at.push(stamp);
      }
      // Rungs are a second apart here: two collections that close together are one rung's.
      return { at, rungs: at.filter((t, i) => i === 0 || t - at[i - 1] > 500) };
    };
    const reading = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr) {
        log += decoder.decode(chunk, { stream: true });
        if (!told && parse().rungs.length >= exitAfter) {
          told = true;
          // "FullCollection" is logged when a collection starts; the log does not say which later line ends it, and an
          // exit in the middle of one folds the teardown's collection into it.
          setTimeout(() => {
            try {
              proc.stdin.write("exit\n");
              proc.stdin.flush();
            } catch {}
          }, 200);
        }
      }
    })();
    const [exitCode] = await Promise.all([proc.exited, reading, proc.stdout.text()]);
    const { at, rungs } = parse();
    return {
      rungs,
      exit: { exitCode, signalCode: proc.signalCode, stamped: log.includes(" EXIT") },
      at: JSON.stringify(at),
    };
  }
  const clean = { exitCode: 0, signalCode: null, stamped: true };

  // The first tick, a second in, is loud: the rungs count from there. The three tests with a timeout wait for more
  // seconds of idleness than a test gets by default.
  test("a list of three runs three collections, a second apart", async () => {
    const { rungs, exit, at } = await fullCollections(child(8000), "1,1,1", 3);
    expect(rungs, at).toHaveLength(3);
    expect(rungs[2] - rungs[0], at).toBeLessThan(2700);
    expect(exit).toEqual(clean);
  }, 12_000);

  test("a list of two runs two, and no more after them", async () => {
    const { rungs, exit, at } = await fullCollections(child(4500), "1,1");
    expect(rungs, at).toHaveLength(2);
    expect(exit).toEqual(clean);
  }, 12_000);

  test("a list of one runs one, and no more after it", async () => {
    const { rungs, exit, at } = await fullCollections(child(3500), "1");
    expect(rungs, at).toHaveLength(1);
    expect(exit).toEqual(clean);
  });

  // An entry that is not a positive decimal number turns the ladder off. (A list of one has its collection after 2 s.)
  test.each(["0", "", "1,,1", "1,abc", "1.5", "-1"])("BUN_IDLE_GC_SECONDS=%j turns it off", async seconds => {
    const { rungs, exit, at } = await fullCollections(child(3000), seconds);
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  });

  // Short-lived arrays in small pieces, like a server under load: the same blocks are reused over and over, so the heap
  // does not grow. Debug and ASAN builds run the workload and the collections 10-100x slower, so what it allocates no
  // longer lines up with the ticks.
  test.skipIf(isDebug || isASAN).each([
    ["5 MB", 80],
    ["40 MB", 640],
  ])("a program that allocates %s a second is not idle", async (_, pieces) => {
    const churn = `
      setInterval(() => {
        let n = 0;
        for (let i = 0; i < ${pieces}; i++) n += new Array(1024).fill(i).length;
        globalThis.sink = n;
      }, 125);
    `;
    const { rungs, exit, at } = await fullCollections(child(3500, churn), "1");
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  });

  // Timers are not work: a parked program runs them too, and one that redraws a spinner builds a short string per frame.
  test.each([
    ["runs a 10 ms timer", `setInterval(() => {}, 10);`],
    [
      "redraws a spinner",
      `const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"; let i = 0;
       setInterval(() => { globalThis.frame = "\\r" + frames[i++ % 10] + " Thinking… " + i * 80 + " ms"; }, 80);`,
    ],
  ])("a program that %s still goes idle", async (_, body) => {
    const { rungs, exit, at } = await fullCollections(child(4500, body), "1", 1);
    expect(rungs, at).toHaveLength(1);
    expect(exit).toEqual(clean);
  });

  // The thread sits in a synchronous call for 4 s: the tick after it comes seconds late, which does not make those
  // seconds idle ones. No rung comes with the call's return; the first one is due two seconds later.
  test("time spent in a synchronous call is not idle time", async () => {
    const blocked = `setTimeout(() => Bun.sleepSync(4000), 1200);`;
    const { rungs, exit, at } = await fullCollections(child(6900, blocked), "2,1,1");
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  }, 12_000);
  // A rung's collection is requested, not run: it proceeds at the mutator's safepoints, and in a program that runs no JS
  // those are the timer's ticks. With the rung on the 30 s tick (a 20 ms tick goes slow after 0.6 s) a server held on to
  // 1.5 GB of a burst's garbage for a minute and a half after its traffic stopped. 50 MB stay alive so that the
  // collection does not finish in the step that starts it; the 300 MB that nothing refers to any more a second in have
  // survived a full collection, so only another one frees them. Linux: it reads /proc; ASAN and debug builds take too
  // long to fill the heap.
  test.skipIf(!isLinux || isASAN || isDebug)(
    "a burst's garbage is given back within seconds of the rung",
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
        env: {
          ...bunEnv,
          BUN_IDLE_GC_SECONDS: "2",
          BUN_GC_TIMER_DISABLE: undefined,
          BUN_GC_TIMER_INTERVAL: "20",
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const resident = () =>
        Number(/^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${proc.pid}/status`, "utf8"))![1]) >> 10;
      await proc.stdout.getReader().read();
      const full = resident();
      expect(full).toBeGreaterThan(330);
      // The rung is due 2 s after the last loud tick, which is when the heap was filled.
      const deadline = performance.now() + 6000;
      while (resident() > full - 250 && performance.now() < deadline) await Bun.sleep(100);
      expect(resident()).toBeLessThan(full - 250);
      proc.stdin.write("exit\n");
      await proc.stdin.flush();
      expect(await proc.exited).toBe(0);
    },
    20_000,
  ); // It fills 350 MB and waits for a rung.
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
        if (++n >= 4) { clearInterval(id); console.log(JSON.stringify({ before, after: count() })); }
      }, 600);
    } else {
      // Reports as soon as the code is gone; the deadline only bounds a run in which it stays, and counts from here:
      // warming up takes seconds on an ASAN build. Once a second: looking allocates 8 KB.
      const giveUp = performance.now() + 8000;
      const id = setInterval(() => {
        const after = count();
        if (after >= before / 4 && performance.now() < giveUp) return;
        clearInterval(id);
        console.log(JSON.stringify({ before, after }));
      }, 1000);
    }
  `;

  async function run(env: Record<string, string>) {
    // From a file, as in "idle release": with -e's single GC marker thread an ASAN build leaves the second rung's
    // collection open and folds the third one's request into it.
    using dir = tempDir("idle-ftl", { "child.js": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "child.js")],
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

  // With a timeout: warming up alone takes seconds on an ASAN build.
  test.concurrent(
    "the idle collections drop the warmed-up code",
    async () => {
      const { before, after, stdout, exitCode } = await run({ BUN_IDLE_GC_SECONDS: "1,1,1" });
      expect(before, stdout).toBeGreaterThan(40);
      expect(after, stdout).toBeLessThan(before! / 4);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "collections the program forces itself do not",
    async () => {
      const { before, after, stdout, exitCode } = await run({ BUN_IDLE_GC_SECONDS: "0", MODE: "forced" });
      expect(before, stdout).toBeGreaterThan(40);
      expect(after, stdout).toBeGreaterThan(before! / 2);
      expect(exitCode).toBe(0);
    },
    30_000,
  );
});

// The second rung (or the only one) also has the kernel reclaim the file-backed pages of a standalone executable's
// embedded module graph, which the program is not using; they are read back from the file when touched. The executable's
// own code stays. MADV_PAGEOUT skips pages another process maps and dirty ones, and tmpfs pages are not file-backed, so
// the tests run one standalone executable, one at a time, from a disk-backed temp dir and written back (not a copy each,
// side by side: on a slow disk a child does not get to run while the next copy is being written). Debug and ASAN
// executables are too big.
const TMPFS_MAGIC = 0x01021994;
const cannotObservePageOut = !isLinux || isDebug || isASAN || statfsSync(tmpdir()).type === TMPFS_MAGIC;
describe.skipIf(cannotObservePageOut)("idle release pages out the module graph", () => {
  // The program reads a 3 MB embedded file once it is running (Bun releases the module graph's pages itself after the
  // entry point has loaded), so that the module graph is resident, says so, and then sits there until its stdin says
  // otherwise (DEADLINE_MS is for a test that has gone away). It is the test that looks, at /proc/<pid>/smaps: reading
  // that allocates a few hundred KB, which is a loud tick. WORKER=1 keeps a Worker alive
  // meanwhile (for WORKER_MS if that is set).
  const app = `
    import embedded from "./embedded.bin" with { type: "file" };
    if (process.env.WORKER) {
      const worker = (globalThis.worker = new Worker("data:text/javascript,setInterval(() => {}, 1000)"));
      if (process.env.WORKER_MS) setTimeout(() => worker.terminate(), Number(process.env.WORKER_MS));
      // A requested collection finishes at the mutator's next safepoint, and a request that finds one still open is
      // folded into it: enter JS often enough for each rung's collection to be one of its own.
      setInterval(() => {}, 50);
    }
    // Before the first tick, a second in, which is loud anyway.
    setTimeout(() => {
      globalThis.read = require("fs").readFileSync(embedded).length;
      console.error("READY");
      console.log(Math.round(performance.now()));
    }, 300);
    setTimeout(() => process.exit(0), Number(process.env.DEADLINE_MS));
    // After a last stamp: tearing the VM down (BUN_DESTRUCT_VM_ON_EXIT, which the ASAN lanes set) collects once more.
    process.stdin.once("data", () => { console.error("EXIT"); process.exit(0); });
  `;

  let dir: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    dir = tempDir("idle-page-out", {
      "app.js": app,
      "embedded.bin": Buffer.alloc(3 * 1024 * 1024, "x"),
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--outfile", "app", "app.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildExit, buildOut + buildErr).toBe(0);
    const fd = openSync(join(String(dir), "app"), "r+");
    fsyncSync(fd);
    closeSync(fd);
  }, 60_000); // It writes an executable of 100 MB and more.
  afterAll(() => dir?.[Symbol.dispose]());

  // Resident KB of the executable's code and of the mapping that holds the module graph (its last writable one).
  function mappings(pid: number, exe: string) {
    const mine = readFileSync(`/proc/${pid}/smaps`, "utf8")
      .split(/\n(?=[0-9a-f]+-[0-9a-f]+ )/)
      .filter(m => m.split("\n")[0].endsWith(exe));
    const rss = (perms: string) =>
      mine.filter(m => m.split(" ")[1] === perms).map(m => Number(/^Rss:\s+(\d+) kB/m.exec(m)![1]));
    return { text: rss("r-xp")[0], graph: rss("rw-p").at(-1)! };
  }

  // Runs the executable with the list `seconds` and looks at its mappings every 50 ms from the moment it has read the
  // embedded file: the kernel may reclaim clean pages by itself, so only a mapping that has less than a quarter of what
  // it had then counts as gone. Returns when (in the child's ms) `watch` ("text": the executable's code, "graph": the
  // mapping that holds the module graph) was first seen gone, which ends the run, or what was resident just before
  // `deadlineMs`.
  async function run(seconds: string, watch: "text" | "graph", deadlineMs: number, env: Record<string, string> = {}) {
    // Before 1.8 s no rung can have run: a mapping that is gone by then was taken by the kernel, which happens to pages
    // that have just been read when memory is short, and says nothing. Again, then.
    for (let attempt = 1; ; attempt++) {
      const { log, ...result } = await once(seconds, watch, deadlineMs, env);
      if (result[watch] === "gone" && result.at < 1800 && attempt < 3) continue;
      // A rung has run, which is what makes "still resident" mean something.
      expect(log).toContain("FullCollection");
      return result;
    }
  }
  async function once(seconds: string, watch: "text" | "graph", deadlineMs: number, env: Record<string, string>) {
    const exe = realpathSync(join(String(dir), "app"));
    await using proc = Bun.spawn({
      cmd: [exe],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: undefined,
        DEADLINE_MS: String(deadlineMs + 3000),
        BUN_JSC_logGC: "1",
        ...env,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const readAt = Number(new TextDecoder().decode((await reader.read()).value));
    const since = performance.now();
    const had = mappings(proc.pid, exe);
    // The child is told to exit before its own deadline: the mappings of a process that is exiting are no measure.
    let has = had;
    let at = readAt;
    while (at < deadlineMs && has[watch] * 4 > had[watch]) {
      await Bun.sleep(50);
      has = mappings(proc.pid, exe);
      at = Math.round(readAt + performance.now() - since);
    }
    proc.stdin.write("exit\n");
    await proc.stdin.flush();
    const [log, exitCode] = await Promise.all([stderr, proc.exited]);
    expect({ exitCode, signalCode: proc.signalCode }, log).toEqual({ exitCode: 0, signalCode: null });
    expect(had.text).toBeGreaterThan(8 * 1024);
    expect(had.graph).toBeGreaterThan(3 * 1024);
    const still = (name: "text" | "graph") => (has[name] * 4 > had[name] ? "resident" : "gone");
    return { text: still("text"), graph: still("graph"), at, log };
  }

  // One at a time and with a timeout: a run takes up to 4 s and may be repeated (see `run`).
  test("the module graph goes with the second rung of three", async () => {
    const { at, ...mappings } = await run("1,1,30", "graph", 4000);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(2800);
  }, 15_000);

  test("and of two", async () => {
    const { at, ...mappings } = await run("1,1", "graph", 4000);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(2800);
  }, 15_000);

  test("with the only rung of a list of one", async () => {
    const { at, ...mappings } = await run("1", "graph", 3000);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
  }, 15_000);

  test("an entry too large to read is an hour, not the end of the list", async () => {
    const { at, ...mappings } = await run("1,99999999999", "graph", 2800);
    expect(mappings).toEqual({ text: "resident", graph: "resident" });
  }, 15_000);

  // The page-outs are for the whole process and the ladder only watches the main thread. The rungs run when they are due
  // (their collections are for this thread's heap), and what they could not page out follows on the first tick that finds
  // no Worker, without the program having to be loud and quiet again first. (The program keeps its Worker in a global:
  // one that nothing refers to goes with the first collection.)
  test("a Worker that stays alive does not put off the collections", async () => {
    const exe = realpathSync(join(String(dir), "app"));
    await using proc = Bun.spawn({
      cmd: [exe],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: "1,1,1",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        BUN_JSC_logGC: "1",
        DEADLINE_MS: "9000",
        WORKER: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    await proc.stdout.getReader().read();
    // The rungs are due 2, 3 and 4 s into the child's life.
    await Bun.sleep(4400);
    proc.stdin.write("exit\n");
    await proc.stdin.flush();
    const [log, exitCode] = await Promise.all([stderr, proc.exited]);
    expect(
      log
        .slice(log.indexOf("READY"))
        .split("EXIT")[0]
        .match(/FullCollection/g),
    ).toHaveLength(3);
    expect(exitCode).toBe(0);
  }, 15_000);

  test("nothing is paged out while a Worker is alive, and it is once the Worker is gone", async () => {
    const { at, ...mappings } = await run("1", "graph", 6000, { WORKER: "1", WORKER_MS: "3000" });
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(3000);
  }, 15_000);

  test("not with BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE=1", async () => {
    const { at, ...mappings } = await run("1", "graph", 2800, { BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: "1" });
    expect(mappings).toEqual({ text: "resident", graph: "resident" });
  }, 15_000);
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

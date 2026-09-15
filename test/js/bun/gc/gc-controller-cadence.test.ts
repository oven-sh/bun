import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, fsyncSync, openSync, statfsSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { tmpdir } from "os";
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
});

// Once the program has not been busy for a BUN_IDLE_GC_SECONDS entry, the controller runs a full collection (so JSC can
// age out code that no longer runs and return memory): a ladder of up to three rungs, the entries being the seconds before
// the first and between the others. Busy is a heap that grew, or a tick that came seconds late. An app parked at a prompt
// still fires the odd timer and still counts as idle. The second rung is followed by the page-out further down.
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

  // Runs `script` with the list `seconds` on 100 ms ticks and returns when (ms into the child's life) BUN_JSC_logGC=1
  // logged each full collection after the first 300 ms (loading the entry point collects once) and before the child's
  // EXIT stamp. With `exitAfter`, the child is told to exit 200 ms after the parent has seen that many rungs, which
  // leaves the rung time to finish. minEdenToOldGenerationRatio=0 keeps JSC from making one of the timer's other
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
        BUN_GC_TIMER_INTERVAL: "100",
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

  test("a list of three runs three collections, a second apart", async () => {
    const { rungs, exit, at } = await fullCollections(child(4500), "1,1,1", 3);
    expect(rungs, at).toHaveLength(3);
    expect(exit).toEqual(clean);
  });

  test("a list of two runs two", async () => {
    const { rungs, exit, at } = await fullCollections(child(3500), "1,1", 2);
    expect(rungs, at).toHaveLength(2);
    expect(exit).toEqual(clean);
  });

  test("a list of one runs one, and no more after it", async () => {
    const { rungs, exit, at } = await fullCollections(child(2000), "1");
    expect(rungs, at).toHaveLength(1);
    expect(exit).toEqual(clean);
  });

  // An entry that is not a positive decimal number turns the ladder off.
  test.each(["0", "", "1,,1", "1,abc", "1.5", "-1"])("BUN_IDLE_GC_SECONDS=%j turns it off", async seconds => {
    const { rungs, exit, at } = await fullCollections(child(1700), seconds);
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  });

  // 8 MB more of live objects every 250 ms.
  test("a program whose heap keeps growing is not idle", async () => {
    const growing = `
      const kept = [];
      setInterval(() => { for (let i = 0; i < 80_000; i++) kept.push({ i, s: "x" + i }); }, 250);
    `;
    const { rungs, exit, at } = await fullCollections(child(1700, growing), "1");
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  });

  // Timers are not work: a parked program runs them too.
  test("a program that runs a 10 ms timer still goes idle", async () => {
    const { rungs, exit, at } = await fullCollections(child(3000, `setInterval(() => {}, 10);`), "1", 1);
    expect(rungs, at).toHaveLength(1);
    expect(exit).toEqual(clean);
  });

  // The thread sits in a synchronous call for 2.5 s: the tick after it comes seconds late, which does not make those
  // seconds idle ones. No rung comes with the call's return; the first one is due a second later.
  test("time spent in a synchronous call is not idle time", async () => {
    const blocked = `setTimeout(() => Bun.sleepSync(2500), 100);`;
    const { rungs, exit, at } = await fullCollections(child(3300, blocked), "1,1,1");
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  });
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
  // entry point has loaded), so that the module graph is resident. It watches RssFile; when that falls by 2 MB it looks
  // at its own mappings in /proc/self/smaps, because the kernel may reclaim clean pages by itself: only a mapping that
  // lost more than half of what it had once the embedded file was read counts. WATCH names the mapping ("text": the
  // executable's code, "graph": the one that holds the module graph); the program reports the first time that one has,
  // or that it has not by DEADLINE_MS. WORKER=1 keeps a Worker alive meanwhile, for WORKER_MS if that is set.
  const app = `
    import embedded from "./embedded.bin" with { type: "file" };
    const { readFileSync } = require("fs");
    const fileResident = () => Number(/^RssFile:\\s+(\\d+) kB/m.exec(readFileSync("/proc/self/status", "utf8"))[1]);
    const mappings = () => {
      const mine = readFileSync("/proc/self/smaps", "utf8")
        .split(/\\n(?=[0-9a-f]+-[0-9a-f]+ )/)
        .filter(m => m.split("\\n")[0].endsWith(process.execPath));
      const rss = perms => mine.filter(m => m.split(" ")[1] === perms).map(m => Number(/^Rss:\\s+(\\d+) kB/m.exec(m)[1]));
      return { text: rss("r-xp")[0], graph: rss("rw-p").at(-1) };
    };
    if (process.env.WORKER) {
      // In a global: a Worker that nothing refers to goes with the first full collection.
      const worker = (globalThis.worker = new Worker("data:text/javascript,setInterval(() => {}, 1000)"));
      if (process.env.WORKER_MS) setTimeout(() => worker.terminate(), Number(process.env.WORKER_MS));
    }
    setTimeout(async () => { globalThis.read = (await Bun.file(embedded).bytes()).length; }, 300);
    let had, peak = 0;
    const watch = process.env.WATCH;
    const timer = setInterval(() => {
      if (!globalThis.read) return;
      if (!had) {
        had = mappings();
        console.error("READY");
      }
      const resident = fileResident();
      peak = Math.max(peak, resident);
      const gaveUp = performance.now() > Number(process.env.DEADLINE_MS);
      if (peak - resident < 2 * 1024 && !gaveUp) return;
      peak = resident;
      const has = mappings();
      if (has[watch] * 2 > had[watch] && !gaveUp) return;
      clearInterval(timer);
      console.log(JSON.stringify({ had, has, at: Math.round(performance.now()) }));
      // Tearing the VM down (BUN_DESTRUCT_VM_ON_EXIT, which the ASAN lanes set) collects once more.
      console.error("EXIT");
      process.exit(0);
    }, 50);
  `;

  let dir: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    dir = tempDir("idle-page-out", { "app.js": app, "embedded.bin": Buffer.alloc(3 * 1024 * 1024, "x") });
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
  }, 60_000);
  afterAll(() => dir?.[Symbol.dispose]());

  async function run(seconds: string, watch: "text" | "graph", deadlineMs: number, env: Record<string, string> = {}) {
    const exe = join(String(dir), "app");
    await using proc = Bun.spawn({
      cmd: [exe],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: "100",
        BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: undefined,
        WATCH: watch,
        DEADLINE_MS: String(deadlineMs),
        BUN_JSC_logGC: "1",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, signalCode: proc.signalCode }, stdout + stderr).toEqual({ exitCode: 0, signalCode: null });
    // A rung has run, which is what makes "still resident" mean something.
    expect(stderr, stdout).toContain("FullCollection");
    const { had, has, at } = JSON.parse(stdout) as Record<"had" | "has", { text: number; graph: number }> & {
      at: number;
    };
    expect(had.text).toBeGreaterThan(8 * 1024);
    expect(had.graph).toBeGreaterThan(3 * 1024);
    const still = (name: "text" | "graph") => (has[name] * 2 > had[name] ? "resident" : "gone");
    // The collections between the moment the program took its baseline and its exit.
    const collections =
      stderr
        .slice(stderr.indexOf("READY"))
        .split("EXIT")[0]
        .match(/FullCollection/g)?.length ?? 0;
    return { text: still("text"), graph: still("graph"), at, collections };
  }

  test("the module graph goes with the second rung of three", async () => {
    const { at, collections, ...mappings } = await run("1,1,30", "graph", 3500);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(1800);
  });

  test("and of two", async () => {
    const { at, collections, ...mappings } = await run("1,1", "graph", 3500);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(1800);
  });

  test("with the only rung of a list of one", async () => {
    const { at, collections, ...mappings } = await run("1", "graph", 2500);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
  });

  test("an entry too large to read is an hour, not the end of the list", async () => {
    const { at, collections, ...mappings } = await run("1,99999999999", "graph", 2000);
    expect(mappings).toEqual({ text: "resident", graph: "resident" });
  });

  // The page-out is for the whole process and the ladder only watches the main thread: the rung runs when it is due,
  // after a second, and its page-out follows when the Worker is gone, without the program having to be busy and idle
  // again first.
  test("a Worker that stays alive puts off the page-out, not the collections", async () => {
    const { at, collections, ...mappings } = await run("1,1,1", "graph", 3700, { WORKER: "1" });
    expect(mappings).toEqual({ text: "resident", graph: "resident" });
    expect(collections).toBe(3);
  });

  test("not while a Worker is alive, and once it is gone", async () => {
    const { at, collections, ...mappings } = await run("1", "graph", 4500, { WORKER: "1", WORKER_MS: "2000" });
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(2000);
  });

  test("not with BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE=1", async () => {
    const { at, collections, ...mappings } = await run("1", "graph", 2000, {
      BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: "1",
    });
    expect(mappings).toEqual({ text: "resident", graph: "resident" });
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
        if (++n >= 4) { clearInterval(id); console.log(JSON.stringify({ before, after: count() })); }
      }, 600);
    } else {
      // Reports as soon as the code is gone; the deadline only bounds a run in which it stays, and counts from here:
      // warming up takes seconds on an ASAN build.
      const giveUp = performance.now() + 6000;
      const id = setInterval(() => {
        const after = count();
        if (after >= before / 4 && performance.now() < giveUp) return;
        clearInterval(id);
        console.log(JSON.stringify({ before, after }));
      }, 100);
    }
  `;

  async function run(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: "100",
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

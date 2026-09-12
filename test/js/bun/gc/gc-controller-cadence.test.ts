import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, closeSync, copyFileSync, fsyncSync, openSync, statfsSync } from "fs";
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
          setTimeout(() => {
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
      const afterBurst = stderr.slice(stderr.indexOf("MARK")).split("DONE")[0];
      expect((afterBurst.match(/=> EdenCollection/g) ?? []).length).toBeGreaterThan(10);
      expect(exitCode).toBe(0);
    },
  );
});

// After BUN_IDLE_GC_SECONDS in which the program did no real work, the controller requests a full collection (so JSC can
// age out code that no longer runs and return memory). Work is measured by allocation: a leaky bucket that drains at
// 2 MB per second and holds 8 MB. An app parked at a prompt still fires timers and runs the odd background job and
// still counts as idle; one that allocates faster than that for long does not, whether or not its heap grows.
describe.concurrent("idle release", () => {
  // Counts the FullCollection lines BUN_JSC_logGC=1 prints after the child's MARK, until the first one (`untilFirst`)
  // or until the child prints DONE and exits. minEdenToOldGenerationRatio=0 keeps JSC from deciding on a full collection
  // by itself, so one in that window is the idle one.
  async function idleCollections(script: string, seconds: string, untilFirst: boolean, tickMs?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_JSC_logGC: "1",
        BUN_JSC_minEdenToOldGenerationRatio: "0",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: tickMs,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    let log = "";
    // Teardown (with BUN_DESTRUCT_VM_ON_EXIT) does a full collection of its own after DONE.
    const count = () =>
      (
        log
          .slice(log.indexOf("MARK"))
          .split("DONE")[0]
          .match(/FullCollection/g) ?? []
      ).length;
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      log += decoder.decode(chunk, { stream: true });
      // Seen: the child is killed on the way out, so there is no exit code to report.
      if (untilFirst && log.includes("MARK") && count() > 0) return { collections: count() };
    }
    // Ran to its own deadline: it must have got there in one piece.
    expect(log).toContain("DONE");
    return { collections: count(), exitCode: await proc.exited };
  }
  // The child gives up (DONE) after `windowMs`: the deadline of a test that waits for a collection, the whole
  // observation of one that expects none (there is no positive signal for "was not collected").
  const child = (windowMs: number, body = "") => `
    ${body}
    setTimeout(() => console.error("MARK"), 300);
    setTimeout(() => { console.error("DONE"); process.exit(0); }, ${windowMs});
  `;

  test.concurrent("requests a full collection once the program has been quiet long enough", async () => {
    expect(await idleCollections(child(4500), "2", true)).toEqual({ collections: 1 });
  });

  test.concurrent("BUN_IDLE_GC_SECONDS=0 disables it", async () => {
    expect(await idleCollections(child(3500), "0", false)).toEqual({ collections: 0, exitCode: 0 });
  });

  // Debug and ASAN builds run the workloads and the collections 10-100x slower, so what a job allocates no longer lines
  // up with the ticks these two count on.
  const workloadTest = test.skipIf(isDebug || isASAN);

  // ~3 MB of short-lived objects every 1.7 s: each run needs that much in fresh blocks and the collection after it
  // hands them back, so a controller that watches the heap's footprint sees growth every time and never 2 s of quiet.
  workloadTest("a background job that allocates a few MB now and then does not prevent it", async () => {
    const job = `
      const fill = Buffer.alloc(80, "x").toString();
      setInterval(() => {
        let n = 0;
        for (let i = 0; i < 36_000; i++) n += { i, s: fill + i }.s.length;
        globalThis.sink = n;
      }, 1700);
    `;
    expect(await idleCollections(child(4500, job), "2", true, "500")).toEqual({ collections: 1 });
  });

  // ~10 MB of short-lived arrays every second, in small pieces, like a server under load: the same blocks are reused
  // over and over, so the heap's footprint is flat.
  workloadTest("a program that keeps allocating is not idle, even though its heap does not grow", async () => {
    const churn = `
      setInterval(() => {
        let n = 0;
        for (let i = 0; i < 320; i++) n += new Array(1024).fill(i).length;
        globalThis.sink = n;
      }, 250);
    `;
    expect(await idleCollections(child(4000, churn), "2", false, "500")).toEqual({ collections: 0, exitCode: 0 });
  });
});

// A tick after the last idle collection the controller also has the kernel reclaim the executable's own read-only
// pages if the process was idle on the CPU too. MADV_PAGEOUT skips pages another process maps (the test runner is the
// same executable) and tmpfs pages are not file-backed, so the child runs from a copy on a disk-backed temp dir.
// Debug and ASAN executables are too big to copy per test, and their collections alone use more CPU than "idle" allows.
const TMPFS_MAGIC = 0x01021994;
const cannotObservePageOut = !isLinux || isDebug || isASAN || statfsSync(tmpdir()).type === TMPFS_MAGIC;
describe.skipIf(cannotObservePageOut)("idle release pages out the executable image", () => {
  // Reports file-backed resident memory at start and once it fell under 60% of that, or at the deadline.
  const script = (busy: boolean, waitMs: number) => /* js */ `
    const { readFileSync } = require("fs");
    const fileResident = () => Number(/^RssFile:\\s+(\\d+) kB/m.exec(readFileSync("/proc/self/status", "utf8"))[1]);
    const before = fileResident();
    const start = Date.now();
    const deadline = start + ${waitMs};
    const timer = setInterval(() => {
      const now = fileResident();
      if (now < before * 0.6 || Date.now() > deadline) {
        clearInterval(timer);
        console.log(JSON.stringify({ before, now, at: Date.now() - start }));
      }
      // A quarter of one core, without growing the heap.
      for (const end = performance.now() + ${busy ? 60 : 0}; performance.now() < end; );
    }, 250);
  `;

  // Each child needs its own copy (see above), made up front so that copying does not count against the tests' clocks.
  // Only clean pages can be reclaimed; a copy that was not reflinked is all dirty page cache until written back.
  let dir: ReturnType<typeof tempDir>;
  let copies: string[];
  beforeAll(() => {
    dir = tempDir("idle-page-out", {});
    copies = [0, 1, 2, 3, 4].map(i => {
      const exe = join(String(dir), "bun-copy-" + i);
      copyFileSync(bunExe(), exe);
      chmodSync(exe, 0o755);
      const fd = openSync(exe, "r+");
      fsyncSync(fd);
      closeSync(fd);
      return exe;
    });
  });
  afterAll(() => dir[Symbol.dispose]());

  // Runs `source` in a child and returns the JSON it printed.
  async function runScript(source: string, env: Record<string, string>) {
    const exe = copies.pop()!;
    await using proc = Bun.spawn({
      cmd: [exe, "-e", source],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: "1,1",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: undefined,
        ...env,
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { ...(JSON.parse(stdout) as Record<string, number>), exitCode };
  }
  const run = (busy: boolean, env: Record<string, string>, waitMs = 4200) => runScript(script(busy, waitMs), env);

  test.concurrent("file-backed resident memory drops once the process is idle", async () => {
    const { before, now, exitCode } = await run(false, {}, 15_000);
    expect(now).toBeLessThan(before * 0.6);
    expect(exitCode).toBe(0);
  });

  // Collections at 1, 2 and 4 s: paging the image out after the second one would have the third read it back in.
  test.concurrent(
    "only after the last idle collection",
    async () => {
      const { before, now, at, exitCode } = await run(false, { BUN_IDLE_GC_SECONDS: "1,1,2" }, 15_000);
      expect(now).toBeLessThan(before * 0.6);
      expect(at).toBeGreaterThan(4000);
      expect(exitCode).toBe(0);
    },
    20_000,
  );

  test.concurrent("not while the process is using the CPU with a heap that has stopped growing", async () => {
    const { before, now, exitCode } = await run(true, {});
    expect(now).toBeGreaterThan(before * 0.6);
    expect(exitCode).toBe(0);
  });

  // A parked program's rare background jobs read a lot of the executable back in without being work. Once the idle
  // collections are done, file-backed resident memory well above where it settled after the last page-out gets it
  // requested again.
  test.concurrent("what a background job reads back in is released again while the quiet lasts", async () => {
    const source = /* js */ `
      const { readFileSync } = require("fs");
      const fileResident = () => Number(/^RssFile:\\s+(\\d+) kB/m.exec(readFileSync("/proc/self/status", "utf8"))[1]);
      const start = fileResident();
      const deadline = Date.now() + 15_000;
      let previous = start, steady = 0, low, touched;
      const timer = setInterval(() => {
        const now = fileResident();
        if (low === undefined) {
          // The first page-out has finished and the controller has seen where things settled once the number is down
          // and has not fallen for a quarter of a lease and a tick (there is nothing else to observe for the latter).
          steady = now < start * 0.6 && now >= previous ? steady + 1 : 0;
          previous = now;
          if (steady < 6 && Date.now() < deadline) return;
          low = now;
          // Code and data this process has not run yet: locale data, the transpiler, compression, hashing.
          for (const locale of ["ja-JP", "ar-EG", "hi-IN", "de-DE", "zh-Hant-TW", "th-TH"]) {
            new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "full" }).format(0);
            new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(1234.5);
            ["b", "a"].sort(new Intl.Collator(locale).compare);
            [...new Intl.Segmenter(locale, { granularity: "word" }).segment("a b")];
          }
          new Bun.Transpiler({ loader: "tsx" }).transformSync("export const a: number = <div>{1}</div>;");
          require("zlib").gunzipSync(require("zlib").gzipSync("x"));
          require("crypto").createHash("sha512").update("x").digest("hex");
          touched = fileResident();
        } else if (now < low + (touched - low) / 2 || Date.now() > deadline) {
          clearInterval(timer);
          console.log(JSON.stringify({ start, low, touched, now }));
        }
      }, 100);
    `;
    const { start, low, touched, now, exitCode } = await runScript(source, { BUN_GC_TIMER_INTERVAL: "250" });
    expect(low).toBeLessThan(start * 0.6);
    expect(touched).toBeGreaterThan(low + 8 * 1024);
    expect(now).toBeLessThan(low + (touched - low) / 2);
    expect(exitCode).toBe(0);
  });

  test.concurrent("BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE=1 disables it", async () => {
    const { before, now, exitCode } = await run(false, { BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: "1" });
    expect(now).toBeGreaterThan(before * 0.6);
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

// Once the program has been at rest for BUN_IDLE_SHRINK_QUIET_MS after the last idle collection, the controller asks JSC
// to let go of the code it can get back cheaply (VM::shrinkFootprintNow): for a --compile --bytecode executable, the
// unlinked bytecode of functions that have no linked code any more, which is decoded again from the executable when
// such a function is next called. BUN_IDLE_SHRINK_EVERYTHING=1 also drops the code that is still linked.
// Debug and ASAN builds are skipped: the sequence below has a second or so of slack at release speed, and their
// executables are too big to compile a copy of per run.
describe.skipIf(isDebug || isASAN)("deep-idle shrink", () => {
  const app = `
    import { heapStats } from "bun:jsc";
    ${Array.from({ length: 60 }, (_, i) => `function f${i}(a) { let s = a + ${i}; for (let k = 0; k < 3; k++) s += k * ${i + 1}; return [s, "f${i}"].join(":"); }`).join("\n    ")}
    const all = [${Array.from({ length: 60 }, (_, i) => `f${i}`).join(", ")}];
    const run = () => all.map((f, i) => f(i)).join("|");
    const count = () => heapStats().objectTypeCounts.UnlinkedFunctionCodeBlock ?? 0;
    const expected = run();
    Bun.gc(true);
    const before = count();
    const deadline = performance.now() + Number(process.env.WAIT_MS);
    const timer = setInterval(() => {
      const now = count();
      if (now < before - 40 || performance.now() > deadline) {
        clearInterval(timer);
        console.log(JSON.stringify({ before, after: now, same: run() === expected }));
      }
    }, 500);
  `;

  let dir: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    dir = tempDir("deep-idle-shrink", { "app.js": app });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--outfile", "app", "app.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildErr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildExit, buildErr).toBe(0);
  });
  afterAll(() => dir?.[Symbol.dispose]());

  async function run(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [String(dir) + "/app"],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        // One idle collection after 1 s of quiet, the shrink 1 s later. Code ages in milliseconds instead of the
        // seconds it normally takes, so that the idle collection finds the functions' CodeBlocks old as it would a
        // minute into a real idle period.
        BUN_IDLE_GC_SECONDS: "1",
        BUN_JSC_useEagerCodeBlockJettisonTiming: "1",
        ...env,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const result = (stdout.trim().startsWith("{") ? JSON.parse(stdout.trim()) : {}) as {
      before?: number;
      after?: number;
      same?: boolean;
    };
    return { ...result, stdout, exitCode };
  }

  for (const everything of ["0", "1"]) {
    test.concurrent(
      `drops re-decodable unlinked code after the quiet period, and it comes back (BUN_IDLE_SHRINK_EVERYTHING=${everything})`,
      async () => {
        const { before, after, same, stdout, exitCode } = await run({
          BUN_IDLE_SHRINK_QUIET_MS: "1000",
          BUN_IDLE_SHRINK_EVERYTHING: everything,
          // The child reports as soon as the count has dropped; the deadline only bounds a failing run.
          WAIT_MS: "9000",
        });
        expect(before, stdout).toBeGreaterThan(60);
        expect(after, stdout).toBeLessThan(before! - 40);
        expect(same, stdout).toBe(true);
        expect(exitCode).toBe(0);
      },
      15_000,
    );
  }

  test.concurrent("BUN_IDLE_SHRINK_QUIET_MS=0 disables it", async () => {
    const { before, after, same, stdout, exitCode } = await run({ BUN_IDLE_SHRINK_QUIET_MS: "0", WAIT_MS: "3500" });
    expect(before, stdout).toBeGreaterThan(60);
    expect(after, stdout).toBeGreaterThan(before! - 40);
    expect(same, stdout).toBe(true);
    expect(exitCode).toBe(0);
  });
});

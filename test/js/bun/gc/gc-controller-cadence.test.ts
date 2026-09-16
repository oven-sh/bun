import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, statfsSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
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
  // second after a 15 MB burst instead of the one or two JSC decides on by itself. Also when the burst is over within a
  // second of the last tick and the program parks: the look that the burst asks for comes a second after that tick,
  // from the timer, not with the next turn of an event loop that has nothing to turn for.
  // Counts requested collections; ASAN builds fold dozens of requests into a few cycles (see the top of the file).
  (isASAN ? test.skip : test.concurrent).each([
    ["", "20", 1000, 1500, 1000],
    [", also when the program parks right after it", "10", 600, 900, 1500],
  ])(
    "a burst of allocation during the 30 s tick brings the fast tick back%s",
    async (_, tick, quietAt, burstAt, doneAfter) => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          setTimeout(() => console.error("QUIET"), ${quietAt});
          setTimeout(() => {
            console.error("BURST");
            const fill = Buffer.alloc(80, "x").toString();
            let n = 0;
            for (let i = 0; i < 180_000; i++) n += { i, s: fill + i }.s.length;
            globalThis.sink = n;
            console.error("MARK");
            setTimeout(() => { console.error("DONE"); process.exit(0); }, ${doneAfter});
          }, ${burstAt});
        `,
        ],
        env: {
          ...bunEnv,
          BUN_GC_TIMER_DISABLE: undefined,
          BUN_GC_TIMER_INTERVAL: tick,
          BUN_IDLE_GC_SECONDS: "0",
          BUN_JSC_logGC: "true",
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      // The timer was on its 30 s tick when the burst came: nothing was requested in the time before it.
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
// before the first and between the others. A tick is loud when the program allocated faster than a sixteenth of what it
// allocates when it works (the highest rate a tick has seen, fading over the ladder's length until the ladder has run
// to its end), whether or not its heap grows, or when it came seconds late. So a program with a modest steady
// allocation at its own normal rate is running, not idle, and what these children do to be observed must not allocate.
// The first tick and the one after a rung only look. The second rung and the last are followed by the page-outs further
// down. These measure seconds of idleness: each takes between 3 and 10 s, and they run side by side.
describe.concurrent("idle release", () => {
  // The child stamps its stderr with its own clock from a timer, which is how the parent tells when a collection was
  // logged however late it gets to read the pipe, and does so without allocating (the digits go into a buffer it keeps):
  // a child that allocated a little on every stamp would be a program at its normal rate. It exits when its stdin says so
  // or at `deadlineMs`, after a last stamp: tearing the VM down (BUN_DESTRUCT_VM_ON_EXIT, which the ASAN lanes set)
  // collects once more.
  const child = (deadlineMs: number, body = "") => `
    ${body}
    const { writeSync } = require("fs");
    const line = new Uint8Array(24);
    line[0] = 84;
    const exitStamp = [32, 69, 88, 73, 84];
    const stamp = exiting => {
      let ms = Math.round(performance.now()), digits = 1;
      for (let t = ms; t >= 10; t = Math.floor(t / 10)) digits++;
      for (let i = digits; i >= 1; i--, ms = Math.floor(ms / 10)) line[i] = 48 + (ms % 10);
      let n = digits + 1;
      if (exiting) for (let i = 0; i < 5; i++) line[n++] = exitStamp[i];
      line[n++] = 10;
      writeSync(2, line, 0, n);
    };
    const exit = () => { stamp(true); process.exit(0); };
    setInterval(stamp, 50, false);
    setTimeout(exit, ${deadlineMs});
    process.stdin.once("data", exit);
  `;

  // Runs `script` with the list `seconds` on the default 1 s ticks (or `tick` ms) and returns when (ms into the child's life)
  // BUN_JSC_logGC=1 logged each full collection after the first 300 ms (loading the entry point collects once) and before
  // the child's EXIT stamp. With `exitAfter`, the child is told to exit `lingerMs` after the parent has seen that many
  // rungs: 200 ms leave the rung time to finish, 1.5 s show that no other follows. (When the first rung comes depends on
  // how many ticks starting up is spread over: two on a release build, four on an ASAN one. So no test waits for a time.) minEdenToOldGenerationRatio=0 keeps JSC from making one of the timer's other
  // collections a full one by itself.
  async function fullCollections(
    script: string,
    seconds: string,
    {
      exitAfter = Infinity,
      drive,
      lingerMs = 200,
      tick,
      args = [],
      env,
    }: {
      exitAfter?: number;
      drive?: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => Promise<unknown>;
      lingerMs?: number;
      tick?: string;
      args?: string[];
      env?: Record<string, string>;
    } = {},
  ) {
    // From a file: -e and --print run with a single GC marker thread (numberOfGCMarkers=1), and then the first rung's
    // concurrent collection stays open until a synchronous one, with the second rung's request folded into it.
    using dir = tempDir("idle-release", { "child.js": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, join(String(dir), "child.js")],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: seconds,
        BUN_JSC_logGC: "1",
        BUN_JSC_minEdenToOldGenerationRatio: "0",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: tick,
        ...env,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let log = "";
    let told = false;
    const parse = () => {
      const at: number[] = [];
      const any: number[] = [];
      let stamp = 0;
      for (const [, time, kind] of log.split(" EXIT")[0].matchAll(/^T(\d+)$|=> (Full|Eden)Collection/gm)) {
        if (time) stamp = Number(time);
        else if (stamp >= 300) (kind === "Full" ? at : any).push(stamp);
      }
      // Rungs are a second apart here (on a `tick`, as little as a tick when the one before came late): two collections
      // that close together are one rung's.
      return { at, any, rungs: at.filter((t, i) => i === 0 || t - at[i - 1] > (tick ? 100 : 500)) };
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
          }, lingerMs);
        }
      }
    })();
    const [exitCode] = await Promise.all([proc.exited, reading, drive ? drive(proc) : proc.stdout.text()]);
    const { at, any, rungs } = parse();
    return {
      rungs,
      eden: any,
      exit: { exitCode, signalCode: proc.signalCode, stamped: log.includes(" EXIT") },
      at: JSON.stringify(at),
    };
  }
  const clean = { exitCode: 0, signalCode: null, stamped: true };

  // The first tick only looks; the second one, two seconds in, is loud (starting up is the most the child ever
  // allocates): the rungs count from there. The tick after a rung only looks too, so a rung that is due a second after
  // another runs two seconds after it. The tests with a timeout wait for more seconds of idleness than a test gets by
  // default.
  test("a list of three runs three collections, none on the tick after another", async () => {
    const { rungs, exit, at } = await fullCollections(child(14_000), "2,1,1", { exitAfter: 3 });
    expect(rungs, at).toHaveLength(3);
    expect(rungs[1] - rungs[0], at).toBeGreaterThan(1800);
    expect(rungs[2] - rungs[1], at).toBeGreaterThan(1800);
    expect(rungs[2] - rungs[0], at).toBeLessThan(4700);
    expect(exit).toEqual(clean);
  }, 18_000);

  // 2.5 s: a tick that only looks and one that would run a rung.
  test("a list of two runs two, and no more after them", async () => {
    const { rungs, exit, at } = await fullCollections(child(14_000), "2,2", { exitAfter: 2, lingerMs: 2500 });
    expect(rungs, at).toHaveLength(2);
    expect(exit).toEqual(clean);
  }, 18_000);

  test("a list of one runs one, and no more after it", async () => {
    const { rungs, exit, at } = await fullCollections(child(14_000), "3", { exitAfter: 1, lingerMs: 2500 });
    expect(rungs, at).toHaveLength(1);
    expect(exit).toEqual(clean);
  }, 18_000);

  // An entry that is not a positive decimal number turns the ladder off. (A list of "1" has its collection after 3 s.)
  test.each(["0", "", "1,,1", "1,abc", "1.5", "-1"])("BUN_IDLE_GC_SECONDS=%j turns it off", async seconds => {
    const { rungs, exit, at } = await fullCollections(child(4500), seconds);
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
    const { rungs, exit, at } = await fullCollections(child(4500, churn), "1");
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
  ])(
    "a program that %s still goes idle",
    async (_, body) => {
      const { rungs, exit, at } = await fullCollections(child(9000, body), "1", { exitAfter: 1 });
      expect(rungs, at).toHaveLength(1);
      expect(exit).toEqual(clean);
    },
    12_000, // The first rung comes 4 s in on an ASAN build.
  );

  // What allocation alone cannot tell from a parked program with a timer, the program's own history can: a server that
  // answers five small requests a second allocates 4 KB a second, all the time. That is its normal rate: every tick is
  // loud. Without requests the same program goes down the ladder.
  const server = `
    const server = Bun.serve({ port: 0, fetch: () => new Response("hello") });
    console.log(server.port);
  `;
  async function served(perSecond: number, exitAfter: number) {
    let answered = 0;
    const result = await fullCollections(child(exitAfter === Infinity ? 5000 : 9000, server), "1", {
      exitAfter,
      drive: async proc => {
        const reader = proc.stdout.getReader();
        const first = await reader.read();
        const port = Number(new TextDecoder().decode(first.value));
        expect(port).toBeGreaterThan(0);
        while (perSecond && proc.exitCode === null) {
          // The last one may find the child gone.
          answered += await fetch("http://127.0.0.1:" + port).then(
            r => r.text().then(text => Number(text === "hello")),
            () => 0,
          );
          await Promise.race([Bun.sleep(1000 / perSecond), proc.exited]);
        }
        while (!(await reader.read()).done);
      },
    });
    return { ...result, answered };
  }
  test("a server that answers five small requests a second is running", async () => {
    const { rungs, exit, at, answered } = await served(5, Infinity);
    expect(answered).toBeGreaterThan(10);
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  }, 12_000);
  test("and idle when nobody asks", async () => {
    const { rungs, exit, at } = await served(0, 1);
    expect(rungs, at).toHaveLength(1);
    expect(exit).toEqual(clean);
  }, 12_000);

  // What a program allocates once it has worked, against what it allocated then. On a 20 ms tick, so that the lists
  // (the time over which that fades) can be seconds long: a timer's allocation then arrives in lumps, a tick sees twice
  // the rate or none of it, hence rates far from the sixteenth that decides. Debug and ASAN builds run the workload too
  // slowly for its rates to mean anything.
  const worksThen = (workMs: number, workPieces: number, thenPieces: number) => `
    const started = performance.now();
    setInterval(() => {
      globalThis.sink = new Array(performance.now() - started < ${workMs} ? ${workPieces} : ${thenPieces}).fill(1);
    }, 20);
  `;
  describe.skipIf(isDebug || isASAN)("after a second at 80 MB a second", () => {
    test("0.5 MB a second is idle: down the ladder", async () => {
      const script = child(9000, worksThen(1000, 200 * 1024, 1280));
      const { rungs, exit, at } = await fullCollections(script, "1,1,1", { exitAfter: 3, tick: "20" });
      expect(rungs, at).toHaveLength(3);
      expect(exit).toEqual(clean);
    }, 12_000);

    test("16 MB a second is work", async () => {
      const script = child(5500, worksThen(1000, 200 * 1024, 40 * 1024));
      const { rungs, exit, at } = await fullCollections(script, "1,1,1", { tick: "20" });
      expect(rungs, at).toEqual([]);
      expect(exit).toEqual(clean);
    }, 12_000);

    // What the program went all the way idle against stays the yardstick. Here after half a second at 320 MB a second:
    // a job of 4 MB a second that runs for 2.5 s out of every 5, which is enough for the slow tick the timer is on after
    // the second rung to look at the program (every 8 MB). Were the yardstick to go on fading, that look would find
    // the program loud, and the ladder would run again after every job.
    test("and what was idle stays idle after the last rung", async () => {
      const job = `
        const started = performance.now();
        setInterval(() => {
          const ms = performance.now() - started;
          if (ms < 500) globalThis.sink = new Array(800 * 1024).fill(1);
          else if (ms % 5000 < 2500) globalThis.sink = new Array(10 * 1024).fill(1);
        }, 20);
      `;
      const { rungs, exit, at } = await fullCollections(child(10_000, job), "1,1", { tick: "20" });
      expect(rungs, at).toHaveLength(2);
      expect(exit).toEqual(clean);
    }, 14_000);
  });

  // The timer is on its 30 s tick (a 20 ms tick goes slow after 0.6 s), where the program is looked at every 8 MB: at
  // 2 MB a second after half a second at 160, every four seconds, and each look finds an eightieth of what it allocates
  // when it works. The rung comes when it is due.
  test.skipIf(isDebug || isASAN)(
    "a steady rate well under the line is judged the same on the slow tick",
    async () => {
      const script = child(12_000, worksThen(500, 400 * 1024, 5 * 1024));
      const { rungs, exit, at } = await fullCollections(script, "6", { exitAfter: 1, lingerMs: 2500, tick: "20" });
      expect(rungs, at).toHaveLength(1);
      expect(rungs[0], at).toBeLessThan(8000);
      expect(exit).toEqual(clean);
    },
    15_000,
  );

  // Half a second at 320 MB a second puts the line at 20 MB a second. On the 30 s tick, waiting for the rung that is due
  // after 3 s, the program does it again: the controller looks once 8 MB have been allocated and a second has passed
  // since it last looked, finds 40 MB a second and more, and the ladder starts over. (Looking every 8 MB over at least
  // a second could report 8 MB a second at most: the rung came in the middle of the work.)
  test.skipIf(isDebug || isASAN)(
    "work that comes back on the slow tick is loud however high the line",
    async () => {
      const twice = `
        const started = performance.now();
        setInterval(() => {
          const ms = performance.now() - started;
          if (ms < 500 || (ms > 2000 && ms < 2800)) globalThis.sink = new Array(800 * 1024).fill(1);
        }, 20);
      `;
      const { rungs, exit, at } = await fullCollections(child(5200, twice), "3", { tick: "20" });
      expect(rungs, at).toEqual([]);
      expect(exit).toEqual(clean);
    },
    12_000,
  );

  // The timer is on its 30 s tick and waiting for the rung that is due after 5 s when the program works for a second,
  // 6 MB, which is under what makes it look early: the tick the rung was due on finds a loud window, and the ladder
  // starts over. Due after 5 s without the burst; with it, 5 s after the burst has ended at 3.5 s, which is past the
  // child's 7.2 s.
  test.skipIf(isDebug || isASAN)(
    "a second of work in the middle of a slow tick starts the ladder over",
    async () => {
      const burst = `
      setTimeout(() => {
        let pieces = 0;
        const timer = setInterval(() => {
          if (++pieces > 10) return clearInterval(timer);
          globalThis.sink = new Array(75 * 1024).fill(pieces);
        }, 100);
      }, 2500);
    `;
      const { rungs, exit, at } = await fullCollections(child(7200, burst), "5", { tick: "20" });
      expect(rungs, at).toEqual([]);
      expect(exit).toEqual(clean);
    },
    12_000,
  );

  // The thread sits in a synchronous call for 4 s: the tick after it comes seconds late, which does not make those
  // seconds idle ones. No rung comes with the call's return; the first one is due two seconds later.
  test("time spent in a synchronous call is not idle time", async () => {
    const blocked = `setTimeout(() => Bun.sleepSync(4000), 1200);`;
    const { rungs, exit, at } = await fullCollections(child(6900, blocked), "2,1,1");
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  }, 12_000);

  // Nor when the late tick is the one after a rung, which does not look at what was allocated. The first rung runs 4 s
  // in; from 4.4 s the thread sits in a call for 3 s, and the ladder starts over with the tick that follows. (Taking
  // that tick for an idle one had the second rung run on the next, 8.4 s in. When starting up takes a tick longer the
  // call comes before the first rung, and this is the test above.)
  test.skipIf(isDebug || isASAN)(
    "nor when it is the tick after a rung that comes late",
    async () => {
      const blocked = `setTimeout(() => Bun.sleepSync(3000), 4400);`;
      const { rungs, exit, at } = await fullCollections(child(9000, blocked), "2,1");
      expect(rungs.length, at).toBeLessThanOrEqual(1);
      expect(exit).toEqual(clean);
    },
    14_000,
  );

  // Nor when the call is made from a timer of the program's that fires in the same turn of the event loop as the tick,
  // ahead of it: the clock is read when the tick runs, not when the turn began. (150 ms in a first call make the 3 s one
  // and the tick due together. Read at the start of the turn, the clock said the tick was on time, and the rung of "2"
  // ran a second later, 7 s in; it is due 2 s after the call has returned.)
  test("nor when the call is made in the same turn of the event loop, ahead of the tick", async () => {
    const blocked = `
      setTimeout(() => Bun.sleepSync(150), 2900);
      setTimeout(() => Bun.sleepSync(3000), 2990);
    `;
    const { rungs, exit, at } = await fullCollections(child(7800, blocked), "2");
    expect(rungs, at).toEqual([]);
    expect(exit).toEqual(clean);
  }, 12_000);

  // The process is stopped for 3 s (a laptop lid, a debugger, ^Z), longer than the ladder of "1,1": that is no time the
  // program was idle for, and what it allocates when it works is what it was before. Half a second at 320 MB a second,
  // then 1.6 MB a second: both rungs come after the process goes on. (With the 3 s taken off the yardstick there was
  // none left, and the 1.6 MB a second were the program's normal rate: loud, for good.)
  test.skipIf(isDebug || isASAN || isWindows)(
    "time the process is stopped for does not fade what it allocates when it works",
    async () => {
      const { rungs, exit, at } = await fullCollections(child(8500, worksThen(500, 800 * 1024, 4 * 1024)), "1,1", {
        tick: "20",
        drive: async proc => {
          await Bun.sleep(1200);
          process.kill(proc.pid, "SIGSTOP");
          await Bun.sleep(3000);
          process.kill(proc.pid, "SIGCONT");
          return proc.stdout.text();
        },
      });
      expect(
        rungs.filter(t => t > 4000),
        at,
      ).toHaveLength(2);
      expect(exit).toEqual(clean);
    },
    14_000,
  );

  // With a debugger attached there is no ladder, and nothing is due: the timer goes to its 30 s tick like any other
  // quiet program's (a 20 ms tick after 0.6 s; the debugger's start-up is loud for a second or two), where it used to
  // fire every second for a rung that never ran.
  // (At exit LeakSanitizer reports 376 bytes of the debugger's own start-up, and aborts.)
  test("with --inspect the timer still slows down", async () => {
    const { rungs, eden, exit, at } = await fullCollections(child(6500), "1", {
      tick: "20",
      args: ["--inspect=0"],
      env: { ASAN_OPTIONS: "allow_user_segv_handler=1:detect_leaks=0" },
    });
    expect(rungs, at).toEqual([]);
    expect(eden.filter(t => t > 4000)).toEqual([]);
    expect(exit).toEqual(clean);
  }, 15_000);

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
      expect((await proc.stdout.getReader().read()).done).toBe(false);
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
      // Looks only once the three rungs have had their time (looking allocates 8 KB, and a program that allocates at its
      // normal rate is running), then reports as soon as the code is gone; the deadline only bounds a run in which it
      // stays. Both count from here: warming up takes seconds on an ASAN build.
      const giveUp = performance.now() + 12_000;
      setTimeout(() => {
        const id = setInterval(() => {
          const after = count();
          if (after >= before / 4 && performance.now() < giveUp) return;
          clearInterval(id);
          console.log(JSON.stringify({ before, after }));
        }, 500);
      }, 6300);
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

// Before the last idle collection the controller asks JSC to let go of the code it can get back cheaply
// (VM::shrinkFootprintNow): for a --compile --bytecode executable, the unlinked bytecode of functions that have no linked
// code any more (an earlier rung's collection unlinked it), which is decoded again from the executable when such a
// function is next called.
// Debug and ASAN builds are skipped: the sequence below has a second or so of slack at release speed, and their
// executables are too big to compile a copy of per run.
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
    const deadline = performance.now() + Number(process.env.WAIT_MS);
    // Looks only once the rungs have had their time: looking allocates 8 KB, and a program that allocates at its normal
    // rate is running.
    setTimeout(() => {
      const timer = setInterval(() => {
        const now = count();
        if (now < before - 40 || performance.now() > deadline) {
          clearInterval(timer);
          console.log(JSON.stringify({ before, after: now, same: run() === expected }));
        }
      }, 500);
    }, 5800);
  `;

  let dir: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    dir = tempDir("idle-drop-code", { "app.js": app });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--outfile", "app", "app.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildExit, buildOut + buildErr).toBe(0);
  }, 60_000); // It writes an executable of 100 MB and more.
  afterAll(() => dir?.[Symbol.dispose]());

  async function run(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [join(String(dir), "app" + (isWindows ? ".exe" : ""))],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: undefined,
        // Code ages in milliseconds instead of the seconds it normally takes, so that an idle collection finds the
        // functions' CodeBlocks old as it would a minute into a real idle period.
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

  // The child reports as soon as the count has dropped; WAIT_MS only bounds a run in which it does not. With a timeout:
  // the last rung comes 5 s in, which with the start-up is more than a test gets by default.
  test.concurrent(
    "drops re-decodable unlinked code, and it comes back",
    async () => {
      const { before, after, same, stdout, exitCode } = await run({ BUN_IDLE_GC_SECONDS: "1,1", WAIT_MS: "11000" });
      expect(before, stdout).toBeGreaterThan(60);
      expect(after, stdout).toBeLessThan(before! - 40);
      expect(same, stdout).toBe(true);
      expect(exitCode).toBe(0);
    },
    15_000,
  );

  // The first of two is a collection like any other.
  test.concurrent(
    "not with an earlier idle collection",
    async () => {
      const { before, after, same, stdout, exitCode } = await run({ BUN_IDLE_GC_SECONDS: "1,30", WAIT_MS: "5500" });
      expect(before, stdout).toBeGreaterThan(60);
      expect(after, stdout).toBeGreaterThan(before! - 40);
      expect(same, stdout).toBe(true);
      expect(exitCode).toBe(0);
    },
    12_000,
  );
});

// The last rung also has the kernel reclaim the file-backed pages the program is not using: a standalone executable's
// embedded module graph (which already goes with the second rung of three) and the executable's own code and constants.
// They are read back from the file when touched. MADV_PAGEOUT skips pages another process maps and dirty ones, and tmpfs
// pages are not file-backed, so the tests run one standalone executable, one at a time, from a disk-backed temp dir and
// written back (not a copy each, side by side: on a slow disk a child does not get to run while the next copy is being
// written). Debug and ASAN executables are too big.
const TMPFS_MAGIC = 0x01021994;
const cannotObservePageOut = !isLinux || isDebug || isASAN || statfsSync(tmpdir()).type === TMPFS_MAGIC;
describe.skipIf(cannotObservePageOut)("idle release pages out the executable", () => {
  // The program reads a 3 MB embedded file once it is running (Bun releases the module graph's pages itself after the
  // entry point has loaded), so that the module graph is resident, says so, and then sits there until its stdin says
  // otherwise (DEADLINE_MS is for a test that has gone away). It is the test that looks, at /proc/<pid>/smaps: reading
  // that allocates a few hundred KB, which is a loud tick. WORKER=1 keeps a Worker alive
  // meanwhile (for WORKER_MS if that is set), BIG=1 gives the program a big heap and a steady 2 MB a second.
  const app = `
    import embedded from "./embedded.bin" with { type: "file" };
    if (process.env.WORKER) {
      const worker = (globalThis.worker = new Worker("data:text/javascript,setInterval(() => {}, 1000)"));
      if (process.env.WORKER_MS) setTimeout(() => worker.terminate(), Number(process.env.WORKER_MS));
      // A requested collection finishes at the mutator's next safepoint, and a request that finds one still open is
      // folded into it: enter JS often enough for each rung's collection to be one of its own.
      setInterval(() => {}, 50);
    }
    if (process.env.BIG) {
      // 300 MB live, so that the collector's budget is hundreds of MB, and 2 MB a second on top for good.
      globalThis.live = Array.from({ length: 38 }, (_, i) => new Array(1024 * 1024).fill(i));
      Bun.gc(true);
      setInterval(() => { globalThis.sink = new Array(32 * 1024).fill(0); }, 125);
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
      "plain.js": `
        setTimeout(() => console.log(Math.round(performance.now())), 300);
        setTimeout(() => process.exit(0), Number(process.env.DEADLINE_MS));
        process.stdin.once("data", () => process.exit(0));
      `,
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
  async function run(
    seconds: string,
    watch: "text" | "graph",
    deadlineMs: number,
    env: Record<string, string> = {},
    earliestMs = 2800,
  ) {
    // Before `earliestMs` (2.8 s: no rung at all; 3.8 s: not the one the test is about; never, in the tests that expect
    // everything to stay) the rung cannot have run: a mapping that is gone by then was taken by the kernel, which happens
    // to pages that have just been read when memory is short, and says nothing. Again, then: the kernel does it now and
    // then, a page-out that should not be there does it every time.
    for (let attempt = 1; ; attempt++) {
      const { log, ...result } = await once(seconds, watch, deadlineMs, env);
      if (result[watch] === "gone" && result.at < earliestMs && attempt < 3) continue;
      // A rung has run, which is what makes "still resident" mean something.
      expect(log).toContain("FullCollection");
      return result;
    }
  }
  async function once(seconds: string, watch: "text" | "graph", deadlineMs: number, env: Record<string, string>) {
    const exe = realpathSync(join(String(dir), "app"));
    // BUN_BE_BUN=1 makes the executable the `bun` it was built from: a process without a module graph whose
    // executable nobody else maps (the one running this test is mapped by this test).
    await using proc = Bun.spawn({
      cmd: env.BUN_BE_BUN ? [exe, "plain.js"] : [exe],
      cwd: String(dir),
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
    const ready = await reader.read();
    if (ready.done) throw new Error("the child exited before it had read its embedded file:\n" + (await stderr));
    const readAt = Number(new TextDecoder().decode(ready.value));
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
    if (!env.BUN_BE_BUN) expect(had.graph).toBeGreaterThan(3 * 1024);
    const still = (name: "text" | "graph") => (has[name] * 4 > had[name] ? "resident" : "gone");
    return { text: still("text"), graph: still("graph"), at, log };
  }

  // One at a time and with a timeout: a run takes up to 7 s and may be repeated (see `run`).
  test("the module graph goes with the second rung of three, the executable does not", async () => {
    const { at, ...mappings } = await run("1,1,30", "graph", 7000, {}, 3800);
    expect(mappings).toEqual({ text: "resident", graph: "gone" });
    expect(at).toBeGreaterThan(3800);
  }, 15_000);

  test("an entry too large to read is an hour, not the end of the list", async () => {
    const { at, ...mappings } = await run("1,99999999999", "text", 4200, {}, Infinity);
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
        DEADLINE_MS: "12000",
        WORKER: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    expect((await proc.stdout.getReader().read()).done).toBe(false);
    // The rungs are due 3, 5 and 7 s into the child's life.
    await Bun.sleep(8000);
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
  }, 20_000);

  test("nothing is paged out while a Worker is alive, and it is once the Worker is gone", async () => {
    const { at, ...mappings } = await run("1", "text", 7500, { WORKER: "1", WORKER_MS: "4000" });
    expect(mappings).toEqual({ text: "gone", graph: "gone" });
    expect(at).toBeGreaterThan(4000);
  }, 15_000);

  // Measured against the collector's budget alone (several MB a second with 300 MB live) this program would be parked,
  // and would have a synchronous collection and its code paged out while it works. Against what it allocates when it
  // works it is doing just that, all the time.
  test("a big heap does not make a program that keeps allocating a parked one", async () => {
    const { log, ...mappings } = await once("1,1", "text", 4500, { BIG: "1" });
    expect(mappings).toMatchObject({ text: "resident", graph: "resident" });
    expect(
      log
        .slice(log.indexOf("READY"))
        .split("EXIT")[0]
        .match(/FullCollection/g) ?? [],
    ).toEqual([]);
  }, 20_000);

  test("BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE=1 keeps both resident", async () => {
    const { at, ...mappings } = await run(
      "1",
      "text",
      4200,
      { BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: "1" },
      Infinity,
    );
    expect(mappings).toEqual({ text: "resident", graph: "resident" });
  }, 15_000);

  // The last rung's eviction is for standalone executables: `bun file.js` gets the collection and keeps its code.
  test("a process that is not a standalone executable keeps its code", async () => {
    const { at, ...mappings } = await run("1", "text", 4200, { BUN_BE_BUN: "1" }, Infinity);
    expect(mappings.text).toBe("resident");
  }, 15_000);

  // Last: what these page out is read back from the disk by the next child, and pages that have just been read are the
  // first the kernel takes back when memory is short.
  test("the executable goes with the last rung, not the first", async () => {
    const { at, ...mappings } = await run("1,1", "text", 7000, {}, 3800);
    expect(mappings).toEqual({ text: "gone", graph: "gone" });
    expect(at).toBeGreaterThan(3800);
  }, 15_000);

  test("a list of one is the last rung", async () => {
    const { at, ...mappings } = await run("1", "text", 5000);
    expect(mappings).toEqual({ text: "gone", graph: "gone" });
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

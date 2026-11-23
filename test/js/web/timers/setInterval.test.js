import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

it("setInterval", async () => {
  var counter = 0;
  var start;
  const result = await new Promise((resolve, reject) => {
    start = performance.now();

    var id = setInterval(
      (...args) => {
        counter++;
        if (counter === 10) {
          resolve(counter);
          clearInterval(id);
        }
        try {
          expect(args).toStrictEqual(["foo"]);
        } catch (err) {
          reject(err);
          clearInterval(id);
        }
      },
      1,
      "foo",
    );
  });

  expect(result).toBe(10);
  expect(performance.now() - start > 9).toBe(true);
});

it("clearInterval", async () => {
  var called = false;
  const id = setInterval(() => {
    called = true;
    expect.unreachable();
  }, 1);
  clearInterval(id);
  await new Promise((resolve, reject) => {
    setInterval(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(false);
});

it("async setInterval", async () => {
  var remaining = 5;
  await new Promise((resolve, reject) => {
    queueMicrotask(() => {
      var id = setInterval(async () => {
        await 1;
        remaining--;
        if (remaining === 0) {
          clearInterval(id);
          resolve();
        }
      }, 1);
    });
  });
});

it("refreshed setInterval should not reschedule again", async () => {
  let relative = performance.now();
  let runCount = 0;
  let timer = setInterval(() => {
    let end = performance.now();

    // loop for 100
    const spinloop = end;
    while (performance.now() - spinloop < 100) {
      end = performance.now();
    }

    timer.refresh();

    const elapsed = Math.round(end - relative);
    console.log("Time since last run", elapsed);

    runCount++;

    switch (runCount) {
      case 1: {
        if (elapsed < 180) {
          throw new Error("Expected elapsed time to be greater than 180");
        }
        break;
      }
      case 3:
      case 2: {
        if (elapsed > 180) {
          throw new Error("Expected elapsed time to be less than 180");
        }
        break;
      }
    }

    relative = end;

    if (runCount === 3) {
      clearInterval(timer);
    }
  }, 100);
});

it.concurrent("setInterval runs with at least the delay time", async () => {
  expect(await bunRun([`run`, join(import.meta.dir, "setInterval-fixture.js")])).toSpawn();
});

it.concurrent("setInterval canceling with unref, close, _idleTimeout, and _onTimeout", async () => {
  expect(await bunRun([join(import.meta.dir, "timers-fixture-unref.js"), "setInterval"])).toSpawn();
});

it.concurrent(
  "setInterval doesn't leak memory",
  async () => {
    const { stdout, stderr, exitCode } = await bunRun([`run`, join(import.meta.dir, "setInterval-leak-fixture.js")]);
    if (exitCode !== 0) console.error(stderr || stdout);
    expect(exitCode).toBe(0);
  },
  // A build with AddressSanitizer takes WTF's and JavaScriptCore's memory from the sanitizer's allocator: the fixture takes a fifth longer and stood at 29 to 30 s.
  isWindows ? 90_000 : isASAN ? 60_000 : 30_000,
);
// ✓ setInterval doesn't leak memory [9930.00ms]
// ✓ setInterval doesn't leak memory [80188.00ms]
// TODO: investigate this discrepancy further

it.concurrent(
  "setInterval doesn't run when cancelled after being scheduled",
  async () => {
    expect(await bunRun([`run`, join(import.meta.dir, "setInterval-cancel-fixture.js")])).toSpawn();
  },
  30_000,
);

it.skipIf(!isWindows)("a thread on the same CPU runs between the turns of an interval that overruns", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { dlopen } = require("bun:ffi");
       const { Worker } = require("worker_threads");
       const steps = new Int32Array(new SharedArrayBuffer(4));
       const worker = new Worker(
         \`const { SwitchToThread } = require("bun:ffi").dlopen("kernel32.dll", { SwitchToThread: { returns: "i32" } }).symbols;
          const { parentPort, workerData } = require("worker_threads");
          parentPort.postMessage("running");
          for (;;) Atomics.add(workerData, 0, 1), SwitchToThread();\`,
         { eval: true, workerData: steps },
       );
       await require("events").once(worker, "message");
       const { GetProcessAffinityMask, SetProcessAffinityMask } = dlopen("kernel32.dll", {
         GetProcessAffinityMask: { args: ["i64", "ptr", "ptr"], returns: "i32" },
         SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" },
       }).symbols;
       const os = require("os");
       os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
       const allowed = new BigUint64Array(1);
       GetProcessAffinityMask(-1n, allowed, new BigUint64Array(1));
       console.log("pinned:", SetProcessAffinityMask(-1n, allowed[0] & -allowed[0]));
       let turns = 0, between = 0, seen;
       setInterval(() => {
         between += turns > 1 && Atomics.load(steps, 0) !== seen;
         for (const end = performance.now() + 17; performance.now() < end; );
         seen = Atomics.load(steps, 0);
         if (++turns < 8) return;
         console.log(between > 3 ? "most of the time" : between);
         process.reallyExit(0);
       }, 1);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "pinned: 1\nmost of the time\n", stderr: "", exitCode: 0 });
});

describe.concurrent.skipIf(!isWindows)("between the turns of an interval that overruns", () => {
  async function run(eachTurn, script) {
    using dir = tempDir("overrun-stream", {
      "main.mjs": `
        import crypto from "crypto";
        import fs from "fs";
        const overrun = Promise.withResolvers(), chunks = [];
        let bytes = crypto.randomBytes(2e6), turns = 0, largest = 0, size = 0;
        fs.writeFileSync("in", bytes);
        const step = len => (largest = Math.max(largest, len));
        const keep = chunk => (chunks.push(chunk), step(chunk.length));
        setInterval(() => {
          ${eachTurn}
          // Longer each time, until the slowest disk keeps up.
          Bun.sleepSync(Math.min(4 * 1.2 ** turns, 200));
          if (++turns === 3) overrun.resolve();
        }, 1);
        await overrun.promise;
        ${script}
        process.exit();`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.each([
    ["a file", `for await (const chunk of Bun.file("in").stream()) keep(chunk);`],
    [
      "a part of a file",
      `for await (const chunk of Bun.file("in").slice(1001, 1_500_003).stream()) keep(chunk);
       bytes = bytes.subarray(1001, 1_500_003);`,
    ],
    [
      "a file, with an immediate after each chunk,",
      `for await (const chunk of Bun.file("in").stream()) keep(chunk), await new Promise(setImmediate);`,
    ],
    ["a file through the shell", "await Bun.$`cat in > out`;"],
    [
      "the output of a child into a file",
      `await Bun.write("out", new Response(Bun.spawn([process.execPath, "-e", "fs.writeSync(1, fs.readFileSync('in'))"]).stdout));`,
    ],
  ])("%s moves in large steps", async (_, move) => {
    const watch = `step(-size + (size = fs.statSync("out", { throwIfNoEntry: false })?.size ?? 0));`;
    const report = `console.log(largest >= 512 * 1024 || largest, bytes.equals(chunks.length ? Buffer.concat(chunks) : fs.readFileSync("out")));`;
    expect(await run(watch, move + report)).toEqual({ stdout: "true true\n", stderr: "", exitCode: 0 });
  });

  it("writes to a pipe that has room follow one another", async () => {
    const script = `
      const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30_000)"], { stdin: "pipe" });
      const first = turns;
      for (let i = 0; i < 5; i++) child.stdin.write("x"), await child.stdin.write("y");
      console.log(turns - first < 5 || turns - first);
      child.kill();`;
    expect(await run("", script)).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
  });
});

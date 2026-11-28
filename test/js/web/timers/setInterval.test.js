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

it.skipIf(!isWindows)("an overrunning interval yields the CPU to other threads between iterations", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { dlopen } = require("bun:ffi");
       const { Worker } = require("worker_threads");
       const workerCounter = new Int32Array(new SharedArrayBuffer(4));
       const worker = new Worker(
         \`const { SwitchToThread } = require("bun:ffi").dlopen("kernel32.dll", { SwitchToThread: { returns: "i32" } }).symbols;
          const { parentPort, workerData } = require("worker_threads");
          parentPort.postMessage("running");
          for (;;) { Atomics.add(workerData, 0, 1); SwitchToThread(); }\`,
         { eval: true, workerData: workerCounter },
       );
       await require("events").once(worker, "message");
       const { GetProcessAffinityMask, SetProcessAffinityMask } = dlopen("kernel32.dll", {
         GetProcessAffinityMask: { args: ["i64", "ptr", "ptr"], returns: "i32" },
         SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" },
       }).symbols;
       const os = require("os");
       os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
       const affinityMask = new BigUint64Array(1);
       GetProcessAffinityMask(-1n, affinityMask, new BigUint64Array(1));
       console.log("pinned:", SetProcessAffinityMask(-1n, affinityMask[0] & -affinityMask[0]));
       let iterationCount = 0, yieldCount = 0, lastCounter;
       setInterval(() => {
         yieldCount += iterationCount > 1 && Atomics.load(workerCounter, 0) !== lastCounter;
         for (const deadline = performance.now() + 17; performance.now() < deadline; );
         lastCounter = Atomics.load(workerCounter, 0);
         if (++iterationCount < 8) return;
         console.log(yieldCount > 3 ? "yielded" : yieldCount);
         process.reallyExit(0);
       }, 1);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "pinned: 1\nyielded\n", stderr: "", exitCode: 0 });
});

describe.concurrent.skipIf(!isWindows)("I/O while an interval overruns", () => {
  async function run(intervalBody, script) {
    using dir = tempDir("interval-overrun-io", {
      "main.mjs": `
        import crypto from "crypto";
        import fs from "fs";
        const ready = Promise.withResolvers(), chunks = [];
        let bytes = crypto.randomBytes(2e6), iterationCount = 0, maxStepSize = 0, outputSize = 0;
        fs.writeFileSync("in", bytes);
        const recordStep = len => (maxStepSize = Math.max(maxStepSize, len));
        const collectChunk = chunk => {
          chunks.push(chunk);
          recordStep(chunk.length);
        };
        setInterval(() => {
          ${intervalBody}
          // Blocks longer on each iteration so that a slow disk can keep up.
          Bun.sleepSync(Math.min(4 * 1.2 ** iterationCount, 200));
          if (++iterationCount === 3) ready.resolve();
        }, 1);
        await ready.promise;
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
    ["file stream", `for await (const chunk of Bun.file("in").stream()) collectChunk(chunk);`],
    [
      "sliced file stream",
      `for await (const chunk of Bun.file("in").slice(1001, 1_500_003).stream()) collectChunk(chunk);
       bytes = bytes.subarray(1001, 1_500_003);`,
    ],
    [
      "file stream with setImmediate between chunks",
      `for await (const chunk of Bun.file("in").stream()) { collectChunk(chunk); await new Promise(setImmediate); }`,
    ],
    ["shell cat with redirect", "await Bun.$`cat in > out`;"],
    [
      "subprocess stdout written to a file",
      `await Bun.write("out", new Response(Bun.spawn([process.execPath, "-e", "fs.writeSync(1, fs.readFileSync('in'))"]).stdout));`,
    ],
  ])("transfers at least 512 KiB in one step: %s", async (_, transfer) => {
    const trackOutputSize = `const size = fs.statSync("out", { throwIfNoEntry: false })?.size ?? 0; recordStep(size - outputSize); outputSize = size;`;
    const report = `console.log(maxStepSize >= 512 * 1024 || maxStepSize, bytes.equals(chunks.length ? Buffer.concat(chunks) : fs.readFileSync("out")));`;
    expect(await run(trackOutputSize, transfer + report)).toEqual({ stdout: "true true\n", stderr: "", exitCode: 0 });
  });

  it("writes to a pipe with free space do not take an iteration each", async () => {
    const script = `
      const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30_000)"], { stdin: "pipe" });
      const startIteration = iterationCount;
      for (let i = 0; i < 5; i++) { child.stdin.write("x"); await child.stdin.write("y"); }
      console.log(iterationCount - startIteration < 5 || iterationCount - startIteration);
      child.kill();`;
    expect(await run("", script)).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
  });
});

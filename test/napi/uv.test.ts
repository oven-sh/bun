import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { symbols, test_skipped } from "../../src/jsc/bindings/libuv/generate_uv_posix_stubs_constants";
import source from "./uv-stub-stuff/uv_impl.c";

const symbols_to_test = symbols.filter(s => !test_skipped.includes(s));

// We use libuv on Windows
describe.if(!isWindows)("uv stubs", () => {
  const cwd = process.cwd();
  let tempdir: string = "";
  let outdir: string = "";
  let addonPath: string = "";
  let nativeModule: any;

  beforeAll(async () => {
    const files = {
      "uv_impl.c": await Bun.file(source).text(),
      "package.json": JSON.stringify({
        "name": "fake-plugin",
        "module": "index.ts",
        "type": "module",
        "devDependencies": {
          "@types/bun": "latest",
        },
        "peerDependencies": {
          "typescript": "^5.0.0",
        },
        "scripts": {
          "build:napi": "node-gyp configure && node-gyp build",
        },
        "dependencies": {
          "node-gyp": "10.2.0",
        },
      }),
      "binding.gyp": `{
        "targets": [
          {
            "target_name": "uv_test",
            "sources": [ "uv_impl.c" ],
            "include_dirs": [ ".", "./libuv" ],
            "cflags": ["-fPIC"],
            "ldflags": ["-Wl,--export-dynamic"]
          },
        ]
      }`,
    };

    tempdir = tempDirWithFiles("uv-tests", files);
    outdir = path.join(tempdir, "dist");

    process.chdir(tempdir);

    const libuvDir = path.join(__dirname, "../../src/jsc/bindings/libuv");
    await Bun.$`cp -R ${libuvDir} ${path.join(tempdir, "libuv")}`;
    // --ignore-scripts skips the implicit `node-gyp rebuild` bun install runs for a
    // root binding.gyp package; build:napi below is the single, explicit gyp build.
    await Bun.$`${bunExe()} i --ignore-scripts && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);

    addonPath = path.join(tempdir, "./build/Release/uv_test.node");
    nativeModule = require(addonPath);
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  test("mutex init and destroy", () => {
    expect(() => nativeModule.testMutexInitDestroy()).not.toThrow();
  });

  test("recursive mutex", () => {
    expect(() => nativeModule.testMutexRecursive()).not.toThrow();
  });

  test("mutex trylock", () => {
    expect(() => nativeModule.testMutexTrylock()).not.toThrow();
  });

  test("process IDs", () => {
    const result = nativeModule.testProcessIds();
    expect(result).toHaveProperty("pid");
    expect(result).toHaveProperty("ppid");
    expect(result.pid).toBeGreaterThan(0);
    expect(result.ppid).toBeGreaterThan(0);
    // The process ID should match Node's process.pid
    expect(result.pid).toBe(process.pid);
  });

  test("uv_once", () => {
    expect(nativeModule.testUvOnce()).toBe(1);
    expect(nativeModule.testUvOnce()).toBe(1);
    expect(nativeModule.testUvOnce()).toBe(1);
  });

  test("hrtime", () => {
    const result = nativeModule.testHrtime();

    // Reconstruct the 64-bit values
    const time1 = (BigInt(result.time1High) << 32n) | BigInt(result.time1Low >>> 0);
    const time2 = (BigInt(result.time2High) << 32n) | BigInt(result.time2Low >>> 0);

    // Verify that:
    // 1. time2 is greater than time1 (time passed)
    expect(time2 > time1).toBe(true);

    // 2. The difference should be at least 1ms (we slept for 1ms)
    // hrtime is in nanoseconds, so 1ms = 1,000,000 ns
    const diff = time2 - time1;
    expect(diff >= 1_000_000n).toBe(true);

    // 3. The difference shouldn't be unreasonably large
    // Let's say not more than 100ms (100,000,000 ns)
    expect(diff <= 100_000_000n).toBe(true);
  });

  test("uv_tty_reset_mode", async () => {
    // Returns 0 because nothing put a tty into raw mode, so there is nothing to
    // restore. Runs in a child process because when bun does not export the
    // symbol, the lazily bound call kills the process on Linux (on macOS the
    // require() throws), and that should fail this test, not the test runner.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(require(${JSON.stringify(addonPath)}).testTtyResetMode())`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0\n");
    expect(exitCode).toBe(0);
  });

  test("uv_tty_reset_mode after setRawMode", async () => {
    // The child runs in a pty so that setRawMode() takes the termios snapshot
    // uv_tty_reset_mode() restores. Restoring it succeeds (0); two threads
    // restoring it at once see UV_EBUSY (thousands of times per run on a
    // multi-core machine, possibly never on a single core, so only the absence
    // of any other code is asserted); once the fd the snapshot was taken on is
    // closed, the failure comes back libuv-style, as -errno.
    // The child reports through a file because all of its stdio is the pty.
    const resultPath = path.join(tempdir, "tty-reset-result.json");
    const decoder = new TextDecoder();
    let output = "";
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const fs = require("node:fs");
          const addon = require(${JSON.stringify(addonPath)});
          const isTTY = process.stdin.isTTY;
          process.stdin.setRawMode(true);
          const afterRaw = addon.testTtyResetMode();
          const concurrent = addon.testTtyResetModeConcurrent();
          fs.closeSync(0);
          const afterClose = addon.testTtyResetMode();
          fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ isTTY, afterRaw, concurrent, afterClose }));
        `,
      ],
      env: bunEnv,
      terminal: {
        data(_terminal, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
        },
      },
    });
    const exitCode = await proc.exited;
    proc.terminal?.close();
    if (!existsSync(resultPath)) {
      throw new Error(
        `child exited with ${exitCode} without writing a result; terminal output: ${JSON.stringify(output)}`,
      );
    }
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toEqual({
      isTTY: true,
      afterRaw: 0,
      concurrent: { busy: expect.any(Number), unexpected: 0 },
      afterClose: -constants.errno.EBADF,
    });
    expect(exitCode).toBe(0);
  });

  // The loop-backed functions (uv_default_loop, the async, idle, prepare, check
  // and timer handles, uv_queue_work) and the header-only ones around them run
  // in a child process: the child's exit is part of what is tested (a ref'd
  // handle or a queued request must keep it alive, an unref'd handle must
  // not), and on a bun where these are still stubs the first call aborts the
  // process. `script` sees `addon` and `report`, which prints one line per
  // event the addon reports.
  async function runInChild(script: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const addon = require(${JSON.stringify(addonPath)});
          const report = (event, a, b) => console.log(event, a, b);
          ${script}
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("uv_version and uv_version_string", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      console.log(JSON.stringify({ ...addon.testVersion(), reported: process.versions.uv }));
    `);
    expect(stderr).toBe("");
    const { version, versionString, reported } = JSON.parse(stdout);
    expect(versionString).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = versionString.split(".").map(Number);
    expect(version).toBe((major << 16) | (minor << 8) | patch);
    // process.versions.uv is read from the same place.
    expect(reported).toBe(versionString);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_handle_size, uv_req_size and the type names", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testSizesAndNames()));`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      asyncSizeMatches: true,
      timerSizeMatches: true,
      unknownHandleSizeIsMinusOne: true,
      workSizeMatches: true,
      unknownReqSizeIsMinusOne: true,
      // sizeof(uv_async_t) on 64-bit unix; bun's private fields must fit in it.
      asyncSize: 128,
      asyncName: "async",
      pipeName: "pipe",
      workName: "work",
      unknownHandleNameIsNull: true,
      unknownReqNameIsNull: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_get_osfhandle and uv_open_osfhandle", async () => {
    const { stdout, stderr, exitCode } = await runInChild(
      `console.log(addon.testOsfhandle(2), addon.testOsfhandle(41));`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("2 41\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_default_loop is the main thread's napi_get_uv_event_loop", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testLoops()));`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      napiLoopIsSet: true,
      napiLoopIsDefaultLoop: true,
      defaultLoopIsSameFromThread: true,
      loopDataRoundTrips: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("UV_EINVAL for a missing loop or callback and for a handle of another type", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testErrors()));`);
    expect(stderr).toBe("");
    const EINVAL = -constants.errno.EINVAL;
    expect(JSON.parse(stdout)).toEqual([
      EINVAL, // uv_async_init without a loop
      EINVAL, // uv_check_init without a loop
      EINVAL, // uv_timer_init without a loop
      EINVAL, // uv_queue_work without a work_cb
      EINVAL, // uv_cancel of a request that is not a work request
      EINVAL, // uv_idle_start without a callback
      EINVAL, // uv_timer_start without a callback
      EINVAL, // uv_timer_again of a timer that was never started
      EINVAL, // uv_prepare_start of an idle handle
      EINVAL, // uv_prepare_stop of an idle handle
      EINVAL, // uv_idle_start of a timer
      EINVAL, // uv_timer_start of an idle handle
      EINVAL, // uv_timer_stop of an idle handle
      EINVAL, // uv_timer_again of an idle handle
    ]);
    expect(exitCode).toBe(0);
  });

  // Three sends before the loop turns produce one callback; a send from inside
  // the callback produces another; uv_close stops the handle at once and runs
  // close_cb on a later turn. The script returns right after the call, so the
  // ref'd handle is what keeps the process alive until the events happen.
  const asyncEvents = ["async 1 1", "async 2 1", "closing 1 0", "close 1 1", ""].join("\n");

  test.concurrent.each([
    ["napi_get_uv_event_loop", "false"],
    ["uv_default_loop", "true"],
  ])("uv_async_t on the loop from %s, sent from the JS thread", async (_, useDefaultLoop) => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const observed = addon.testAsync(${useDefaultLoop}, false, report);
      console.log("after init", JSON.stringify(observed));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("after init [1,0,1]\n" + asyncEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_async_t sent from another thread after the script has returned", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`addon.testAsync(false, true, report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe(asyncEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_async_t in a Worker uses the Worker's own loop", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(
        \`
          const { parentPort } = require("node:worker_threads");
          const addon = require(${JSON.stringify(addonPath)});
          parentPort.postMessage(JSON.stringify(addon.testLoops()));
          addon.testAsync(false, true, (event, a, b) => parentPort.postMessage([event, a, b].join(" ")));
        \`,
        { eval: true },
      );
      worker.on("message", message => console.log(message));
      worker.on("exit", code => console.log("worker exited", code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      JSON.stringify({
        napiLoopIsSet: true,
        napiLoopIsDefaultLoop: false,
        defaultLoopIsSameFromThread: true,
        loopDataRoundTrips: true,
      }) +
        "\n" +
        asyncEvents +
        "worker exited 0\n",
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("200 rounds of send and callback with a thread, then a burst of sends racing uv_close", async () => {
    // A lost wakeup makes the sender thread wait forever, so the child hangs
    // and this times out. STRESS_ROUNDS + 1 callbacks: see uv_impl.c.
    const { stdout, stderr, exitCode } = await runInChild(`addon.testAsyncStress(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe("done 201 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_close with a send pending: close_cb only; a later close or send does nothing", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      console.log("after close", JSON.stringify(addon.testAsyncCloseWithSendPending(report)));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("after close [0,1,0]\nclose 1 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_ref and uv_unref toggle uv_has_ref; an unref'd handle lets the process exit", async () => {
    // The handle is left open and unref'd: the child hanging here is the failure.
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testAsyncRef()));`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([1, 0, 0, 1, 1, 0]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("an exception thrown by JS called from async_cb is uncaught", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testAsync(false, false, () => { throw new Error("thrown from inside async_cb"); });
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("thrown from inside async_cb");
    expect(exitCode).toBe(1);
  });

  test.concurrent("uv_queue_work runs work_cb on the pool and after_work_cb on the loop thread", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`addon.testQueueWork(report);`);
    expect(stderr).toBe("");
    // 127: every property work_test_after_work_cb in uv_impl.c checks held.
    expect(stdout).toBe("after 0 127\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_cancel", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log("cancel", addon.testCancelWork(report));`);
    expect(stderr).toBe("");
    // Whether uv_cancel wins the race against the pool picking the request up
    // is not deterministic, but both outcomes have exactly one shape. 124 is
    // 127 without the two work_cb bits.
    const cancelled = `cancel 0\nafter ${-constants.errno.ECANCELED} 124\n`;
    const tooLate = `cancel ${-constants.errno.EBUSY}\nafter 0 127\n`;
    expect([cancelled, tooLate]).toContain(stdout);
    expect(exitCode).toBe(0);
  });

  // The handle tests below print the state the addon returns as one JSON line,
  // then one line per event.
  function stateAndEvents(stdout: string) {
    const [state, ...events] = stdout.split("\n");
    return { state: JSON.parse(state), events: events.join("\n") };
  }

  const loopWatcherEvents = [
    "idle 1 1",
    "prepare 1 1",
    "check 1 1",
    "idle 2 1",
    "prepare 2 1",
    "check 2 1",
    "closing 1 0",
    "close idle 1 0",
    "close prepare 1 0",
    "close check 1 0",
    "",
  ].join("\n");

  test.concurrent("idle, prepare and check handles run once per loop iteration, in that order", async () => {
    // Nothing but the idle handle keeps the loop turning: if it let the poll
    // block, the child would hang here. See test_loop_watchers in uv_impl.c.
    const { stdout, stderr, exitCode } = await runInChild(`addon.testLoopWatchers(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe(loopWatcherEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("the watchers of a Worker run on the Worker's loop", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(
        \`
          const { parentPort } = require("node:worker_threads");
          require(${JSON.stringify(addonPath)}).testLoopWatchers((event, a, b) => parentPort.postMessage([event, a, b].join(" ")));
        \`,
        { eval: true },
      );
      worker.on("message", message => console.log(message));
      worker.on("exit", code => console.log("worker exited", code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(loopWatcherEvents + "worker exited 0\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("prepare runs before the poll and check after it", async () => {
    // The server's data callback runs inside the poll. The addon closes both
    // handles from the check callback of the iteration it was called in. How
    // many iterations the connection takes to get there varies.
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testPrepareAndCheckAroundIo(report);
      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket) {
            console.log("io");
            addon.requestClose();
            socket.end();
            server.stop(true);
          },
        },
      });
      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write("x");
          },
          data() {},
        },
      });
    `);
    expect(stderr).toBe("");
    const lines = stdout.split("\n");
    const io = lines.indexOf("io");
    expect(io).toBeGreaterThan(0);
    const iteration = (io + 1) / 2;
    const expected: string[] = [];
    for (let i = 1; i < iteration; i++) {
      expected.push(`prepare ${i} 1`, `check ${i} 1`);
    }
    expected.push(
      `prepare ${iteration} 1`,
      "io",
      `check ${iteration} 1`,
      "closing 1 0",
      "close prepare 1 0",
      "close check 1 0",
      "",
    );
    expect(lines).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("the start and stop state machine of a watcher", async () => {
    // The handles are closed before the script returns; the child exiting is
    // part of the test, since the started idle handle would otherwise spin.
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testWatcherStates()));`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      init: 0,
      activeAfterInit: 0,
      refAfterInit: 1,
      typeIsIdle: 1,
      typeIsCheck: 1,
      loopIsSet: 1,
      start: 0,
      activeAfterStart: 1,
      startAgain: 0,
      stop: 0,
      activeAfterStop: 0,
      stopAgain: 0,
      restart: 0,
      activeAfterRestart: 1,
      refAfterUnref: 0,
      activeAfterUnref: 1,
      refAfterRef: 1,
      checkStart: 0,
      activeAfterClose: 0,
      closingAfterClose: 1,
      // The ref flag is independent of closing, as in libuv.
      refAfterClose: 1,
      // Starting a closing handle is a no-op that reports success, as in libuv.
      startAfterClose: 0,
      activeAfterStartAfterClose: 0,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an exception thrown by JS called from a watcher callback is uncaught", async () => {
    // Every one of the six callbacks throws; the loop must go on to the check
    // callback that closes the handles, so that the child exits.
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testLoopWatchers(() => { throw new Error("thrown from inside a watcher callback"); });
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("thrown from inside a watcher callback");
    expect(exitCode).toBe(1);
  });

  const oneShotTimerEvents = "timer 0 0\nclose timer 1 0\n";
  // See timer_repeat_cb in uv_impl.c: the third callback stops and closes it.
  const repeatingTimerEvents = "repeat 1 1\nrepeat 2 1\nrepeat 3 1\nstopped 0 1\nclose timer 1 0\n";
  const HOUR = 60 * 60 * 1000;

  test.concurrent("a one-shot uv_timer_t keeps the process alive and fires once", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testTimer(report)));`);
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ typeIsTimer: 1, isActive: 1, hasRef: 1, dueIn: expect.any(Number), repeat: 0 });
    expect(state.dueIn).toBeGreaterThanOrEqual(0);
    expect(state.dueIn).toBeLessThanOrEqual(10);
    expect(events).toBe(oneShotTimerEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_timer_t started from inside a JS timer callback, next to a JS timer", async () => {
    // The timer heap is being drained while the addon arms its timers, as
    // when an addon's constructor runs from a setTimeout callback. The three
    // timers fire in an order that depends on the scheduler, so the events
    // are compared as a set.
    const { stdout, stderr, exitCode } = await runInChild(`
      setTimeout(() => {
        console.log(JSON.stringify(addon.testTimer(report)));
        addon.testTimerRepeat(report);
        setTimeout(() => console.log("js timer"), 10);
      }, 1);
    `);
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ typeIsTimer: 1, isActive: 1, hasRef: 1, dueIn: expect.any(Number), repeat: 0 });
    const lines = (s: string) => s.trimEnd().split("\n");
    expect(lines(events).sort()).toEqual(
      [...lines(oneShotTimerEvents), ...lines(repeatingTimerEvents), "js timer"].sort(),
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("a uv_timer_t in a Worker fires on the Worker's loop", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(
        \`
          const { parentPort } = require("node:worker_threads");
          const state = require(${JSON.stringify(addonPath)}).testTimer((event, a, b) => parentPort.postMessage([event, a, b].join(" ")));
          parentPort.postMessage("started " + state.isActive);
        \`,
        { eval: true },
      );
      worker.on("message", message => console.log(message));
      worker.on("exit", code => console.log("worker exited", code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("started 1\n" + oneShotTimerEvents + "worker exited 0\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a repeating uv_timer_t fires until it is stopped", async () => {
    const { stdout, stderr, exitCode } = await runInChild(
      `console.log(JSON.stringify(addon.testTimerRepeat(report)));`,
    );
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ typeIsTimer: 1, isActive: 1, hasRef: 1, dueIn: expect.any(Number), repeat: 1 });
    expect(state.dueIn).toBeLessThanOrEqual(1);
    expect(events).toBe(repeatingTimerEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_timer_set_repeat and uv_timer_again restart a timer with its repeat", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testTimerAgain(report)));`);
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ dueInBefore: expect.any(Number), again: 0, dueInAfter: expect.any(Number), repeat: 1 });
    expect(state.dueInBefore).toBeGreaterThan(HOUR / 2);
    expect(state.dueInBefore).toBeLessThanOrEqual(HOUR);
    expect(state.dueInAfter).toBeLessThanOrEqual(1);
    expect(events).toBe(repeatingTimerEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_timer_start on a started timer reschedules it", async () => {
    const { stdout, stderr, exitCode } = await runInChild(
      `console.log(JSON.stringify(addon.testTimerRestart(report)));`,
    );
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ typeIsTimer: 1, isActive: 1, hasRef: 1, dueIn: expect.any(Number), repeat: 0 });
    expect(state.dueIn).toBeLessThanOrEqual(10);
    expect(events).toBe(oneShotTimerEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_close on a started timer: close_cb only, and the process exits", async () => {
    const { stdout, stderr, exitCode } = await runInChild(
      `console.log(JSON.stringify(addon.testTimerClosedBeforeItFires(report)));`,
    );
    expect(stderr).toBe("");
    expect(stateAndEvents(stdout)).toEqual({
      state: { typeIsTimer: 1, isActive: 0, hasRef: 1, dueIn: 0, repeat: 0 },
      events: "close timer 1 0\n",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an unref'd timer lets the process exit", async () => {
    // The timer is left started; the child hanging for an hour is the failure.
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testTimerUnref(report)));`);
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ typeIsTimer: 1, isActive: 1, hasRef: 0, dueIn: expect.any(Number), repeat: 0 });
    expect(state.dueIn).toBeGreaterThan(HOUR / 2);
    expect(events).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("an exception thrown by JS called from timer_cb is uncaught", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testTimer(() => { throw new Error("thrown from inside timer_cb"); });
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("thrown from inside timer_cb");
    expect(exitCode).toBe(1);
  });

  test.concurrent("uv_now advances", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testNow()));`);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result).toEqual({ nowIsPositive: 1, advancedMs: expect.any(Number) });
    // The addon spins for 5ms between the two readings.
    expect(result.advancedMs).toBeGreaterThanOrEqual(4);
    expect(exitCode).toBe(0);
  });
});

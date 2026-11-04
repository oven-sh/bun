import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, nodeExeMatchingAbi, tempDirWithFiles } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { symbols, test_skipped } from "../../src/jsc/bindings/libuv/generate_uv_posix_stubs_constants";
import finalizerSource from "./uv-stub-stuff/uv_close_in_finalizer.c";
import source from "./uv-stub-stuff/uv_impl.c";

const symbols_to_test = symbols.filter(s => !test_skipped.includes(s));

// We use libuv on Windows
describe.if(!isWindows)("uv stubs", () => {
  const cwd = process.cwd();
  let tempdir: string = "";
  let outdir: string = "";
  let addonPath: string = "";
  let finalizerAddonPath: string = "";
  let nativeModule: any;

  beforeAll(async () => {
    const files = {
      "uv_impl.c": await Bun.file(source).text(),
      "uv_close_in_finalizer.c": await Bun.file(finalizerSource).text(),
      // Two async macros (see runNestedInMacro). wait() returns after three immediates, each of which is one loop
      // iteration of the nested run that waits for it. waitFor() returns when the script settles its promise.
      "nested-wait.ts": `
        export async function wait() {
          for (let turn = 0; turn < 3; turn++) {
            await new Promise(resolve => setImmediate(resolve));
            globalThis.nestedTurns++;
          }
          return 0;
        }
        export async function waitFor() {
          await globalThis.nestedWait.promise;
          return 0;
        }
      `,
      // For the --hot test: the marker check handle is started, the target is closed, and the script throws.
      "close-then-throw.js": `
        const t = require("./build/Release/uv_test.node").closeOrder;
        t.open(undefined, true, false);
        t.close();
        throw new Error("thrown after uv_close");
      `,
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
          {
            "target_name": "uv_close_in_finalizer",
            "sources": [ "uv_close_in_finalizer.c" ],
            "include_dirs": [ ".", "./libuv" ],
            "defines": [ "NAPI_EXPERIMENTAL" ],
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
    finalizerAddonPath = path.join(tempdir, "./build/Release/uv_close_in_finalizer.node");
    nativeModule = require(addonPath);
    // The close-order tests run the addon on Node too. Find that Node (or download it) here, under the timeout of
    // this hook, which also covers an install and a build that take longer than the default 5 s.
    await nodeExeMatchingAbi();
  }, 300_000);

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

  test("uv_cwd returns the cwd and rejects a missing or too-small buffer", () => {
    const result = nativeModule.testCwd();
    const cwdBytes = Buffer.byteLength(process.cwd());
    expect(result.rc).toBe(0);
    expect(result.cwd).toBe(process.cwd());
    expect(result.size).toBe(cwdBytes);

    expect(result.nullBuffer).toBe(result.UV_EINVAL);
    expect(result.nullSize).toBe(result.UV_EINVAL);
    expect(result.zeroSize).toBe(result.UV_EINVAL);

    expect(result.smallRc).toBe(result.UV_ENOBUFS);
    expect(result.smallRequired).toBe(cwdBytes + 1);
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

  // The loop-backed functions (uv_default_loop, uv_queue_work, and the async,
  // idle, prepare, check, timer and poll handles) and their header-only helpers run in
  // a child process. The child's exit is part of the test: a ref'd handle or a
  // queued request must keep it alive, and an unref'd handle must not. `script`
  // can use `addon` and `report`, which prints one line per event from the addon.
  // `cmd` is the executable and its options: real Node runs the same addon.
  async function runInChild(script: string, cmd: string[] = [bunExe()], env: typeof bunEnv = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [
        ...cmd,
        "-e",
        `
          const addon = require(${JSON.stringify(addonPath)});
          const report = (event, a, b) => console.log(event, a, b);
          ${script}
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("uv_version and uv_version_string agree", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      console.log(JSON.stringify(addon.testVersion()));
    `);
    expect(stderr).toBe("");
    const { version, versionString } = JSON.parse(stdout);
    expect(versionString).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = versionString.split(".").map(Number);
    expect(version).toBe((major << 16) | (minor << 8) | patch);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_handle_size, uv_req_size and the type names match the headers", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testSizesAndNames()));`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      asyncSizeMatches: true,
      timerSizeMatches: true,
      unknownHandleSizeIsMinusOne: true,
      workSizeMatches: true,
      unknownReqSizeIsMinusOne: true,
      // sizeof(uv_async_t) on 64-bit Unix. Bun's private fields must fit in it.
      asyncSize: 128,
      asyncName: "async",
      pipeName: "pipe",
      workName: "work",
      unknownHandleNameIsNull: true,
      unknownReqNameIsNull: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_strerror, uv_err_name and their _r forms return libuv's text", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testStrerror()));`);
    expect(stderr).toBe("");
    // The addon passes UV_EBADF and -123456, which libuv doesn't define.
    const unknown = "Unknown system error -123456";
    expect(JSON.parse(stdout)).toEqual({
      strerror: "bad file descriptor",
      strerrorR: "bad file descriptor",
      // A 4-byte buffer.
      strerrorRSmallBuffer: "bad",
      errName: "EBADF",
      errNameR: "EBADF",
      errNameRSmallBuffer: "EBA",
      unknownStrerror: unknown,
      unknownStrerrorR: unknown,
      unknownErrName: unknown,
      unknownErrNameR: unknown,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_get_osfhandle and uv_open_osfhandle return the fd unchanged", async () => {
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

  test.concurrent("returns UV_EINVAL for a missing loop, a missing callback or the wrong handle type", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testErrors()));`);
    expect(stderr).toBe("");
    const EINVAL = -constants.errno.EINVAL;
    expect(JSON.parse(stdout)).toEqual([
      EINVAL, // uv_async_init without a loop
      EINVAL, // uv_check_init without a loop
      EINVAL, // uv_timer_init without a loop
      EINVAL, // uv_queue_work without a work_cb
      EINVAL, // uv_cancel on a request that isn't a work request
      EINVAL, // uv_idle_start without a callback
      EINVAL, // uv_timer_start without a callback
      EINVAL, // uv_timer_again on a timer that was never started
      EINVAL, // uv_prepare_start on an idle handle
      EINVAL, // uv_prepare_stop on an idle handle
      EINVAL, // uv_idle_start on a timer
      EINVAL, // uv_timer_start on an idle handle
      EINVAL, // uv_timer_stop on an idle handle
      EINVAL, // uv_timer_again on an idle handle
    ]);
    expect(exitCode).toBe(0);
  });

  // Three sends before the loop iterates coalesce into one callback, and a send
  // from inside the callback triggers another. uv_close stops the handle
  // immediately and runs close_cb on a later iteration. The script returns right
  // after the call, so only the ref'd handle keeps the process alive.
  const asyncEvents = ["async 1 1", "async 2 1", "closing 1 0", "close 1 1", ""].join("\n");

  test.concurrent.each([
    ["napi_get_uv_event_loop", "false"],
    ["uv_default_loop", "true"],
  ])("uv_async_t on the loop from %s fires when sent from the JS thread", async (_, useDefaultLoop) => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const observed = addon.testAsync(${useDefaultLoop}, false, report);
      console.log("after init", JSON.stringify(observed));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("after init [1,0,1]\n" + asyncEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_async_t fires when sent from another thread after the script has returned", async () => {
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

  test.concurrent("uv_async_send from another thread never loses a wakeup, and a burst can race uv_close", async () => {
    // A lost wakeup makes the sender thread wait forever, so the child hangs
    // and this times out. 201 is STRESS_ROUNDS + 1 in uv_impl.c.
    const { stdout, stderr, exitCode } = await runInChild(`addon.testAsyncStress(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe("done 201 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a thread that calls uv_async_send in a tight loop doesn't starve JS timers", async () => {
    // The child hangs if the timer never fires, and this times out.
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.startAsyncFlood();
      setTimeout(() => {
        addon.stopAsyncFlood();
        console.log("timer fired");
      }, 1);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("timer fired\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_close with a send pending only runs close_cb, and a later close or send is a no-op", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      console.log("after close", JSON.stringify(addon.testAsyncCloseWithSendPending(report)));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("after close [0,1,0]\nclose 1 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_ref and uv_unref toggle uv_has_ref, and an unref'd handle lets the process exit", async () => {
    // The handle is still open but unref'd, so the test fails if the child hangs.
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testAsyncRef()));`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([1, 0, 0, 1, 1, 0]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("an exception thrown by JS called from async_cb is reported as uncaught", async () => {
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
    // 127 means every check in work_test_after_work_cb (uv_impl.c) passed.
    expect(stdout).toBe("after 0 127\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_cancel either cancels queued work or returns UV_EBUSY", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log("cancel", addon.testCancelWork(report));`);
    expect(stderr).toBe("");
    // uv_cancel races with the pool picking up the request, so either outcome
    // is valid. 124 is 127 without the two work_cb bits.
    const cancelled = `cancel 0\nafter ${-constants.errno.ECANCELED} 124\n`;
    const tooLate = `cancel ${-constants.errno.EBUSY}\nafter 0 127\n`;
    expect([cancelled, tooLate]).toContain(stdout);
    expect(exitCode).toBe(0);
  });

  // The handle tests below print the addon's returned state as one JSON line,
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
    // libuv runs the close callback of the handle that was closed last first.
    "close check 1 0",
    "close prepare 1 0",
    "close idle 1 0",
    "",
  ].join("\n");

  test.concurrent("idle, prepare and check handles run once per loop iteration, in that order", async () => {
    // Only the idle handle keeps the loop iterating. If it let the poll block,
    // the child would hang here. See test_loop_watchers in uv_impl.c.
    const { stdout, stderr, exitCode } = await runInChild(`addon.testLoopWatchers(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe(loopWatcherEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a Worker's watchers run on the Worker's loop", async () => {
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

  test.concurrent("prepare runs before the poll and check runs after it", async () => {
    // The server's data callback runs inside the poll, and the addon closes both
    // handles from that iteration's check callback. The number of iterations
    // before the data arrives varies.
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
      "close check 1 0",
      "close prepare 1 0",
      "",
    );
    expect(lines).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a watcher's start/stop state machine matches libuv", async () => {
    // The addon closes the handles before the script returns. The child must
    // exit, because a started idle handle would otherwise spin forever.
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

  test.concurrent("an exception thrown by JS called from a watcher callback is reported as uncaught", async () => {
    // All six callbacks throw. The loop must still reach the check callback that
    // closes the handles, or the child never exits.
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testLoopWatchers(() => { throw new Error("thrown from inside a watcher callback"); });
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("thrown from inside a watcher callback");
    expect(exitCode).toBe(1);
  });

  const oneShotTimerEvents = "timer 0 0\nclose timer 1 0\n";
  // The third callback stops and closes the timer (timer_repeat_cb in uv_impl.c).
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

  test.concurrent("uv_timer_t fires when started from inside a JS timer callback, alongside a JS timer", async () => {
    // The addon arms its timers while the timer heap is being drained, like an
    // addon constructor called from a setTimeout callback. The order in which
    // the three timers fire depends on the scheduler, so compare sorted events.
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

  test.concurrent("uv_close on a started timer only runs close_cb, and the process exits", async () => {
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
    // The timer is never stopped. If unref didn't work, the child would hang for an hour.
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testTimerUnref(report)));`);
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    expect(state).toEqual({ typeIsTimer: 1, isActive: 1, hasRef: 0, dueIn: expect.any(Number), repeat: 0 });
    expect(state.dueIn).toBeGreaterThan(HOUR / 2);
    expect(events).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("an exception thrown by JS called from timer_cb is reported as uncaught", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testTimer(() => { throw new Error("thrown from inside timer_cb"); });
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("thrown from inside timer_cb");
    expect(exitCode).toBe(1);
  });

  // enum uv_poll_event
  const UV_READABLE = 1;
  const UV_WRITABLE = 2;

  test.concurrent("uv_poll_t is level-triggered, and a start on a started handle replaces its events", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testPoll(report)));`);
    expect(stderr).toBe("");
    const { state, events } = stateAndEvents(stdout);
    // [the fd is non-blocking after uv_poll_init, uv_poll_start, uv_is_active, uv_has_ref]
    expect(state).toEqual([1, 0, 1, 1]);
    expect(events).toBe(
      [
        `poll 0 ${UV_READABLE}`,
        // The first callback left the byte unread.
        `poll 0 ${UV_READABLE}`,
        `read 1 ${"x".charCodeAt(0)}`,
        "both 0 1",
        // The addon wrote a second byte after the start for both directions.
        `seen 0 ${UV_READABLE | UV_WRITABLE}`,
        `read 1 ${"z".charCodeAt(0)}`,
        "stopped 0 0",
        "close poll 1 0",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  // poll_once_cb in uv_impl.c
  const pollOnceEvents = `poll 0 ${UV_READABLE}\nread 1 ${"y".charCodeAt(0)}\nclose poll 1 0\n`;

  test.concurrent("a started uv_poll_t keeps the process alive until its fd is ready", async () => {
    // Another thread writes to the socket after the script has returned.
    const { stdout, stderr, exitCode } = await runInChild(`addon.testPollFromThread(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe(pollOnceEvents);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a uv_poll_t in a Worker fires on the Worker's loop", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(
        \`
          const { parentPort } = require("node:worker_threads");
          require(${JSON.stringify(addonPath)}).testPollFromThread((event, a, b) => parentPort.postMessage([event, a, b].join(" ")));
        \`,
        { eval: true },
      );
      worker.on("message", message => console.log(message));
      worker.on("exit", code => console.log("worker exited", code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(pollOnceEvents + "worker exited 0\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_poll_t reports readable when the peer closes its end", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`addon.testPollHangup(report);`);
    expect(stderr).toBe("");
    // The read returns 0.
    expect(stdout).toBe(`poll 0 ${UV_READABLE}\nread 0 0\nclose poll 1 0\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_poll_t reports readable when the write end of its empty pipe closes", async () => {
    // Linux reports only EPOLLHUP for this fd, not EPOLLIN.
    const { stdout, stderr, exitCode } = await runInChild(`addon.testPollPipeHangup(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe(`poll 0 ${UV_READABLE}\nread 0 0\nclose poll 1 0\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a second uv_poll_start on a started uv_poll_t replaces its callback", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`addon.testPollReplaceCallback(report);`);
    expect(stderr).toBe("");
    // The replaced callback would report "replaced".
    expect(stdout).toBe(`poll 0 ${UV_READABLE}\nread 1 ${"x".charCodeAt(0)}\nclose poll 1 0\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a uv_poll_t that another poll_cb restarts gets no event from the same batch", async () => {
    // The immediate runs after the batch in which both fds were ready, and before the next poll.
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testPollRestartInBatch((event, a, b) => {
        report(event, a, b);
        if (event === "restarted") setImmediate(() => console.log("immediate"));
      });
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        `first 0 ${UV_READABLE}`,
        "restarted 0 0",
        "immediate",
        `second 0 ${UV_READABLE}`,
        "close poll 1 0",
        "close poll 1 0",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("the microtasks of a poll_cb run before the next poll_cb of the same batch", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      let polls = 0;
      addon.testPollPair((event, a, b) => {
        report(event, a, b);
        if (event !== "poll") return;
        const poll = ++polls;
        queueMicrotask(() => console.log("microtask of poll", poll));
      });
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        `poll 0 ${UV_READABLE}`,
        "microtask of poll 1",
        `poll 0 ${UV_READABLE}`,
        "microtask of poll 2",
        "close poll 1 0",
        "close poll 1 0",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  // kqueue reports a closed pipe as writable with EV_EOF, not as an error.
  test.concurrent.skipIf(!isLinux)("uv_poll_t stops and reports UV_EBADF when the fd has an error", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`addon.testPollError(report);`);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [`poll 0 ${UV_WRITABLE}`, `poll ${-constants.errno.EBADF} 0`, "active 0 0", "close poll 1 0", ""].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("an unref'd uv_poll_t lets the process exit", async () => {
    // The handle stays started, so the test fails if the child hangs.
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testPollUnref()));`);
    expect(stderr).toBe("");
    // [uv_poll_start, uv_has_ref, uv_has_ref after uv_unref, uv_is_active]
    expect(JSON.parse(stdout)).toEqual([0, 1, 0, 1]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_poll_init and uv_poll_start return libuv's error codes", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testPollErrors()));`);
    expect(stderr).toBe("");
    const { EINVAL, EBADF, EEXIST, ENOTSUP } = constants.errno;
    expect(JSON.parse(stdout)).toEqual([
      -EINVAL, // uv_poll_init without a loop
      -EBADF, // uv_poll_init with fd -1
      -EBADF, // uv_poll_init with a closed fd
      0, // uv_poll_init of handle A
      0, // uv_poll_init_socket of handle B on the same fd, which A doesn't watch yet
      -EINVAL, // uv_poll_start with a bit that isn't a uv_poll_event
      -ENOTSUP, // uv_poll_start with UV_PRIORITIZED
      -ENOTSUP, // uv_poll_start with only UV_DISCONNECT, which is never reported
      -EINVAL, // uv_poll_start without a callback
      0, // uv_is_active(A) after the failed starts
      0, // uv_poll_start(A) with UV_READABLE | UV_DISCONNECT
      -EEXIST, // uv_poll_start(B): A watches the fd
      -EEXIST, // uv_poll_init of handle C on the fd that A watches
      0, // uv_poll_start(A) with no events, which stops it
      0, // uv_is_active(A)
      0, // uv_poll_start(B): nothing watches the fd now
      0, // uv_poll_stop(B)
      -EINVAL, // uv_poll_start on an idle handle
      -EINVAL, // uv_poll_stop on an idle handle
      -EINVAL, // uv_poll_start(A) after uv_close
      0, // uv_poll_stop(A) after uv_close
      1, // uv_is_closing(A)
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_poll_init fails for a regular file and for a directory", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      const paths = ${JSON.stringify([addonPath, tempdir])};
      console.log(JSON.stringify(paths.map(path => addon.testPollInitFile(path))));
    `);
    expect(stderr).toBe("");
    // epoll refuses both fds. With kqueue, libuv's uv__io_check_fd returns UV_EINVAL for them.
    const refused = isLinux ? -constants.errno.EPERM : -constants.errno.EINVAL;
    expect(JSON.parse(stdout)).toEqual([refused, refused]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_poll_init refuses a named FIFO on macOS, like libuv", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      console.log(addon.testPollInitFifo(${JSON.stringify(path.join(tempdir, "poll-init-fifo"))}));
    `);
    expect(stderr).toBe("");
    // libuv's uv__io_check_fd returns UV_EINVAL for a FIFO on macOS: kqueue doesn't report that its last writer closed it.
    expect(stdout).toBe(`${isMacOS ? -constants.errno.EINVAL : 0}\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_poll_init returns UV_EINVAL for the loop of another thread", async () => {
    // uv_default_loop() is the main thread's loop, in a Worker too.
    const { stdout, stderr, exitCode } = await runInChild(`
      console.log("main", addon.testPollInitDefaultLoop());
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(
        \`
          const { parentPort } = require("node:worker_threads");
          parentPort.postMessage(require(${JSON.stringify(addonPath)}).testPollInitDefaultLoop());
        \`,
        { eval: true },
      );
      worker.on("message", message => console.log("worker", message));
      worker.on("exit", code => console.log("worker exited", code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(`main 0\nworker ${-constants.errno.EINVAL}\nworker exited 0\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("poll_cb doesn't run again while JS that it called runs the event loop", async () => {
    // Bun.build() runs the event loop until the promise that a plugin's setup() returned settles. The addon's check
    // callback reports from inside that run, after the loop polled the socket that poll_cb has not read yet.
    const { stdout, stderr, exitCode } = await runInChild(`
      let wait;
      addon.testPollNestedLoop((event, a, b) => {
        report(event, a, b);
        if (event === "check") wait.reject(new Error("the event loop ran inside poll_cb"));
        if (event !== "poll" || wait) return;
        wait = Promise.withResolvers();
        try {
          Bun.build({ entrypoints: [], plugins: [{ name: "wait", setup: () => wait.promise }] });
        } catch (error) {
          console.log(error.message);
        }
      });
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        `poll 0 ${UV_READABLE}`,
        "check 1 0",
        "the event loop ran inside poll_cb",
        `read 1 ${"x".charCodeAt(0)}`,
        // The most calls of poll_cb that were on the stack at once.
        "depth 1 0",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  // The two ways in which a script runs the event loop inside a call, which libuv never does. Each `runNested()`
  // logs "nested run ended" only if the loop made three iterations inside the call.

  // Bun.build() runs the loop until the promise that a plugin's setup() returned settles. The rejection reaches the
  // `catch` only if Bun.build() waited for it inside the call. The build itself fails for want of an entry point.
  const runNestedInBuild = `
    const runNested = () => {
      const wait = Promise.withResolvers();
      let turns = 0;
      const turn = () => (++turns < 3 ? setImmediate(turn) : wait.reject(new Error("nested run ended")));
      setImmediate(turn);
      try {
        Bun.build({ entrypoints: [], plugins: [{ name: "wait", setup: () => wait.promise }] });
      } catch (error) {
        log(error.message);
      }
    };
  `;

  // `Bun.Transpiler#transformSync` of code that calls an async macro runs the loop, under the script that called it,
  // until the promise of the macro settles. This is that code for a macro of nested-wait.ts.
  const callMacro = (name: string) =>
    JSON.stringify(
      `import { ${name} } from ${JSON.stringify(path.join(tempdir, "nested-wait.ts"))} with { type: "macro" };\n` +
        `export default ${name}();`,
    );

  // The macro counts its immediates, each of which is one loop iteration of the nested run.
  const runNestedInMacro = () => `
    const runNested = () => {
      globalThis.nestedTurns = 0;
      new Bun.Transpiler({ loader: "ts" }).transformSync(${callMacro("wait")});
      log(globalThis.nestedTurns === 3 ? "nested run ended" : "the macro made " + globalThis.nestedTurns + " turns");
    };
  `;

  // A debug build prints "[macro] call wait" to stdout.
  const withoutMacroLog = (stdout: string) =>
    stdout
      .split(/\r?\n/)
      .filter(line => !line.startsWith("[macro] "))
      .join("\n");

  test.concurrent("an exception thrown by JS called from poll_cb is reported as uncaught", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`
      addon.testPollFromThread(() => { throw new Error("thrown from inside poll_cb"); });
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("thrown from inside poll_cb");
    expect(exitCode).toBe(1);
  });

  // Runs `script` in a child with `t` (the "uv_close order" functions of uv_impl.c), `log(line)`, `spin()` and
  // `worker(source)`. Returns the lines that the child printed, joined with ", ".
  async function closeOrder(script: string, cmd?: string[], env?: typeof bunEnv) {
    const { stdout, stderr, exitCode } = await runInChild(
      `
        const t = addon.closeOrder;
        const log = t.log;
        // A 0 ms timer that was armed before this call is due after it.
        const spin = () => { const end = performance.now() + 3; while (performance.now() < end); };
        const worker = source => new (require("node:worker_threads").Worker)(
          "const t = require(" + JSON.stringify(${JSON.stringify(addonPath)}) + ").closeOrder; " + source,
          { eval: true },
        );
        ${script}
      `,
      cmd,
      env,
    );
    return { events: withoutMacroLog(stdout).trimEnd().split(/\r?\n/).join(", "), stderr, exitCode };
  }

  // t.open(on, startCheck, unref) makes the marker check handle and the target that t.close() closes.
  const open = `t.open(undefined, true, false);`;
  const openUnref = `t.open(undefined, true, true);`;
  const openNoCheck = `t.open(undefined, false, false);`;

  const immediates = "Bun runs immediates before the poll, Node after the check handles of the addon.";
  const tasksBeforePoll = "Bun calls async_cb and after_work_cb from tasks, before its poll, libuv in its poll phase.";
  const sendIsATask = "Bun delivers a send from a task, which the next loop iteration runs, libuv in its poll phase.";
  const firstTimers = "libuv runs the due timers before its first poll, Bun after it.";
  const checkOrder = "Bun runs check handles in start order, libuv the one started last first.";

  // What the hook of a row calls next, by the name of the row.
  const nextCallbacks = {
    "timer": "a uv_timer_t callback",
    "js timer": "a JS timer",
    "async": "an async_cb",
    "idle": "an idle callback",
    "prepare": "a prepare callback",
    "poll": "a poll_cb",
  };

  // libuv runs the close callbacks after the check handles and before the timers of the same loop iteration, the
  // handle that was closed last first. Each row runs on Node and on Bun. Without `bunOutput` both must print the
  // same. With it Bun must print `bunOutput` and Node something else, so a difference that goes away fails too.
  type CloseOrderRow = [name: string, script: string, bunOutput?: string, reason?: string];
  const closeOrderRows: CloseOrderRow[] = [
    // The call site of uv_close, with the marker started before it.
    ["the main script", `${open} t.close();`],
    ["a microtask", `${open} Promise.resolve().then(() => t.close());`],
    ["process.nextTick", `${open} process.nextTick(() => t.close());`],
    ["a JS timer", `${open} setTimeout(() => t.close(), 1);`],
    ["setImmediate", `${open} setImmediate(() => t.close());`, "closing, check, close", immediates],
    ["a uv_timer_t callback", `${open} t.hook("timer", () => t.close());`],
    ["an async_cb", `${open} t.hook("async", () => t.close());`],
    ["an idle callback", `${open} t.hook("idle", () => t.close());`],
    ["a prepare callback", `${open} t.hook("prepare", () => t.close());`],
    [
      "a check callback started after the marker",
      `${open} t.hook("check", () => t.close()); setImmediate(() => {});`,
      "closing, close",
      checkOrder,
    ],
    [
      "a check callback started before the marker",
      `t.hook("check", () => t.close()); ${open} setImmediate(() => {});`,
      "closing, check, close",
      checkOrder,
    ],
    [
      "a check callback, no other check handle",
      `${openNoCheck} t.hook("check", () => t.close()); setImmediate(() => {});`,
    ],
    ["a poll_cb", `${open} t.hook("poll", () => t.close());`],
    ["an after_work_cb", `${open} t.hook("work", () => t.close());`],
    ["the close_cb of another handle", `${open} t.hook("close", () => t.close());`],
    ["an fs callback", `${open} require("fs").stat(".", () => t.close());`],
    ["an fs.promises continuation", `${open} require("fs").promises.stat(".").then(() => t.close());`],
    [
      "a net connection callback",
      `${open}
       const net = require("net");
       const server = net.createServer(connection => { t.close(); connection.destroy(); server.close(); });
       server.listen(0, "127.0.0.1", () => net.connect(server.address().port, "127.0.0.1").on("error", () => {}));`,
    ],
    ["a dns.lookup callback", `${open} require("dns").lookup("127.0.0.1", () => t.close());`],
    ["a zlib callback", `${open} require("zlib").gzip("x", () => t.close());`],
    [
      "a child exit callback",
      `${open} require("child_process").execFile(process.execPath, ["-e", "0"], () => t.close());`,
    ],
    [
      "a MessageChannel message",
      `${open}
       const channel = new MessageChannel();
       channel.port1.onmessage = () => { t.close(); channel.port1.close(); };
       channel.port2.postMessage(1);`,
    ],
    ["beforeExit", `${openUnref} process.once("beforeExit", () => t.close());`],
    [
      "an N-API finalizer",
      `${open}
       (() => { for (let i = 0; i < 16; i++) t.closeWhenCollected(); })();
       const collect = globalThis.gc ?? (() => Bun.gc(true));
       const poll = () => { collect(); if (!t.isClosing()) setTimeout(poll, 1); };
       setTimeout(poll, 1);`,
      "closing, check, close",
      "Bun runs the finalizer as a task before the poll, Node with its immediates.",
    ],

    // What else runs between uv_close and close_cb.
    [
      "the main script, then an immediate",
      `${open} t.close(); setImmediate(() => log("immediate"));`,
      "closing, immediate, check, close",
      immediates,
    ],
    [
      "the main script, then a due JS timer",
      `${open} t.close(); setTimeout(() => log("js-timer"), 0); spin();`,
      "closing, check, close, js-timer",
      firstTimers,
    ],
    [
      "a timer that the check callback arms",
      `t.open(event => { if (event === "check") { setTimeout(() => log("js-timer"), 0); spin(); } }, true, false);
       t.close();`,
    ],
    [
      "a timer that the check callback arms, which exits",
      `t.open(event => { if (event === "check") { setTimeout(() => process.exit(0), 0); spin(); } }, true, false);
       t.close();`,
    ],
    [
      "an fs callback, then process.exit() from a due timer",
      `${open} require("fs").stat(".", () => { t.close(); setTimeout(() => process.exit(0), 0); spin(); });`,
    ],
    [
      "a JS timer, then process.exit() from a due timer",
      `${open} setTimeout(() => { t.close(); setTimeout(() => process.exit(0), 0); spin(); }, 1);`,
    ],
    [
      "two closes in one call, the one closed last first",
      `${open} t.hook("close", () => log("other close")); t.close();`,
    ],
    [
      "a close in a close_cb, which waits for the next loop iteration",
      `${open} t.hook("close", () => { log("first close"); t.close(); });`,
    ],

    // The marker is not started when uv_close is called.
    ["no check handle, then an immediate", `${openNoCheck} t.close(); setImmediate(() => log("immediate"));`],
    [
      "no check handle, then a due JS timer",
      `${openNoCheck} t.close(); setTimeout(() => log("js-timer"), 0); spin();`,
      "closing, close, js-timer",
      firstTimers,
    ],
    [
      "no check handle: a prepare callback, then an immediate",
      `${openNoCheck} t.hook("prepare", () => { t.close(); setImmediate(() => log("immediate")); });`,
      "closing, close, immediate",
      immediates,
    ],
    ["a check handle started after the close, in the same call", `${openNoCheck} t.close(); t.startCheck();`],
    [
      "a check handle started after the close, from a microtask",
      `${openNoCheck} t.close(); Promise.resolve().then(() => t.startCheck());`,
    ],
    [
      "a check handle started after the close, from a due JS timer",
      `${openNoCheck} t.close(); setTimeout(() => t.startCheck(), 0); spin();`,
      "closing, close",
      firstTimers,
    ],
    [
      "a check handle started after the close, from a prepare callback",
      `${openNoCheck} t.close(); t.hook("prepare", () => t.startCheck());`,
    ],

    // uv_close(handle, NULL): libuv has finished the close when the next timer callback runs, which frees the handle
    // or initializes it again. See close_then_free_in_timer and close_order_reinit_stop in uv_impl.c.
    [
      "a handle freed in the next timer: an fs callback",
      `${openUnref} require("fs").stat(".", () => t.closeThenFreeInTimer());`,
    ],
    ["a handle freed in the next timer: a JS timer", `${openUnref} setTimeout(() => t.closeThenFreeInTimer(), 1);`],
    [
      "a handle freed in the next timer: a uv_timer_t callback",
      `${openUnref} t.hook("timer", () => t.closeThenFreeInTimer());`,
    ],
    ["a handle freed in the next timer: an async_cb", `${openUnref} t.hook("async", () => t.closeThenFreeInTimer());`],
    [
      "a handle initialized again in the next timer",
      `${openUnref}
       t.reinitStart();
       require("fs").stat(".", () => {
         t.reinitStop();
         setTimeout(() => {
           t.reinitStart(() => {
             // A close that finishes only now marks the new handle closed: the guard in reinitStop() then skips
             // uv_close, and the timer repeats for ever.
             const closed = t.reinitStop();
             log("the second stop closed it: " + closed);
             if (!closed) process.exit(1);
           });
         }, 0);
         spin();
       });`,
    ],

    // uSockets frees a closed socket only if the check callback of its loop ran before close_cb.
    ["the uSockets shape", `t.usSocket("ref"); t.usClose();`],
    // Only the close that waits keeps the process alive.
    ["the uSockets shape with its check handle unref'd", `t.usSocket("unref"); t.usClose();`],
    ["the uSockets shape without a check handle", `t.usSocket("none"); t.usClose();`],

    // uv_close(handle, NULL) still keeps the loop alive until its next closing phase: only that lets the unref'd
    // marker run once.
    ["a close without a callback, which keeps the loop alive for one iteration", `${openUnref} t.closeNoCallback();`],

    // libuv calls async_cb and after_work_cb in its poll phase, so a close that one of them makes is finished before
    // whatever the next loop iteration calls. Bun calls the two before its poll: there only a timer still comes
    // after the close callback.
    ...(["async", "work"] as const).flatMap(origin =>
      Object.entries(nextCallbacks).map(([next, name]): CloseOrderRow => [
        `a close in ${origin === "async" ? "an async_cb" : "an after_work_cb"}, then ${name}`,
        `t.hook("${origin}", () => {
           ${open} t.close();
           ${next === "js timer" ? `setTimeout(() => log("js timer"), 0);` : `t.hook("${next}", () => log("${next}"));`}
           spin();
         });`,
        next.endsWith("timer") ? undefined : `closing, ${next}, check, close`,
        next.endsWith("timer") ? undefined : tasksBeforePoll,
      ]),
    ),

    // libuv delivers a send in the poll phase of the first loop iteration whose poll returns after it.
    [
      "a send in an idle callback, which libuv delivers in the same iteration",
      `${open} t.hook("idle", () => { t.close(); t.hook("async", () => log("async")); });`,
      "closing, check, close, async",
      sendIsATask,
    ],
    [
      "a send in a prepare callback, which libuv delivers in the same iteration",
      `${open} t.hook("prepare", () => { t.close(); t.hook("async", () => log("async")); });`,
      "closing, check, close, async",
      sendIsATask,
    ],
    [
      "a send in a poll_cb, which the next iteration delivers",
      `${open} t.hook("poll", () => { t.close(); t.hook("async", () => log("async")); });`,
    ],
    [
      "a send in an async_cb to its own handle, which libuv delivers in the next iteration",
      `${open} t.sendAgain(() => t.close());`,
      "closing, second async_cb, check, close",
      tasksBeforePoll,
    ],
    // Node runs its immediates after its poll phase, and Bun the task of a send before its immediates.
    ["a pending send, then an immediate", `t.hook("async", () => log("async")); setImmediate(() => log("immediate"));`],

    // t.chain(2) closes a handle whose close callback closes a second one.
    ["a Worker: its main script", `worker('t.open(undefined, true, false); t.close(); t.chain(2);');`],
    ["a Worker: a JS timer", `worker('t.open(undefined, true, false); setTimeout(() => t.close(), 1);');`],
    [
      "a Worker: its main script, then process.exit()",
      `worker('t.open(undefined, true, false); t.close(); t.chain(2); process.exit(0);');`,
      "closing, chain 1, close, chain 2",
      "A Worker that stops runs close_cb at its teardown, without the check handles.",
    ],
  ];

  // These rows end with a close that waits at the exit of the main thread, where neither Node nor Bun runs its
  // callback. The sanitizer lanes set BUN_DESTRUCT_VM_ON_EXIT for every child, which tears the VM down instead (the
  // test after these), so these children opt out of it and of the leak check that goes with it.
  const closeOrderRowsAtExit: typeof closeOrderRows = [
    ["the main script, then process.exit()", `${open} t.close(); process.exit(0);`],
    [
      "the main script, then process.exit() from an immediate",
      `${open} t.close(); setImmediate(() => process.exit(0));`,
      "closing",
      immediates,
    ],
    [
      "an exit listener",
      `${openUnref} process.on("exit", () => t.close());`,
      "closing",
      "Bun does not run the loop again after the exit listeners of the main thread.",
    ],
  ];
  const noDestruct = {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "0",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  };

  // Every row gets all its values, or the test function would get a `done` callback in place of a missing one.
  test.concurrent.each([
    ...closeOrderRows.map(([name, script, bunOutput, reason]) => [name, script, bunOutput, reason, bunEnv] as const),
    ...closeOrderRowsAtExit.map(
      ([name, script, bunOutput, reason]) => [name, script, bunOutput, reason, noDestruct] as const,
    ),
  ])("uv_close order on Node and on Bun: %s", async (_, script, bunOutput, reason, env) => {
    const [onBun, onNode] = await Promise.all([
      closeOrder(script, [bunExe()], env),
      closeOrder(script, [await nodeExeMatchingAbi(), "--expose-gc"], env),
    ]);
    expect(onNode.stderr).toBe("");
    expect(onNode.exitCode).toBe(0);
    if (bunOutput === undefined) {
      expect(onBun).toEqual(onNode);
    } else {
      expect(reason).toBeString();
      expect(onBun).toEqual({ events: bunOutput, stderr: "", exitCode: 0 });
      expect(onNode.events).not.toBe(bunOutput);
    }
  });

  test.concurrent.each([
    ["a natural exit", "", "closing, check, chain 1, close, chain 2"],
    // The close callback of the target closes the marker, and the one of the chain its second handle.
    ["process.exit()", "process.exit(0);", "closing, chain 1, close, chain 2"],
    // The teardown finds the closing phase half done: first the rest of its closes, then the one that its callback made.
    [
      "process.exit() in a close_cb that closed another handle",
      `t.hook("close", () => { t.chain(1, "inner"); process.exit(0); });`,
      "closing, check, chain 1, close, chain 2, inner 1",
    ],
  ])("every close_cb runs when the VM of the main thread is torn down: %s", async (_, exit, events) => {
    // BUN_DESTRUCT_VM_ON_EXIT=1 tears the VM down at exit, as the exit of a Worker does.
    const result = await closeOrder(`${open} t.close(); t.chain(2); ${exit}`, undefined, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
    });
    expect(result).toEqual({ events, stderr: "", exitCode: 0 });
  });

  test.concurrent("an exception thrown by JS called from close_cb is reported as uncaught", async () => {
    const { events, stderr, exitCode } = await closeOrder(`
      t.hook("close", () => { throw new Error("thrown from inside close_cb"); });
    `);
    expect(events).toBe("");
    expect(stderr).toContain("thrown from inside close_cb");
    expect(exitCode).toBe(1);
  });

  // Without the idle GC timer only a timer of the startup wakes the loop of these children, so one hangs if its poll
  // blocks while a close waits for the next loop iteration.
  const noGcTimer = { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" };

  test.concurrent("a closing handle keeps the poll of the event loop from blocking", async () => {
    // Each close callback of t.chain() closes the next handle.
    const result = await closeOrder(`${open} t.close(); t.chain(3);`, undefined, noGcTimer);
    expect(result).toEqual({ events: "closing, check, chain 1, close, chain 2, chain 3", stderr: "", exitCode: 0 });
  });

  test.concurrent("a uv_close that a finalizer makes when the event loop is about to sleep wakes it", async () => {
    // The addon of uv_close_in_finalizer.c is built with NAPI_EXPERIMENTAL, so the collector calls its finalizers
    // inside the collection. Bun.gc(false) asks for a collection, and the loop runs it when it is about to block in
    // its poll, after it has looked for closes that wait: the close is made there. Without the concurrent collector
    // that collection is finished there, too. The child has a timer of its own in its first 100 ms, which would end
    // that poll, so the collection comes after it. Then only the close itself can wake the poll, and the child
    // never exits if it doesn't.
    const { stdout, stderr, exitCode } = await runInChild(
      `
        const finalizers = require(${JSON.stringify(finalizerAddonPath)});
        finalizers.open(() => console.log("close_cb"));
        setTimeout(() => {
          // The buffers are garbage when this call returns. The finalizer of the first one that the collector frees
          // closes the handle.
          (() => { for (let i = 0; i < 256; i++) finalizers.closeWhenCollected(); })();
          Bun.gc(false);
        }, 300);
      `,
      undefined,
      { ...noGcTimer, BUN_JSC_useConcurrentGC: "0" },
    );
    expect(stderr).toBe("");
    expect(stdout.split(/\r?\n/)).toEqual(["close_cb", ""]);
    expect(exitCode).toBe(0);
  });

  // Bun keeps a close on a queue of the loop, so it doesn't use the handle after uv_close() has returned. libuv keeps
  // the handle on a list that goes through the handle, so these two are not allowed there. See close_then_overwrite
  // and close_twice in uv_impl.c.
  test.concurrent.each([
    ["with a close callback", "true", "closing, check, close_cb got the handle, untouched: true"],
    ["without a close callback", "false", "closing, check, untouched: true"],
  ])("uv_close %s leaves a handle that is overwritten after it alone", async (_, withCallback, events) => {
    const result = await closeOrder(`
      t.closeThenOverwrite(${withCallback});
      process.on("exit", () => log("untouched: " + t.overwritten()));
    `);
    expect(result).toEqual({ events, stderr: "", exitCode: 0 });
  });

  test.concurrent("a handle that is initialized and closed again before its close_cb gets both callbacks", async () => {
    const result = await closeOrder(`t.closeTwice();`);
    expect(result).toEqual({ events: "second close_cb, first close_cb", stderr: "", exitCode: 0 });
  });

  // t.guard(type, withCallback) gives the handle a page of its own that nothing can read or write from the return of
  // uv_close() until close_cb starts, or ever again without a close_cb. The child dies if the loop uses the handle
  // there. A new handle type adds itself to this list.
  const guardedTypes = ["timer", "async", "idle", "prepare", "check", "poll"];
  const guardAll = (withCallback: boolean) =>
    `for (const type of ${JSON.stringify(guardedTypes)}) t.guard(type, ${withCallback});`;
  const allClosing = guardedTypes.map(type => `closing ${type}`).join(", ");
  // The close callbacks run with the handle that was closed last first.
  const allClosed = guardedTypes
    .toReversed()
    .map(type => `close ${type}`)
    .join(", ");

  test.concurrent.each([
    ...guardedTypes.flatMap(type => [
      [`a uv_${type}_t with a close callback`, `t.guard("${type}", true);`, `closing ${type}, close ${type}, exit`],
      [`a uv_${type}_t without a close callback`, `t.guard("${type}", false);`, `closing ${type}, exit`],
    ]),
    // Bun.build() runs the closing phase inside the call.
    [
      "every handle type with a close callback, and then an event loop run nested in Bun.build",
      `${runNestedInBuild} setTimeout(() => { ${guardAll(true)} runNested(); }, 1);`,
      `${allClosing}, ${allClosed}, nested run ended, exit`,
    ],
    [
      "every handle type without a close callback, and then an event loop run nested in Bun.build",
      `${runNestedInBuild} setTimeout(() => { ${guardAll(false)} runNested(); }, 1);`,
      `${allClosing}, nested run ended, exit`,
    ],
    // The Worker stops with its closes queued, and its teardown runs the close callbacks.
    [
      "every handle type with a close callback in a Worker that exits",
      `worker(${JSON.stringify(`${guardAll(true)} process.exit(0);`)});`,
      `${allClosing}, ${allClosed}, exit`,
    ],
    [
      "every handle type without a close callback in a Worker that exits",
      `worker(${JSON.stringify(`${guardAll(false)} process.exit(0);`)});`,
      `${allClosing}, exit`,
    ],
  ])("the loop doesn't read or write a closed handle before its close_cb: %s", async (_, script, events) => {
    const result = await closeOrder(`${script} process.on("exit", () => log("exit"));`);
    expect(result).toEqual({ events, stderr: "", exitCode: 0 });
  });

  // See close_then_free_in_timer in uv_impl.c. libuv has finished a close when the next timer callback runs, so an
  // addon may free the handle there. These are the call sites at which the close used to be finished later.
  test.concurrent.each([
    ["setImmediate", `setImmediate(() => t.closeThenFreeInTimer());`],
    ["an idle callback", `t.hook("idle", () => t.closeThenFreeInTimer());`],
    ["a prepare callback", `t.hook("prepare", () => t.closeThenFreeInTimer());`],
    ["a check callback", `t.hook("check", () => t.closeThenFreeInTimer());`],
  ])("a handle closed without a callback in %s can be freed in the next uv_timer_t callback", async (_, script) => {
    const result = await closeOrder(`${openUnref} ${script}`);
    expect(result).toEqual({ events: "freed, done", stderr: "", exitCode: 0 });
  });

  // A loop run under a script frame calls every libuv callback, as it did before close_cb had a phase of its own: a
  // wait that only one of these callbacks ends returns. A wait that returns without running the loop fails the row,
  // and one that never returns times out. An async macro waits on the loop of the macro, which runs no task of the
  // loop of the script, and async_cb and after_work_cb are such tasks: those two waits never returned.
  const kindsThatEndABuildWait = ["timer", "async", "work", "idle", "prepare", "check", "close"];
  const kindsThatEndAMacroWait = ["timer", "idle", "prepare", "check"];

  test.concurrent.each([
    ...kindsThatEndABuildWait.map(kind => ["a setup() of Bun.build", kind] as const),
    ...kindsThatEndAMacroWait.map(kind => ["an async macro", kind] as const),
  ])("%s that waits for a libuv callback returns: %s", async (wait, kind) => {
    const result = await closeOrder(
      wait === "an async macro"
        ? `
          globalThis.nestedWait = Promise.withResolvers();
          t.hook("${kind}", () => { log("${kind} callback"); globalThis.nestedWait.resolve(); });
          new Bun.Transpiler({ loader: "ts" }).transformSync(${callMacro("waitFor")});
          log("the wait returned");
        `
        : `
          const wait = Promise.withResolvers();
          t.hook("${kind}", () => wait.reject(new Error("${kind} callback")));
          try {
            Bun.build({ entrypoints: [], plugins: [{ name: "wait", setup: () => wait.promise }] });
          } catch (error) {
            log(error.message);
          }
          log("the wait returned");
        `,
    );
    expect(result).toEqual({ events: `${kind} callback, the wait returned`, stderr: "", exitCode: 0 });
  });

  // An addon may free a handle, or initialize it again, in the first timer after uv_close(): libuv has finished the
  // close by then. A wait under the callback that made the close runs whole loop iterations, so there too the close
  // is finished before the next timer. `t.hook("timer")` and closeThenFreeInTimer() use a uv_timer_t, and the third
  // script a JS timer and then a uv_timer_t.
  const closeThenWait: [name: string, script: string, events: string][] = [
    [
      "the close callback comes before the next uv_timer_t callback",
      `${open} t.close(); t.hook("timer", () => log("uv_timer_t callback")); spin(); runNested();`,
      "closing, check, close, uv_timer_t callback, nested run ended",
    ],
    [
      "the next uv_timer_t callback frees the handle",
      `${openUnref} t.closeThenFreeInTimer(); spin(); runNested();`,
      "freed, done, nested run ended",
    ],
    [
      "the next timers initialize the handle again and close it again",
      `${openUnref}
       t.reinitStart();
       t.reinitStop();
       setTimeout(() => {
         t.reinitStart(() => {
           const closed = t.reinitStop();
           log("the second stop closed it: " + closed);
           if (!closed) process.exit(1);
         });
       }, 0);
       spin();
       runNested();`,
      "the second stop closed it: true, nested run ended",
    ],
  ];

  test.concurrent.each(
    closeThenWait.flatMap(([name, script, events]) =>
      (
        [
          ["a JS timer", `setTimeout(() => { ${script} }, 1);`],
          ["an fs callback", `require("fs").stat(".", () => { ${script} });`],
        ] as const
      ).flatMap(([site, scriptAtSite]) =>
        (["an async macro", "Bun.build"] as const).map(wait => [wait, site, name, scriptAtSite, events] as const),
      ),
    ),
  )("uv_close and then a wait in %s, both in %s: %s", async (wait, _site, _name, script, events) => {
    const result = await closeOrder(`${wait === "Bun.build" ? runNestedInBuild : runNestedInMacro()} ${script}`);
    expect(result).toEqual({ events, stderr: "", exitCode: 0 });
  });

  test.concurrent("a Worker's uv_close of a handle on uv_default_loop() runs close_cb on the main thread", async () => {
    // uv_default_loop() is the main thread's loop, in a Worker too. Only the interval keeps the main thread alive
    // once the close is finished. It is cleared when the Worker has exited and the close callback has run.
    const result = await closeOrder(`
      let exited = false;
      const interval = setInterval(() => {
        if (!exited || t.defaultLoopCloses() === 0) return;
        clearInterval(interval);
        log("interval cleared");
      }, 1);
      worker("t.closeOnDefaultLoop();").on("exit", code => {
        exited = true;
        log("worker exited " + code);
      });
      process.on("exit", () => log("close_cb calls on the main thread: " + t.defaultLoopCloses()));
    `);
    expect(result).toEqual({
      events: "worker exited 0, interval cleared, close_cb calls on the main thread: 1",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("close_cb runs after an uncaught error under --hot", async () => {
    // After an uncaught error, --hot and --watch wait for a file to change in a loop of their own, which runs no
    // phase of a loop iteration. The close callback still runs there. The check handle of the script doesn't, so the
    // script prints no `check`. See close-then-throw.js above.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "close-then-throw.js"],
      cwd: tempdir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // The child never exits, so read until it has printed the error and the close callback has run.
    const readUntil = async (stream: ReadableStream<Uint8Array>, done: (text: string) => boolean) => {
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of stream) {
        text += decoder.decode(chunk, { stream: true });
        if (done(text)) break;
      }
      return text;
    };
    const [stdout, stderr] = await Promise.all([
      readUntil(proc.stdout, text => text.split(/\r?\n/).includes("close")),
      readUntil(proc.stderr, text => text.includes("thrown after uv_close")),
    ]);
    proc.kill();
    expect(stdout.split(/\r?\n/)).toEqual(["closing", "close", ""]);
    expect(stderr).toContain("thrown after uv_close");
  });

  test.concurrent("close_cb runs after a line of bun repl that isn't awaited", async () => {
    // The REPL runs loop iterations only while it waits for the promise of a line. After any other line it ticks
    // the event loop and then runs the closing phase.
    const home = tempDirWithFiles("uv-repl-home", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      stdin: Buffer.from(
        [
          `const t = require(${JSON.stringify(addonPath)}).closeOrder;`,
          `t.open(undefined, false, false); t.close(); t.log("first line");`,
          `t.log("second line");`,
          "",
        ].join("\n"),
      ),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...bunEnv, TERM: "dumb", NO_COLOR: "1", HOME: home, USERPROFILE: home },
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const printed = ["closing", "first line", "close", "second line"];
    expect(stdout.split(/\r?\n/).filter(line => printed.includes(line))).toEqual(printed);
    expect(exitCode).toBe(0);
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

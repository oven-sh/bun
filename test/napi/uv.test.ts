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

  // The loop-backed functions (uv_default_loop, uv_async_t, uv_queue_work) and
  // the header-only ones around them run in a child process: the child's exit
  // is part of what is tested (a ref'd handle or a queued request must keep it
  // alive, an unref'd handle must not), and on a bun where these are still
  // stubs the first call aborts the process. `script` sees `addon` and
  // `report`, which prints one line per event the addon reports.
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

  test.concurrent("UV_EINVAL for a missing loop, a missing work_cb and a non-work request", async () => {
    const { stdout, stderr, exitCode } = await runInChild(`console.log(JSON.stringify(addon.testErrors()));`);
    expect(stderr).toBe("");
    const EINVAL = -constants.errno.EINVAL;
    expect(JSON.parse(stdout)).toEqual([EINVAL, EINVAL, EINVAL]);
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
});

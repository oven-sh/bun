import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import path from "node:path";
import source from "./uv-stub-stuff/uv_impl.c" with { type: "file" };

// We use libuv on Windows
describe.if(!isWindows)("uv stubs", () => {
  const cwd = process.cwd();
  let tempdir: string = "";
  let outdir: string = "";
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

    nativeModule = require(path.join(tempdir, "./build/Release/uv_test.node"));
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

  // Run the uv_async_t tests in a subprocess: the async callback is deferred to
  // the next event-loop tick, and on older builds these functions abort the
  // process.
  async function runUvAsync(useDefaultLoop: boolean, sendFromThread: boolean) {
    const addon = path.join(tempdir, "./build/Release/uv_test.node");
    const script = `
      const addon = require(${JSON.stringify(addon)});
      const sync = addon.testUvAsync(${useDefaultLoop}, ${sendFromThread}, result => {
        console.log(JSON.stringify({ sync, result }));
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim().length).toBeGreaterThan(0);
    const out = JSON.parse(stdout.trim());
    expect(out).toEqual({
      sync: {
        initRc: 0,
        defaultLoopMatchesNapiLoop: true,
        handleType: out.sync.expectedHandleType,
        expectedHandleType: out.sync.expectedHandleType,
        handleLoopMatches: true,
        handleDataMatches: true,
        hasRefAfterInit: 1,
        isActiveAfterInit: 1,
        isClosingAfterInit: 0,
        hasRefAfterUnref: 0,
        hasRefAfterReref: 1,
        firedSynchronously: 0,
      },
      result: {
        asyncFired: 1,
        closed: 1,
        isClosingInCloseCb: 1,
      },
    });
    expect(exitCode).toBe(0);
  }

  test.concurrent("uv_async: napi_get_uv_event_loop, send from loop thread", async () => {
    await runUvAsync(false, false);
  });

  test.concurrent("uv_async: napi_get_uv_event_loop, send from another thread", async () => {
    await runUvAsync(false, true);
  });

  test.concurrent("uv_async: uv_default_loop, send from loop thread", async () => {
    await runUvAsync(true, false);
  });

  test.concurrent("uv_async: uv_default_loop, send from another thread", async () => {
    await runUvAsync(true, true);
  });

  test.concurrent("uv_async: close with a send already queued skips async_cb", async () => {
    const addon = path.join(tempdir, "./build/Release/uv_test.node");
    const script = `
      const addon = require(${JSON.stringify(addon)});
      const sync = addon.testUvAsyncClosePending(result => {
        console.log(JSON.stringify({ sync, result }));
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    expect(out).toEqual({
      sync: { firedSynchronously: 0, isClosingAfterClose: 1 },
      result: { asyncFired: 0, closed: 1, isClosingInCloseCb: 1 },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("uv_async: ref'd handle keeps the process alive until unref", async () => {
    const addon = path.join(tempdir, "./build/Release/uv_test.node");
    // The timer is unref'd so the uv_async handle is the only thing keeping
    // the loop alive; if its loop ref is a no-op the process exits before the
    // timer fires and stdout is empty.
    const script = `
      const addon = require(${JSON.stringify(addon)});
      addon.testUvAsyncKeepaliveInit();
      setTimeout(() => {
        console.log("alive");
        addon.testUvAsyncKeepaliveUnref();
        // After unref there is nothing keeping the loop alive; the process
        // must exit on its own without an explicit process.exit().
      }, 20).unref();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("alive\n");
    expect(exitCode).toBe(0);
  });
});

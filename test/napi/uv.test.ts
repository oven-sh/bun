import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, canBuildNodeAddons, isWindows, tempDirWithFiles } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { symbols, test_skipped } from "../../src/jsc/bindings/libuv/generate_uv_posix_stubs_constants";
import defaultLoopSource from "./uv-stub-stuff/default_loop.c";
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
});

// On Windows bun links real libuv and addons resolve uv_* from bun.exe. The
// exported uv_default_loop must return the loop bun drives: NAN-era addons
// (ibm_db) call uv_queue_work(uv_default_loop(), ...) directly, and the
// after-work callback only fires when that loop runs (#40225). libuv's real
// default loop exists in the binary but nothing ever runs it.
describe.if(isWindows && canBuildNodeAddons())("uv_default_loop", () => {
  let addon: {
    queueWork: (cb: (ranWork: number) => void) => void;
    defaultLoopIsNapiLoop: () => boolean;
  };

  beforeAll(async () => {
    const files = {
      "default_loop.c": await Bun.file(defaultLoopSource).text(),
      // `bun --bun node-gyp` (the napi-app recipe): under node, config.gypi
      // inherits clang=1 and lld linker flags from node's own build and MSBuild
      // then wants the ClangCL toolset, which plain VS installs lack.
      "package.json": JSON.stringify({
        "name": "default-loop-addon",
        "version": "1.0.0",
        "gypfile": true,
        "scripts": {
          "install": "bun --bun node-gyp rebuild",
        },
        "dependencies": {
          "node-gyp": "^11.2.0",
        },
      }),
      "binding.gyp": `{
        "targets": [
          {
            "target_name": "default_loop",
            "sources": [ "default_loop.c" ],
          },
        ]
      }`,
    };
    const tempdir = tempDirWithFiles("uv-default-loop", files);
    await Bun.$`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    addon = require(path.join(tempdir, "build/Release/default_loop.node"));
    // The MSBuild compile of the addon overruns the default 5s hook timeout.
  }, 300_000);

  test("returns the loop bun drives", () => {
    expect(addon.defaultLoopIsNapiLoop()).toBe(true);
  });

  test("uv_queue_work on it delivers the after-work callback", async () => {
    const ranWork = await new Promise(resolve => addon.queueWork(resolve));
    expect(ranWork).toBe(1);
  });
});

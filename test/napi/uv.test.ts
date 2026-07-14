import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDirWithFiles } from "harness";
import path from "node:path";
import { symbols, test_skipped } from "../../src/jsc/bindings/libuv/generate_uv_posix_stubs_constants";
import source from "./uv-stub-stuff/uv_impl.c";

const symbols_to_test = symbols.filter(s => !test_skipped.includes(s));

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

  // Pure loop-free libuv functions. These crash with SIGABRT on builds where
  // they're still abort-stubs, so they run in a subprocess.
  async function runPure(fn: string) {
    const script = `
      const m = require(${JSON.stringify(path.join(tempdir, "./build/Release/uv_test.node"))});
      process.stdout.write(JSON.stringify(m[${JSON.stringify(fn)}]()));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  test.concurrent("uv_version / uv_version_string", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testVersion");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const result = JSON.parse(stdout);
    expect(result.versionString).toMatch(/^\d+\.\d+\.\d+/);
    const [major, minor, patch] = result.versionString.split(/[.-]/).map(Number);
    expect(result.versionHex).toBe((major << 16) | (minor << 8) | patch);
    expect(result.versionString).toBe(process.versions.uv);
  });

  test.concurrent("uv_buf_init", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testBufInit");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    expect(JSON.parse(stdout)).toEqual({ baseOk: true, len: 16 });
  });

  test.concurrent("uv_err_name / uv_strerror / uv_translate_sys_error", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testErrors");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const result = JSON.parse(stdout);
    expect(result).toEqual({
      errNameENOENT: "ENOENT",
      errNameEINVAL: "EINVAL",
      errNameUnknown: null,
      strerrorENOENT: "no such file or directory",
      strerrorUnknown: "Unknown system error",
      errNameR: "EBUSY",
      errNameRUnknown: "Unknown system error 1234",
      strerrorR: "resource busy or locked",
      strerrorRUnknown: "Unknown system error 1234",
      translateENOENT: result.uvENOENT,
      translateZero: 0,
      uvENOENT: result.uvENOENT,
    });
    expect(result.uvENOENT).toBeLessThan(0);
  });

  test.concurrent("uv_handle_type_name / uv_req_type_name / sizes", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testTypeNames");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    expect(JSON.parse(stdout)).toEqual({
      handleAsync: "async",
      handleTimer: "timer",
      handleFile: "file",
      handleUnknown: null,
      handleMax: null,
      reqWrite: "write",
      reqUnknown: null,
      reqMax: null,
      handleSizeAsync: true,
      handleSizeTimer: true,
      reqSizeWrite: true,
      handleSizeMax: true,
      reqSizeMax: true,
    });
  });

  test.concurrent("uv_sleep", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testSleep");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    // uv_sleep(10) => at least 10ms in ns
    expect(Number(stdout)).toBeGreaterThanOrEqual(10_000_000);
  });

  test.concurrent("uv_gettimeofday / uv_clock_gettime", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testTime");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const result = JSON.parse(stdout);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(result.gettimeofdayRet).toBe(0);
    expect(Math.abs(result.gettimeofdaySec - nowSec)).toBeLessThan(300);
    expect(result.gettimeofdayNull).toBe(result.uvEINVAL);
    expect(result.clockMono).toBe(0);
    expect(result.clockReal).toBe(0);
    expect(Math.abs(result.clockRealSec - nowSec)).toBeLessThan(300);
    expect(result.clockNull).toBe(result.uvEFAULT);
    expect(result.clockBadId).toBe(result.uvEINVAL);
  });

  test.concurrent("uv_available_parallelism / osfhandle / setup_args / library_shutdown", async () => {
    const { stdout, stderr, exitCode, signalCode } = await runPure("testMisc");
    expect({ stderr: normalizeBunSnapshot(stderr), exitCode, signalCode }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const result = JSON.parse(stdout);
    expect(result).toEqual({
      parallelism: result.parallelism,
      getOsfhandle: 7,
      openOsfhandle: 7,
      setupArgs: true,
      libraryShutdown: true,
    });
    expect(result.parallelism).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(result.parallelism)).toBe(true);
  });
});

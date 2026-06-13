import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, makeTree, tempDirWithFiles } from "harness";
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
    await makeTree(tempdir, files);
    outdir = path.join(tempdir, "dist");

    process.chdir(tempdir);

    const libuvDir = path.join(__dirname, "../../src/jsc/bindings/libuv");
    await Bun.$`cp -R ${libuvDir} ${path.join(tempdir, "libuv")}`;
    await Bun.$`${bunExe()} i && ${bunExe()} build:napi`.env(bunEnv).cwd(tempdir);

    nativeModule = require(path.join(tempdir, "./build/Release/uv_test.node"));
    // Building the addon with node-gyp takes much longer than the default
    // per-test timeout.
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

  test("uv_version and uv_version_string", () => {
    const r = nativeModule.testVersion();
    expect(r.major).toBe(1);
    expect(r.version).toBe((r.major << 16) | (r.minor << 8) | r.patch);
    expect(r.versionString).toStartWith(`${r.major}.${r.minor}.${r.patch}`);
  });

  test("uv_cwd", () => {
    const r = nativeModule.testCwd();
    const cwdByteLength = Buffer.byteLength(r.cwd);
    expect(r.rcBig).toBe(0);
    expect(r.cwd).toBe(process.cwd());
    expect(r.bigSize).toBe(cwdByteLength);
    // A too-small buffer reports UV_ENOBUFS and the required size (including
    // the NUL terminator).
    expect(r.rcSmall).toBe(nativeModule.constants.UV_ENOBUFS);
    expect(r.smallSize).toBe(cwdByteLength + 1);
    expect(r.rcInvalid).toBe(nativeModule.constants.UV_EINVAL);
  });

  test("uv_get_osfhandle and uv_open_osfhandle", () => {
    expect(nativeModule.testOsfhandle()).toBe(true);
  });

  test("uv_thread_self and uv_thread_equal", () => {
    expect(nativeModule.testThreadSelf()).toEqual({
      selfEqualsSelf: true,
      selfMatchesPthread: true,
      otherThreadDiffers: true,
    });
  });

  test("uv_ip4_addr, uv_ip4_name, uv_ip_name", () => {
    const { UV_EINVAL } = nativeModule.constants;
    expect(nativeModule.testIp4()).toEqual({
      rc: 0,
      familyOk: true,
      port: 8080,
      addrRaw: 0x7f000001,
      nameRc: 0,
      name: "127.0.0.1",
      genericRc: 0,
      genericName: "127.0.0.1",
      invalidOctetRc: UV_EINVAL,
      invalidStringRc: UV_EINVAL,
    });
  });

  test("uv_ip6_addr, uv_ip6_name", () => {
    expect(nativeModule.testIp6()).toEqual({
      rc: 0,
      familyOk: true,
      port: 9090,
      isLoopback: true,
      nameRc: 0,
      name: "::1",
      rc2: 0,
      name2Rc: 0,
      name2: "2001:db8:85a3::8a2e:370:7334",
      invalidRc: nativeModule.constants.UV_EINVAL,
    });
  });

  test("uv_inet_pton and uv_inet_ntop", () => {
    const { UV_ENOSPC, UV_EINVAL, UV_EAFNOSUPPORT } = nativeModule.constants;
    expect(nativeModule.testInet()).toEqual({
      pton4Rc: 0,
      bytesOk: true,
      ntop4Rc: 0,
      round4: "192.168.100.200",
      pton6Rc: 0,
      ntop6Rc: 0,
      round6: "2001:db8::ff00:42:8329",
      nospcRc: UV_ENOSPC,
      einvalRc: UV_EINVAL,
      eafnosupportRc: UV_EAFNOSUPPORT,
    });
  });

  test("uv_cond wait/signal", () => {
    expect(nativeModule.testCondSignal()).toBe(1);
  });

  test("uv_cond broadcast", () => {
    expect(nativeModule.testCondBroadcast()).toBe(2);
  });

  test("uv_cond_timedwait times out", () => {
    const r = nativeModule.testCondTimedwait();
    expect(r.rc).toBe(nativeModule.constants.UV_ETIMEDOUT);
    // 20ms requested; anything way below means the deadline computation used
    // the wrong clock.
    expect(r.elapsedMs).toBeGreaterThanOrEqual(10);
  });

  test("uv_sem", () => {
    const { UV_EAGAIN } = nativeModule.constants;
    // testSem also exercises a blocking uv_sem_wait satisfied by uv_sem_post
    // from another thread; returning at all proves it woke up.
    expect(nativeModule.testSem()).toEqual({
      try1: 0,
      try2: 0,
      tryEmpty: UV_EAGAIN,
      tryAfterPost: 0,
    });
  });

  test("uv_rwlock", () => {
    const { UV_EBUSY } = nativeModule.constants;
    expect(nativeModule.testRwlock()).toEqual({
      secondReaderRc: 0,
      tryrdWhileWriterRc: UV_EBUSY,
      trywrWhileWriterRc: UV_EBUSY,
      trywrAfterUnlockRc: 0,
    });
  });

  test("uv_interface_addresses", () => {
    const r = nativeModule.testInterfaceAddresses();
    expect(r.rc).toBe(0);
    expect(r.interfaces).toHaveLength(r.count);
    expect(r.count).toBeGreaterThanOrEqual(1);
    for (const iface of r.interfaces) {
      expect(iface.name.length).toBeGreaterThan(0);
      expect(["ipv4", "ipv6"]).toContain(iface.family);
      expect(iface.addressRc).toBe(0);
      expect(iface.address.length).toBeGreaterThan(0);
    }
    // Every environment we test in has a loopback interface up.
    const internal = r.interfaces.filter((iface: any) => iface.isInternal);
    expect(internal.length).toBeGreaterThanOrEqual(1);
    expect(internal.some((iface: any) => iface.address === "127.0.0.1" || iface.address === "::1")).toBe(true);
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
});

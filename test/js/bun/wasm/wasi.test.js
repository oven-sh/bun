import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";
import { WASI } from "node:wasi";

it("Should support printing 'hello world'", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), import.meta.dir + "/hello-wasi.wasm"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect({
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    exitCode: exitCode,
  }).toEqual({
    stdout: "hello world\n",
    stderr: "",
    exitCode: 0,
  });
});

describe("poll_oneoff clock subscriptions", () => {
  const WASI_ESUCCESS = 0;
  const WASI_EVENTTYPE_CLOCK = 0;
  const WASI_EVENTTYPE_FD_READ = 1;
  const WASI_CLOCK_MONOTONIC = 1;
  const WASI_SUBSCRIPTION_CLOCK_ABSTIME = 1;
  const WASI_STDIN_FILENO = 0;
  const SUBSCRIPTION_SIZE = 48;
  const TEN_SECONDS_NS = 10_000_000_000n;
  const TEN_SECONDS_MS = 10_000;
  const sin = 512;
  const sout = 1024;
  const neventsPtr = 128;

  // `sleep` is the hook poll_oneoff uses to block (Bun.sleepSync by default). Recording
  // its argument instead of sleeping keeps the tests fast and turns a wrong wait length
  // into a wrong number instead of a hang.
  function setup(sleep) {
    const wasi = new WASI({ version: "preview1", sleep });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    return { wasi, view: new DataView(wasi.memory.buffer) };
  }

  function writeClockSubscription(view, offset, { userdata, timeout, absolute = false }) {
    view.setBigUint64(offset + 0, userdata, true);
    view.setUint8(offset + 8, WASI_EVENTTYPE_CLOCK);
    view.setUint32(offset + 16, WASI_CLOCK_MONOTONIC, true);
    view.setBigUint64(offset + 24, timeout, true);
    view.setBigUint64(offset + 32, 0n, true);
    view.setUint16(offset + 40, absolute ? WASI_SUBSCRIPTION_CLOCK_ABSTIME : 0, true);
  }

  function writeStdinReadSubscription(view, offset, userdata) {
    view.setBigUint64(offset + 0, userdata, true);
    view.setUint8(offset + 8, WASI_EVENTTYPE_FD_READ);
    view.setUint32(offset + 16, WASI_STDIN_FILENO, true);
  }

  it("a relative timeout sleeps for the timeout", () => {
    // The hostcall wasi-libc makes for sleep()/usleep()/nanosleep().
    const sleeps = [];
    const { wasi, view } = setup(ms => void sleeps.push(ms));
    writeClockSubscription(view, sin, { userdata: 42n, timeout: TEN_SECONDS_NS });

    const errno = wasi.wasiImport.poll_oneoff(sin, sout, 1, neventsPtr);

    expect(errno).toBe(WASI_ESUCCESS);
    expect(view.getUint32(neventsPtr, true)).toBe(1);
    expect(view.getBigUint64(sout + 0, true)).toBe(42n);
    expect(view.getUint16(sout + 8, true)).toBe(WASI_ESUCCESS);
    expect(view.getUint8(sout + 10)).toBe(WASI_EVENTTYPE_CLOCK);
    // Less the time poll_oneoff itself took before it got around to sleeping.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeLessThanOrEqual(TEN_SECONDS_MS);
    expect(sleeps[0]).toBeGreaterThan(TEN_SECONDS_MS - 1000);
  });

  it("an absolute deadline sleeps until the deadline", () => {
    const sleeps = [];
    const { wasi, view } = setup(ms => void sleeps.push(ms));
    const deadline = BigInt(Bun.nanoseconds()) + TEN_SECONDS_NS;
    writeClockSubscription(view, sin, { userdata: 7n, timeout: deadline, absolute: true });

    const errno = wasi.wasiImport.poll_oneoff(sin, sout, 1, neventsPtr);

    expect(errno).toBe(WASI_ESUCCESS);
    expect(view.getUint32(neventsPtr, true)).toBe(1);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeLessThanOrEqual(TEN_SECONDS_MS);
    expect(sleeps[0]).toBeGreaterThan(TEN_SECONDS_MS - 1000);
  });

  it("time already spent inside poll_oneoff is deducted from the wait", () => {
    // The hostcall wasi-libc makes for poll() on stdin with a timeout. With no recent stdin
    // activity, poll_oneoff pauses 50ms for the stdin subscription (shortPause) before it
    // reaches the clock wait; the clock wait must be shortened by the time that took.
    const sleeps = [];
    const { wasi, view } = setup(ms => {
      sleeps.push(ms);
      if (sleeps.length === 1) Bun.sleepSync(ms);
    });
    writeStdinReadSubscription(view, sin, 1n);
    writeClockSubscription(view, sin + SUBSCRIPTION_SIZE, { userdata: 2n, timeout: TEN_SECONDS_NS });

    const errno = wasi.wasiImport.poll_oneoff(sin, sout, 2, neventsPtr);

    expect(errno).toBe(WASI_ESUCCESS);
    expect(view.getUint32(neventsPtr, true)).toBe(2);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBe(50);
    expect(sleeps[1]).toBeLessThanOrEqual(TEN_SECONDS_MS - 50);
    expect(sleeps[1]).toBeGreaterThan(TEN_SECONDS_MS - 1000);
  });
});

it("fd_fdstat_set_rights only narrows the rights of a descriptor", () => {
  using dir = tempDir("wasi-set-rights", {
    "inside.txt": "inside",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));

  const WASI_ESUCCESS = 0;
  const WASI_EPERM = 63;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const allRights = BigInt.asIntN(64, BigInt("0xffffffffffffffff"));

  const stdinRights = wasi.FD_MAP.get(0).rights;
  const baseBefore = stdinRights.base;
  const inheritingBefore = stdinRights.inheriting;

  expect(wasi.wasiImport.fd_fdstat_set_rights(0, allRights, allRights)).toBe(WASI_EPERM);
  expect(wasi.FD_MAP.get(0).rights).toEqual({ base: baseBefore, inheriting: inheritingBefore });

  expect(wasi.wasiImport.fd_fdstat_set_rights(0, WASI_RIGHT_FD_READ, BigInt(0))).toBe(WASI_ESUCCESS);
  expect(wasi.FD_MAP.get(0).rights).toEqual({ base: WASI_RIGHT_FD_READ, inheriting: BigInt(0) });
});

it("random_get fills only the requested window", () => {
  const wasi = new WASI({});
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));

  const WASI_ESUCCESS = 0;
  const bufPtr = 1024;
  const bufLen = 16;

  const before = new Uint8Array(wasi.memory.buffer.slice(0));
  expect(wasi.wasiImport.random_get(bufPtr, bufLen)).toBe(WASI_ESUCCESS);
  const after = new Uint8Array(wasi.memory.buffer);

  // Every byte outside [bufPtr, bufPtr + bufLen) must be untouched: passing the
  // whole ArrayBuffer randomized all of linear memory.
  let changedOutside = 0;
  for (let i = 0; i < after.length; i++) {
    if (i >= bufPtr && i < bufPtr + bufLen) continue;
    if (after[i] !== before[i]) changedOutside++;
  }
  expect(changedOutside).toBe(0);

  // ...and the window itself is filled (all-zero is a 1-in-2^128 false failure).
  expect(after.subarray(bufPtr, bufPtr + bufLen).some(b => b !== 0)).toBe(true);
});

it("path_open reports the host errno to the guest when the open fails", () => {
  using dir = tempDir("wasi-path-open-errno", {
    "exists.txt": "x",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_EEXIST = 20;
  const WASI_O_CREAT = 1 << 0;
  const WASI_O_EXCL = 1 << 2;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 16384;
  const sentinel = 0x12345678;

  const len = memory.write("exists.txt", pathPtr);
  view.setUint32(fdPtr, sentinel, true);

  expect(
    wasi.wasiImport.path_open(
      preopenFd,
      0,
      pathPtr,
      len,
      WASI_O_CREAT | WASI_O_EXCL,
      WASI_RIGHT_FD_READ,
      BigInt(0),
      0,
      fdPtr,
    ),
  ).toBe(WASI_EEXIST);
  expect(new DataView(wasi.memory.buffer).getUint32(fdPtr, true)).toBe(sentinel);
  expect(wasi.FD_MAP.has(4)).toBe(false);
});

it("path_* syscalls cannot escape the preopened directory", () => {
  using dir = tempDir("wasi-sandbox", {
    "secret.txt": "outside",
    "sandbox/inside.txt": "inside",
  });
  const root = String(dir);
  const sandbox = path.join(root, "sandbox");
  if (!isWindows) {
    // a symlink that already exists inside the preopen and points outside of it
    fs.symlinkSync(path.join("..", "secret.txt"), path.join(sandbox, "escape"));
  }

  const wasi = new WASI({ preopens: { "/": sandbox } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_ENOTCAPABLE = 76;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const preopenFd = 3;
  const pathPtr = 1024;
  const statBufPtr = 8192;
  const fdPtr = 16384;
  const writePath = p => memory.write(p, pathPtr);

  // (1) absolute guest path naming an arbitrary host file must not reach it
  let len = writePath(path.join(root, "secret.txt"));
  expect(wasi.wasiImport.path_filestat_get(preopenFd, 1, pathPtr, len, statBufPtr)).not.toBe(WASI_ESUCCESS);

  // (2) ".." traversal out of the preopen
  len = writePath("../secret.txt");
  expect(wasi.wasiImport.path_filestat_get(preopenFd, 0, pathPtr, len, statBufPtr)).toBe(WASI_ENOTCAPABLE);
  expect(wasi.wasiImport.path_unlink_file(preopenFd, pathPtr, len)).toBe(WASI_ENOTCAPABLE);
  expect(fs.existsSync(path.join(root, "secret.txt"))).toBe(true);

  // (3) a pre-placed symlink inside the preopen that points outside of it
  if (!isWindows) {
    len = writePath("escape");
    expect(wasi.wasiImport.path_filestat_get(preopenFd, 1, pathPtr, len, statBufPtr)).toBe(WASI_ENOTCAPABLE);
    expect(wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, 0, WASI_RIGHT_FD_READ, BigInt(0), 0, fdPtr)).toBe(
      WASI_ENOTCAPABLE,
    );
    expect(wasi.FD_MAP.has(4)).toBe(false);
  }

  // a path that stays inside the preopen still works
  len = writePath("inside.txt");
  expect(wasi.wasiImport.path_filestat_get(preopenFd, 0, pathPtr, len, statBufPtr)).toBe(WASI_ESUCCESS);
  expect(wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, 0, WASI_RIGHT_FD_READ, BigInt(0), 0, fdPtr)).toBe(
    WASI_ESUCCESS,
  );
  expect(wasi.FD_MAP.has(4)).toBe(true);
});

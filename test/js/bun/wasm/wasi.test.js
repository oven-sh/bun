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

it("poll_oneoff waits on a clock subscription and reports the event", () => {
  const sleeps = [];
  const wasi = new WASI({ sleep: ms => sleeps.push(ms) });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EVENTTYPE_CLOCK = 0;
  const WASI_CLOCK_MONOTONIC = 1;
  const subscriptionPtr = 1024;
  const eventPtr = 2048;
  const neventsPtr = 4096;
  const userdata = BigInt("0x1122334455667788");

  // subscription: userdata u64, tag u8, clock { id u32, timeout u64 (ns), precision u64, flags u16 }
  view.setBigUint64(subscriptionPtr, userdata, true);
  view.setUint8(subscriptionPtr + 8, WASI_EVENTTYPE_CLOCK);
  view.setUint32(subscriptionPtr + 16, WASI_CLOCK_MONOTONIC, true);
  // The injected sleep() returns at once, so a long timeout costs nothing and the time already spent in
  // poll_oneoff cannot use it up.
  view.setBigUint64(subscriptionPtr + 24, BigInt(60_000_000_000), true);

  expect(wasi.wasiImport.poll_oneoff(subscriptionPtr, eventPtr, 1, neventsPtr)).toBe(WASI_ESUCCESS);
  expect(sleeps).toHaveLength(1);
  expect(sleeps[0]).toBeGreaterThan(59_000);
  expect(sleeps[0]).toBeLessThanOrEqual(60_000);

  const after = new DataView(wasi.memory.buffer);
  expect({
    nevents: after.getUint32(neventsPtr, true),
    userdata: after.getBigUint64(eventPtr, true),
    errno: after.getUint16(eventPtr + 8, true),
    type: after.getUint8(eventPtr + 10),
  }).toEqual({
    nevents: 1,
    userdata,
    errno: WASI_ESUCCESS,
    type: WASI_EVENTTYPE_CLOCK,
  });
});

describe("poll_oneoff", () => {
  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  const WASI_ENOSYS = 52;
  const WASI_EVENTTYPE_CLOCK = 0;
  const WASI_EVENTTYPE_FD_READ = 1;
  const WASI_EVENTTYPE_FD_WRITE = 2;
  const WASI_CLOCK_MONOTONIC = 1;
  const WASI_STDIN_FILENO = 0;
  const WASI_STDOUT_FILENO = 1;
  const SUBSCRIPTION_SIZE = 48;
  const EVENT_SIZE = 32;
  const subscriptionPtr = 1024;
  const eventPtr = 2048;
  const neventsPtr = 4096;
  const untouched = new Uint8Array(EVENT_SIZE).fill(0xaa);

  const clock = (userdata, timeout, clockid = WASI_CLOCK_MONOTONIC) => ({
    userdata,
    type: WASI_EVENTTYPE_CLOCK,
    clockid,
    timeout,
  });
  const fdRead = (userdata, fd) => ({ userdata, type: WASI_EVENTTYPE_FD_READ, fd });
  const fdWrite = (userdata, fd) => ({ userdata, type: WASI_EVENTTYPE_FD_WRITE, fd });

  // One poll_oneoff call on a new WASI. The injected sleep() records the requested wait and returns at once, so a long
  // timeout costs nothing.
  function poll(subscriptions) {
    const sleeps = [];
    const wasi = new WASI({ sleep: ms => sleeps.push(ms) });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    const view = new DataView(wasi.memory.buffer);
    const bytes = new Uint8Array(wasi.memory.buffer);

    subscriptions.forEach((subscription, i) => {
      // subscription: userdata u64 @0, type u8 @8, then clock { id u32 @16, timeout u64 (ns) @24, precision u64 @32,
      // flags u16 @40 } or fd_readwrite { fd u32 @16 }
      const at = subscriptionPtr + i * SUBSCRIPTION_SIZE;
      view.setBigUint64(at, subscription.userdata, true);
      view.setUint8(at + 8, subscription.type);
      if (subscription.type === WASI_EVENTTYPE_CLOCK) {
        view.setUint32(at + 16, subscription.clockid, true);
        view.setBigUint64(at + 24, subscription.timeout, true);
      } else {
        view.setUint32(at + 16, subscription.fd, true);
      }
    });
    // 0xaa shows each byte that poll_oneoff does not write: the nevents slot, and one spare record after the records
    // of all the subscriptions.
    bytes.fill(0xaa, neventsPtr, neventsPtr + 4);
    bytes.fill(0xaa, eventPtr, eventPtr + (subscriptions.length + 1) * EVENT_SIZE);

    const errno = wasi.wasiImport.poll_oneoff(subscriptionPtr, eventPtr, subscriptions.length, neventsPtr);
    const nevents = view.getUint32(neventsPtr, true);
    // event: userdata u64 @0, error u16 @8, type u8 @10, fd_readwrite { nbytes u64 @16, flags u16 @24 }
    const events = Array.from({ length: Math.min(nevents, subscriptions.length) }, (_, i) => {
      const at = eventPtr + i * EVENT_SIZE;
      return {
        userdata: view.getBigUint64(at, true),
        error: view.getUint16(at + 8, true),
        type: view.getUint8(at + 10),
        nbytes: view.getBigUint64(at + 16, true),
        flags: view.getUint16(at + 24, true),
      };
    });
    const spare = eventPtr + subscriptions.length * EVENT_SIZE;
    return { errno, sleeps, nevents, events, spare: bytes.slice(spare, spare + EVENT_SIZE) };
  }

  it("waits for the earliest clock and reports only that clock", () => {
    // The shortest timeout is neither the first nor the last subscription.
    const { errno, sleeps, events } = poll([
      clock(0x1111n, 60_000_000_000n),
      clock(0x2222n, 30_000_000_000n),
      clock(0x3333n, 90_000_000_000n),
    ]);
    expect(errno).toBe(WASI_ESUCCESS);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(29_000);
    expect(sleeps[0]).toBeLessThanOrEqual(30_000);
    expect(events).toEqual([
      { userdata: 0x2222n, error: WASI_ESUCCESS, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
    ]);
  });

  it("reports the first of two clocks with the same timeout", () => {
    const { errno, events } = poll([clock(0x1111n, 30_000_000_000n), clock(0x2222n, 30_000_000_000n)]);
    expect(errno).toBe(WASI_ESUCCESS);
    expect(events).toEqual([
      { userdata: 0x1111n, error: WASI_ESUCCESS, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
    ]);
  });

  it("writes one 32-byte event record per reported subscription", () => {
    // A guest reads events[i] from out + 32 * i. fd polling is not implemented, so each fd subscription reports ENOSYS,
    // and a clock id that does not exist reports EINVAL. Node polls the fds and ignores the clock id.
    const { errno, events, spare } = poll([
      fdRead(1n, WASI_STDIN_FILENO),
      clock(2n, 0n),
      fdWrite(3n, WASI_STDOUT_FILENO),
      clock(4n, 0n, 1234),
    ]);
    expect(errno).toBe(WASI_ESUCCESS);
    expect(events).toEqual([
      { userdata: 1n, error: WASI_ENOSYS, type: WASI_EVENTTYPE_FD_READ, nbytes: 0n, flags: 0 },
      { userdata: 2n, error: WASI_ESUCCESS, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
      { userdata: 3n, error: WASI_ENOSYS, type: WASI_EVENTTYPE_FD_WRITE, nbytes: 0n, flags: 0 },
      { userdata: 4n, error: WASI_EINVAL, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
    ]);
    expect(spare).toEqual(untouched);
  });

  it("reports an fd subscription next to the clock that fired", () => {
    const { errno, sleeps, events } = poll([
      clock(0x1111n, 60_000_000_000n),
      fdWrite(0x2222n, WASI_STDOUT_FILENO),
      clock(0x3333n, 30_000_000_000n),
    ]);
    expect(errno).toBe(WASI_ESUCCESS);
    // The ENOSYS event of the fd subscription does not end the wait. Node returns at once with the ready fd only.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(29_000);
    expect(sleeps[0]).toBeLessThanOrEqual(30_000);
    expect(events).toEqual([
      { userdata: 0x2222n, error: WASI_ENOSYS, type: WASI_EVENTTYPE_FD_WRITE, nbytes: 0n, flags: 0 },
      { userdata: 0x3333n, error: WASI_ESUCCESS, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
    ]);
  });

  it("returns EINVAL for zero subscriptions and writes nothing", () => {
    const { errno, sleeps, nevents, spare } = poll([]);
    expect({ errno, sleeps, nevents }).toEqual({ errno: WASI_EINVAL, sleeps: [], nevents: 0xaaaaaaaa });
    expect(spare).toEqual(untouched);
  });
});

it("fd_pread counts each byte once and reads the next iov from where the last one ended", () => {
  using dir = tempDir("wasi-fd-pread", { "data.txt": "0123456789abcdef" });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const iovsPtr = 2048;
  const nreadPtr = 3072;
  const firstBuf = 4096;
  const secondBuf = 4104;

  const len = memory.write("data.txt", pathPtr);
  expect(
    wasi.wasiImport.path_open(
      preopenFd,
      0,
      pathPtr,
      len,
      0,
      WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK,
      BigInt(0),
      0,
      fdPtr,
    ),
  ).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);

  // two iovs of 4 bytes: { buf: u32, buf_len: u32 }
  view.setUint32(iovsPtr, firstBuf, true);
  view.setUint32(iovsPtr + 4, 4, true);
  view.setUint32(iovsPtr + 8, secondBuf, true);
  view.setUint32(iovsPtr + 12, 4, true);

  expect(wasi.wasiImport.fd_pread(fd, iovsPtr, 2, BigInt(2), nreadPtr)).toBe(WASI_ESUCCESS);
  expect({
    nread: view.getUint32(nreadPtr, true),
    first: memory.toString("latin1", firstBuf, firstBuf + 4),
    second: memory.toString("latin1", secondBuf, secondBuf + 4),
  }).toEqual({ nread: 8, first: "2345", second: "6789" });
});

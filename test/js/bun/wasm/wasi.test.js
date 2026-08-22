import { spawnSync } from "bun";
import { expect, it } from "bun:test";
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

it("poll_oneoff writes one 32-byte preview1 event record per subscription", () => {
  // A preview1 `event` is 32 bytes (userdata u64 @0, error u16 @8, type u8 @10,
  // fd_readwrite { nbytes u64 @16, flags u16 @24 }) and guests read events[i] from
  // out + 32 * i. The records used to be packed 16 bytes apart, so as soon as there
  // was more than one subscription (wasi-libc's poll() adds a clock subscription
  // for its timeout) events[1] landed inside events[0].fd_readwrite and the memory
  // of events[1] itself was never written.
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
  const sin = 512;
  const sout = 1024;
  const neventsPtr = 128;

  // poll_oneoff pauses through `sleep` when asked about stdin; a no-op keeps the test fast.
  const wasi = new WASI({ version: "preview1", sleep() {} });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const view = new DataView(wasi.memory.buffer);
  const bytes = new Uint8Array(wasi.memory.buffer);

  const subscriptions = [
    { userdata: 1n, type: WASI_EVENTTYPE_FD_READ, fd: WASI_STDIN_FILENO },
    { userdata: 2n, type: WASI_EVENTTYPE_CLOCK, clockid: WASI_CLOCK_MONOTONIC },
    { userdata: 3n, type: WASI_EVENTTYPE_FD_WRITE, fd: WASI_STDOUT_FILENO },
    { userdata: 4n, type: WASI_EVENTTYPE_CLOCK, clockid: 1234 },
  ];
  subscriptions.forEach((subscription, i) => {
    const at = sin + i * SUBSCRIPTION_SIZE;
    view.setBigUint64(at, subscription.userdata, true);
    view.setUint8(at + 8, subscription.type);
    if (subscription.type === WASI_EVENTTYPE_CLOCK) {
      view.setUint32(at + 16, subscription.clockid, true);
      view.setBigUint64(at + 24, 0n, true); // relative timeout of 0ns, so nothing waits
    } else {
      view.setUint32(at + 16, subscription.fd, true);
    }
  });

  // Fill the event buffer plus one spare record, so that both a field poll_oneoff
  // fails to write and a write past the last event show up.
  bytes.fill(0xaa, sout, sout + (subscriptions.length + 1) * EVENT_SIZE);

  expect(wasi.wasiImport.poll_oneoff(sin, sout, subscriptions.length, neventsPtr)).toBe(WASI_ESUCCESS);
  expect(view.getUint32(neventsPtr, true)).toBe(subscriptions.length);

  const events = subscriptions.map((_, i) => {
    const at = sout + i * EVENT_SIZE;
    return {
      userdata: view.getBigUint64(at, true),
      error: view.getUint16(at + 8, true),
      type: view.getUint8(at + 10),
      nbytes: view.getBigUint64(at + 16, true),
      flags: view.getUint16(at + 24, true),
    };
  });
  expect(events).toEqual([
    { userdata: 1n, error: WASI_ENOSYS, type: WASI_EVENTTYPE_FD_READ, nbytes: 0n, flags: 0 },
    { userdata: 2n, error: WASI_ESUCCESS, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
    { userdata: 3n, error: WASI_ENOSYS, type: WASI_EVENTTYPE_FD_WRITE, nbytes: 0n, flags: 0 },
    { userdata: 4n, error: WASI_EINVAL, type: WASI_EVENTTYPE_CLOCK, nbytes: 0n, flags: 0 },
  ]);
  const spare = sout + subscriptions.length * EVENT_SIZE;
  expect(bytes.subarray(spare, spare + EVENT_SIZE)).toEqual(new Uint8Array(EVENT_SIZE).fill(0xaa));
});

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

it("path_* hostcalls answer EINVAL for an empty path and do not act on the directory of the descriptor", () => {
  using dir = tempDir("wasi-empty-path", { "preopen/file.txt": "x" });
  const preopen = path.join(String(dir), "preopen");
  const sub = path.join(preopen, "sub");
  const emptyPreopen = path.join(String(dir), "empty");
  fs.mkdirSync(sub);
  fs.mkdirSync(emptyPreopen);
  const wasi = new WASI({ version: "preview1", preopens: { "/": preopen, "/empty": emptyPreopen } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  const WASI_FILESTAT_SET_ATIM = 1 << 0;
  const WASI_FILESTAT_SET_MTIM = 1 << 2;
  const WASI_O_DIRECTORY = 1 << 1;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_READDIR = BigInt(16384);
  const WASI_RIGHT_PATH_FILESTAT_GET = BigInt(262144);
  const WASI_RIGHT_PATH_REMOVE_DIRECTORY = BigInt(33554432);
  const preopenFd = 3;
  const emptyPreopenFd = 4;
  const emptyPtr = 1024;
  const filePtr = 1536;
  const otherPtr = 2048;
  const subPtr = 2560;
  const outPtr = 8192;
  const statPtr = 16384;
  const sentinel = 0x12345678;
  const fileLen = memory.write("file.txt", filePtr);
  const otherLen = memory.write("other", otherPtr);
  const subLen = memory.write("sub", subPtr);
  const w = wasi.wasiImport;

  expect(
    w.path_open(
      preopenFd,
      0,
      subPtr,
      subLen,
      WASI_O_DIRECTORY,
      WASI_RIGHT_FD_READDIR | WASI_RIGHT_PATH_FILESTAT_GET | WASI_RIGHT_PATH_REMOVE_DIRECTORY,
      BigInt(0),
      0,
      outPtr,
    ),
  ).toBe(WASI_ESUCCESS);
  const subFd = view.getUint32(outPtr, true);

  view.setUint32(outPtr, sentinel, true);
  const mtimeBefore = fs.statSync(preopen).mtimeMs;
  const fdsBefore = wasi.FD_MAP.size;

  expect({
    path_create_directory: w.path_create_directory(preopenFd, emptyPtr, 0),
    path_filestat_get: w.path_filestat_get(preopenFd, 0, emptyPtr, 0, outPtr),
    path_filestat_get_subdirectory: w.path_filestat_get(subFd, 0, emptyPtr, 0, outPtr),
    path_filestat_set_times: w.path_filestat_set_times(
      preopenFd,
      0,
      emptyPtr,
      0,
      BigInt(0),
      BigInt(0),
      WASI_FILESTAT_SET_ATIM | WASI_FILESTAT_SET_MTIM,
    ),
    path_link_old: w.path_link(preopenFd, 0, emptyPtr, 0, preopenFd, otherPtr, otherLen),
    path_link_new: w.path_link(preopenFd, 0, filePtr, fileLen, preopenFd, emptyPtr, 0),
    path_open: w.path_open(preopenFd, 0, emptyPtr, 0, 0, WASI_RIGHT_FD_READ, BigInt(0), 0, outPtr),
    path_readlink: w.path_readlink(preopenFd, emptyPtr, 0, outPtr + 64, 64, outPtr),
    path_remove_directory: w.path_remove_directory(emptyPreopenFd, emptyPtr, 0),
    path_remove_directory_subdirectory: w.path_remove_directory(subFd, emptyPtr, 0),
    path_rename_old: w.path_rename(preopenFd, emptyPtr, 0, preopenFd, otherPtr, otherLen),
    path_rename_new: w.path_rename(preopenFd, filePtr, fileLen, preopenFd, emptyPtr, 0),
    path_symlink_target: w.path_symlink(emptyPtr, 0, preopenFd, otherPtr, otherLen),
    path_symlink_new: w.path_symlink(filePtr, fileLen, preopenFd, emptyPtr, 0),
    path_unlink_file: w.path_unlink_file(preopenFd, emptyPtr, 0),
  }).toEqual({
    path_create_directory: WASI_EINVAL,
    path_filestat_get: WASI_EINVAL,
    path_filestat_get_subdirectory: WASI_EINVAL,
    path_filestat_set_times: WASI_EINVAL,
    path_link_old: WASI_EINVAL,
    path_link_new: WASI_EINVAL,
    path_open: WASI_EINVAL,
    path_readlink: WASI_EINVAL,
    path_remove_directory: WASI_EINVAL,
    path_remove_directory_subdirectory: WASI_EINVAL,
    path_rename_old: WASI_EINVAL,
    path_rename_new: WASI_EINVAL,
    path_symlink_target: WASI_EINVAL,
    path_symlink_new: WASI_EINVAL,
    path_unlink_file: WASI_EINVAL,
  });

  expect({
    out: view.getUint32(outPtr, true),
    fds: wasi.FD_MAP.size,
    emptyPreopenExists: fs.existsSync(emptyPreopen),
    preopenMtime: fs.statSync(preopen).mtimeMs,
    preopenEntries: fs.readdirSync(preopen).sort(),
  }).toEqual({
    out: sentinel,
    fds: fdsBefore,
    emptyPreopenExists: true,
    preopenMtime: mtimeBefore,
    preopenEntries: ["file.txt", "sub"],
  });

  // A path that names the directory itself is not empty. "/" is one: RESOLVE_PATH puts an absolute path under the directory.
  const statOf = guestPath => w.path_filestat_get(preopenFd, 0, otherPtr, memory.write(guestPath, otherPtr), statPtr);
  expect({
    ".": statOf("."),
    "./": statOf("./"),
    "/": statOf("/"),
    "sub/": statOf("sub/"),
    "sub/..": statOf("sub/.."),
  }).toEqual({
    ".": WASI_ESUCCESS,
    "./": WASI_ESUCCESS,
    "/": WASI_ESUCCESS,
    "sub/": WASI_ESUCCESS,
    "sub/..": WASI_ESUCCESS,
  });

  if (!isWindows) {
    // A link target of one byte is not empty.
    const targetLen = memory.write("f", filePtr);
    const linkLen = memory.write("lnk", otherPtr);
    expect(w.path_symlink(filePtr, targetLen, preopenFd, otherPtr, linkLen)).toBe(WASI_ESUCCESS);
    expect(fs.readlinkSync(path.join(preopen, "lnk"))).toBe("f");
  }
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

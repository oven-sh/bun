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

it("clock_res_get stores a little-endian resolution, also as the first hostcall and after memory.grow()", () => {
  const wasi = new WASI({ version: "preview1" });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));

  const WASI_ESUCCESS = 0;
  const WASI_CLOCK_REALTIME = 0;
  const WASI_CLOCK_MONOTONIC = 1;
  const WASI_CLOCK_PROCESS_CPUTIME_ID = 2;
  const WASI_CLOCK_THREAD_CPUTIME_ID = 3;
  const resolutionPtr = 64;
  const sentinel = BigInt("0x1122334455667788");
  const clockResGet = (clockId, ptr) => {
    // A new view for each access: grow() detaches the buffer of an earlier one.
    new DataView(wasi.memory.buffer).setBigUint64(ptr, sentinel, true);
    const errno = wasi.wasiImport.clock_res_get(clockId, ptr);
    return { errno, stored: new DataView(wasi.memory.buffer).getBigUint64(ptr, true) };
  };
  const oneNanosecond = { errno: WASI_ESUCCESS, stored: BigInt(1) };

  // The monotonic call is the first hostcall of this instance: no other one has made the view of the memory yet.
  // Node stores 1 for the realtime and the monotonic clock. For the two CPU-time clocks it stores what the platform reports.
  expect({
    monotonic: clockResGet(WASI_CLOCK_MONOTONIC, resolutionPtr),
    realtime: clockResGet(WASI_CLOCK_REALTIME, resolutionPtr),
    processCpuTime: clockResGet(WASI_CLOCK_PROCESS_CPUTIME_ID, resolutionPtr),
    threadCpuTime: clockResGet(WASI_CLOCK_THREAD_CPUTIME_ID, resolutionPtr),
  }).toEqual({
    monotonic: oneNanosecond,
    realtime: oneNanosecond,
    processCpuTime: oneNanosecond,
    threadCpuTime: oneNanosecond,
  });

  wasi.memory.grow(1);
  expect(clockResGet(WASI_CLOCK_MONOTONIC, 65536 + resolutionPtr)).toEqual(oneNanosecond);
});

it("clock_res_get answers EINVAL for an unknown clock id and stores nothing", () => {
  const wasi = new WASI({ version: "preview1" });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const view = new DataView(wasi.memory.buffer);

  const WASI_EINVAL = 28;
  const resolutionPtr = 64;
  const sentinel = BigInt("0x1122334455667788");
  view.setBigUint64(resolutionPtr, sentinel, true);

  expect([4, 99, 255, -1].map(clockId => [clockId, wasi.wasiImport.clock_res_get(clockId, resolutionPtr)])).toEqual([
    [4, WASI_EINVAL],
    [99, WASI_EINVAL],
    [255, WASI_EINVAL],
    [-1, WASI_EINVAL],
  ]);
  expect(view.getBigUint64(resolutionPtr, true)).toBe(sentinel);
});

it("a guest that calls clock_res_get first gets an errno for each call, and start() returns", () => {
  // (import "wasi_snapshot_preview1" "clock_res_get" (func $clock_res_get (param i32 i32) (result i32)))
  // (memory (export "memory") 1)
  // (func (export "_start")
  //   (i32.store (i32.const 128) (call $clock_res_get (i32.const 1) (i32.const 64)))
  //   (i32.store (i32.const 132) (call $clock_res_get (i32.const 99) (i32.const 72))))
  const section = (id, ...body) => [id, body.length, ...body];
  const name = string => [string.length, ...Buffer.from(string)];
  // The operands of i32.const are signed LEB128.
  const start = [
    [0], // no locals
    [0x41, 0x80, 1], // i32.const 128
    [0x41, 1], // i32.const 1
    [0x41, 0xc0, 0], // i32.const 64
    [0x10, 0], // call $clock_res_get
    [0x36, 2, 0], // i32.store
    [0x41, 0x84, 1], // i32.const 132
    [0x41, 0xe3, 0], // i32.const 99
    [0x41, 0xc8, 0], // i32.const 72
    [0x10, 0], // call $clock_res_get
    [0x36, 2, 0], // i32.store
    [0x0b], // end
  ].flat();
  const guest = new Uint8Array(
    [
      [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
      section(1, 2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 0, 0),
      section(2, 1, ...name("wasi_snapshot_preview1"), ...name("clock_res_get"), 0, 0),
      section(3, 1, 1),
      section(5, 1, 0, 1),
      section(7, 2, ...name("memory"), 2, 0, ...name("_start"), 0, 1),
      section(10, 1, start.length, ...start),
    ].flat(),
  );

  const wasi = new WASI({ version: "preview1" });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(guest), {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.start(instance);

  const view = new DataView(instance.exports.memory.buffer);
  expect({
    monotonic: { errno: view.getUint32(128, true), stored: view.getBigUint64(64, true) },
    unknown: { errno: view.getUint32(132, true), stored: view.getBigUint64(72, true) },
  }).toEqual({
    monotonic: { errno: 0, stored: BigInt(1) },
    unknown: { errno: 28, stored: BigInt(0) },
  });
});

it("fd_seek answers EINVAL for an unknown whence and for a position before the start of the file", () => {
  using dir = tempDir("wasi-fd-seek-whence", { "data.txt": "0123456789" });
  const wasi = new WASI({ version: "preview1", preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  const WASI_WHENCE_SET = 0;
  const WASI_WHENCE_CUR = 1;
  const WASI_WHENCE_END = 2;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const WASI_RIGHT_FD_TELL = BigInt(32);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const offsetPtr = 2048;
  const sentinel = BigInt("0x1122334455667788");

  const len = memory.write("data.txt", pathPtr);
  expect(
    wasi.wasiImport.path_open(
      preopenFd,
      0,
      pathPtr,
      len,
      0,
      WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK | WASI_RIGHT_FD_TELL,
      BigInt(0),
      0,
      fdPtr,
    ),
  ).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);

  const seek = (offset, whence) => {
    view.setBigUint64(offsetPtr, sentinel, true);
    const errno = wasi.wasiImport.fd_seek(fd, BigInt(offset), whence, offsetPtr);
    return { errno, stored: view.getBigUint64(offsetPtr, true) };
  };
  const tell = () => {
    view.setBigUint64(offsetPtr, sentinel, true);
    const errno = wasi.wasiImport.fd_tell(fd, offsetPtr);
    return { errno, stored: view.getBigUint64(offsetPtr, true) };
  };
  const refused = { errno: WASI_EINVAL, stored: sentinel };
  // Node narrows whence to a u8, so it seeks for 256, 257 and 258. lseek(2) refuses them, and so does Bun.
  const unknownWhences = [3, 9, 255, 256, 257, 258, -1];

  // The descriptor has no offset yet.
  expect(unknownWhences.map(whence => [whence, seek(0, whence)])).toEqual(
    unknownWhences.map(whence => [whence, refused]),
  );
  expect(tell()).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(0) });

  // The descriptor has one.
  expect(seek(3, WASI_WHENCE_SET)).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(3) });
  expect(unknownWhences.map(whence => [whence, seek(1, whence)])).toEqual(
    unknownWhences.map(whence => [whence, refused]),
  );
  expect(tell()).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(3) });

  expect(seek(2, WASI_WHENCE_CUR)).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(5) });
  expect(seek(-4, WASI_WHENCE_END)).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(6) });

  // A position before the start of the 10-byte file.
  expect(seek(-1, WASI_WHENCE_SET)).toEqual(refused);
  expect(seek(-11, WASI_WHENCE_END)).toEqual(refused);
  expect(tell()).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(6) });
  expect(seek(-10, WASI_WHENCE_END)).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(0) });
  expect(seek(0, WASI_WHENCE_SET)).toEqual({ errno: WASI_ESUCCESS, stored: BigInt(0) });
});

it("fd_readdir reads the cookie as a u64 and returns no entry for a cookie past the end", () => {
  using dir = tempDir("wasi-fd-readdir-cookie", { "a.txt": "a", "b.txt": "b" });
  const wasi = new WASI({ version: "preview1", preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const preopenFd = 3;
  const bufusedPtr = 1024;
  const bufPtr = 4096;
  const bufLen = 256;
  const sentinel = 0x12345678;
  // One entry is a 24-byte header and its name, "a.txt" or "b.txt".
  const direntSize = 24 + 5;

  const readdir = cookie => {
    view.setUint32(bufusedPtr, sentinel, true);
    const errno = wasi.wasiImport.fd_readdir(preopenFd, bufPtr, bufLen, cookie, bufusedPtr);
    return { errno, bufused: view.getUint32(bufusedPtr, true) };
  };
  const noEntry = { errno: WASI_ESUCCESS, bufused: 0 };

  expect(readdir(BigInt(0))).toEqual({ errno: WASI_ESUCCESS, bufused: 2 * direntSize });
  expect(readdir(BigInt(1))).toEqual({ errno: WASI_ESUCCESS, bufused: direntSize });
  expect(readdir(BigInt(2))).toEqual(noEntry);
  // wasm hands a u64 over as an i64: a cookie of 2^63 or more reaches the hostcall as a negative BigInt.
  expect({
    "2^64 - 1": readdir(BigInt(-1)),
    "2^63": readdir(-(BigInt(2) ** BigInt(63))),
    "2^63 - 1": readdir(BigInt(2) ** BigInt(63) - BigInt(1)),
  }).toEqual({
    "2^64 - 1": noEntry,
    "2^63": noEntry,
    "2^63 - 1": noEntry,
  });
});

it("fd_pread, fd_pwrite and fd_filestat_set_size answer EINVAL for an offset or a size of 2^63 or more", () => {
  using dir = tempDir("wasi-u64-offset", { "data.txt": "0123456789" });
  const file = path.join(String(dir), "data.txt");
  const wasi = new WASI({ version: "preview1", preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const WASI_RIGHT_FD_WRITE = BigInt(64);
  const WASI_RIGHT_FD_FILESTAT_SET_SIZE = BigInt(4194304);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const iovsPtr = 2048;
  const countPtr = 3072;
  const bufPtr = 4096;
  const sentinel = 0x12345678;
  const w = wasi.wasiImport;

  const len = memory.write("data.txt", pathPtr);
  expect(
    w.path_open(
      preopenFd,
      0,
      pathPtr,
      len,
      0,
      WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK | WASI_RIGHT_FD_WRITE | WASI_RIGHT_FD_FILESTAT_SET_SIZE,
      BigInt(0),
      0,
      fdPtr,
    ),
  ).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);

  // one iov of 4 bytes: { buf: u32, buf_len: u32 }
  view.setUint32(iovsPtr, bufPtr, true);
  view.setUint32(iovsPtr + 4, 4, true);
  const positional = (hostcall, onFd, offset) => {
    memory.write("WXYZ", bufPtr);
    view.setUint32(countPtr, sentinel, true);
    const errno = hostcall(onFd, iovsPtr, 1, offset, countPtr);
    return { errno, count: view.getUint32(countPtr, true), buf: memory.toString("latin1", bufPtr, bufPtr + 4) };
  };
  const refused = { errno: WASI_EINVAL, count: sentinel, buf: "WXYZ" };

  // wasm hands a u64 over as an i64: 2^64 - 1 and 2^63 reach the hostcall as these negative BigInts.
  for (const atOrAbove2Pow63 of [BigInt(-1), -(BigInt(2) ** BigInt(63))]) {
    expect({
      fd_pread: positional(w.fd_pread, fd, atOrAbove2Pow63),
      fd_pwrite: positional(w.fd_pwrite, fd, atOrAbove2Pow63),
      fd_filestat_set_size: w.fd_filestat_set_size(fd, atOrAbove2Pow63),
      file: fs.readFileSync(file, "latin1"),
    }).toEqual({
      fd_pread: refused,
      fd_pwrite: refused,
      fd_filestat_set_size: WASI_EINVAL,
      file: "0123456789",
    });
  }
  // Like uvwasi, fd_pread and fd_pwrite judge the offset before the descriptor.
  expect({
    fd_pread: positional(w.fd_pread, 99, BigInt(-1)),
    fd_pwrite: positional(w.fd_pwrite, 99, BigInt(-1)),
  }).toEqual({ fd_pread: refused, fd_pwrite: refused });

  expect({
    fd_pwrite: positional(w.fd_pwrite, fd, BigInt(2)),
    file: fs.readFileSync(file, "latin1"),
  }).toEqual({
    fd_pwrite: { errno: WASI_ESUCCESS, count: 4, buf: "WXYZ" },
    file: "01WXYZ6789",
  });
  expect(positional(w.fd_pread, fd, BigInt(6))).toEqual({ errno: WASI_ESUCCESS, count: 4, buf: "6789" });
  expect({
    fd_filestat_set_size: w.fd_filestat_set_size(fd, BigInt(4)),
    file: fs.readFileSync(file, "latin1"),
  }).toEqual({ fd_filestat_set_size: WASI_ESUCCESS, file: "01WX" });

  // 0 is an offset and a size that every file has.
  expect(positional(w.fd_pread, fd, BigInt(0))).toEqual({ errno: WASI_ESUCCESS, count: 4, buf: "01WX" });
  expect({
    fd_pwrite: positional(w.fd_pwrite, fd, BigInt(0)),
    file: fs.readFileSync(file, "latin1"),
  }).toEqual({
    fd_pwrite: { errno: WASI_ESUCCESS, count: 4, buf: "WXYZ" },
    file: "WXYZ",
  });
  expect({
    fd_filestat_set_size: w.fd_filestat_set_size(fd, BigInt(0)),
    file: fs.readFileSync(file, "latin1"),
  }).toEqual({ fd_filestat_set_size: WASI_ESUCCESS, file: "" });
});

it("fd_filestat_set_times and path_filestat_set_times answer EINVAL for an unknown flag and leave the times alone", () => {
  using dir = tempDir("wasi-fstflags", { "data.txt": "0123456789" });
  const file = path.join(String(dir), "data.txt");
  const wasi = new WASI({ version: "preview1", preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  const WASI_FILESTAT_SET_ATIM = 1 << 0;
  const WASI_FILESTAT_SET_ATIM_NOW = 1 << 1;
  const WASI_FILESTAT_SET_MTIM = 1 << 2;
  const WASI_FILESTAT_SET_MTIM_NOW = 1 << 3;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_WRITE = BigInt(64);
  const WASI_RIGHT_FD_FILESTAT_SET_TIMES = BigInt(8388608);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const year2001 = 978307200;
  const year2002 = BigInt(1009843200) * BigInt(1e9);
  const w = wasi.wasiImport;

  const len = memory.write("data.txt", pathPtr);
  expect(
    w.path_open(
      preopenFd,
      0,
      pathPtr,
      len,
      0,
      WASI_RIGHT_FD_READ | WASI_RIGHT_FD_WRITE | WASI_RIGHT_FD_FILESTAT_SET_TIMES,
      BigInt(0),
      0,
      fdPtr,
    ),
  ).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);

  const rows = setTimes => {
    const withFlags = fstflags => {
      fs.utimesSync(file, year2001, year2001);
      const errno = setTimes(fstflags);
      return { errno, mtime: fs.statSync(file).mtimeMs / 1000 };
    };
    return {
      16: withFlags(16),
      32: withFlags(32),
      256: withFlags(256),
      65536: withFlags(65536),
      "ATIM | 16": withFlags(WASI_FILESTAT_SET_ATIM | 16),
      "ATIM | MTIM": withFlags(WASI_FILESTAT_SET_ATIM | WASI_FILESTAT_SET_MTIM),
      "ATIM_NOW | MTIM_NOW": withFlags(WASI_FILESTAT_SET_ATIM_NOW | WASI_FILESTAT_SET_MTIM_NOW).errno,
      "no flag": withFlags(0),
    };
  };
  const refused = { errno: WASI_EINVAL, mtime: year2001 };
  // Bits 4, 5 and 8 are no flag. Node answers EINVAL for them. It narrows the flags to a u16 first, so 65536 is no flag at all there.
  const expected = noFlag => ({
    16: refused,
    32: refused,
    256: refused,
    65536: refused,
    "ATIM | 16": refused,
    "ATIM | MTIM": { errno: WASI_ESUCCESS, mtime: 1009843200 },
    "ATIM_NOW | MTIM_NOW": WASI_ESUCCESS,
    "no flag": noFlag,
  });

  expect(rows(fstflags => w.fd_filestat_set_times(fd, year2002, year2002, fstflags))).toEqual(
    expected({ errno: WASI_ESUCCESS, mtime: year2001 }),
  );
  // path_filestat_set_times takes a time that it does not set from the directory of the descriptor, not from the file.
  expect(rows(fstflags => w.path_filestat_set_times(preopenFd, 0, pathPtr, len, year2002, year2002, fstflags))).toEqual(
    expected({ errno: WASI_ESUCCESS, mtime: expect.any(Number) }),
  );
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

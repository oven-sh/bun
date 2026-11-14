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

const uleb = n => {
  const bytes = [];
  do {
    bytes.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
    n >>>= 7;
  } while (n);
  return bytes;
};
const sleb = n => {
  const bytes = [];
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(byte & 0x40)) || (n === -1 && byte & 0x40)) return [...bytes, byte];
    bytes.push(byte | 0x80);
  }
};
const wasmName = string => [...uleb(string.length), ...Buffer.from(string)];
const wasmVec = items => [...uleb(items.length), ...items.flat()];
const wasmSection = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
const i32Const = n => [0x41, ...sleb(n)];
const wasmCall = index => [0x10, ...uleb(index)];
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0];

// A wasm guest that imports `imports` from WASI ({ name: parameters }, "i" for an i32 and "I" for an i64, each
// returning an i32) and exports, under the same names, functions that pass their arguments straight to the
// import. Calling through those hands the host what a compiled guest does: an i32 arrives as a signed number.
// `start` is the body of _start and `data` is copied to address 0 of its one page of memory.
function wasiGuest(imports, start = [], data = []) {
  const names = Object.keys(imports);
  const types = names.map(name => [0x60, ...wasmVec([...imports[name]].map(c => [c === "I" ? 0x7e : 0x7f])), 1, 0x7f]);
  const trampolines = names.map((name, index) => {
    const body = [0, ...[...imports[name]].flatMap((_, local) => [0x20, local]), ...wasmCall(index), 0x0b];
    return [...uleb(body.length), ...body];
  });
  const startBody = [0, ...start, 0x0b];
  return new Uint8Array([
    ...WASM_HEADER,
    ...wasmSection(1, wasmVec([...types, [0x60, 0, 0]])),
    ...wasmSection(
      2,
      wasmVec(names.map((name, i) => [...wasmName("wasi_snapshot_preview1"), ...wasmName(name), 0, i])),
    ),
    ...wasmSection(3, wasmVec([...names.map((_, i) => [i]), [names.length]])),
    ...wasmSection(5, [1, 0, 1]),
    ...wasmSection(
      7,
      wasmVec([
        ...names.map((name, i) => [...wasmName(name), 0, names.length + i]),
        [...wasmName("_start"), 0, names.length * 2],
        [...wasmName("memory"), 2, 0],
      ]),
    ),
    ...wasmSection(10, wasmVec([...trampolines, [...uleb(startBody.length), ...startBody]])),
    ...wasmSection(11, wasmVec([[0, ...i32Const(0), 0x0b, ...uleb(data.length), ...data]])),
  ]);
}

const WASI_EINVAL = 28;
const WASI_ENOSYS = 52;
const WASI_EOVERFLOW = 61;
const END = 65536; // one page of guest memory
const STDIN = 0;
const STDOUT = 1;
const DIR = 3; // the preopened directory
const FILE = 4; // file.txt, opened by the guest
// Where the valid calls below point: path strings, one iovec and the 4 bytes it names, one clock subscription,
// and scratch space for what the host writes.
const STRINGS = ["file.txt", "link", "mkdir", "rmdir", "unlink.txt", "rename.txt", "renamed", "linked", "symlinked"];
const str = string => [1024 + 32 * STRINGS.indexOf(string), string.length];
const IOVEC = 2048;
const DATA = 2080;
const SUBSCRIPTION = 2112;
const OUT = 4096;
const OUT2 = 4160;
const BUF = 8192;
const ZERO = BigInt(0);
// One valid call of each hostcall that is handed guest memory, then what its arguments name:
// [pointer argument, bytes per element] or [pointer argument, bytes per element, count argument].
// prettier-ignore
const GUEST_MEMORY = {
  args_get: [[OUT, BUF], [0, 2 * 4], [1, "argv0\0b\0".length]],
  args_sizes_get: [[OUT, OUT2], [0, 4], [1, 4]],
  clock_res_get: [[1, OUT], [1, 8]],
  clock_time_get: [[1, ZERO, OUT], [2, 8]],
  environ_get: [[OUT, BUF], [0, 1 * 4], [1, "K=v\0".length]],
  environ_sizes_get: [[OUT, OUT2], [0, 4], [1, 4]],
  fd_fdstat_get: [[FILE, OUT], [1, 24]],
  fd_filestat_get: [[FILE, OUT], [1, 64]],
  fd_pread: [[FILE, IOVEC, 1, ZERO, OUT], [1, 8, 2], [4, 4]],
  fd_prestat_dir_name: [[DIR, BUF, "/sandbox".length], [1, 1, 2]],
  fd_prestat_get: [[DIR, OUT], [1, 8]],
  fd_pwrite: [[FILE, IOVEC, 1, ZERO, OUT], [1, 8, 2], [4, 4]],
  fd_read: [[STDIN, IOVEC, 1, OUT], [1, 8, 2], [3, 4]],
  fd_readdir: [[DIR, BUF, 256, ZERO, OUT], [1, 1, 2], [4, 4]],
  fd_seek: [[FILE, BigInt(3), 0, OUT], [3, 8]],
  fd_tell: [[FILE, OUT], [1, 8]],
  fd_write: [[STDOUT, IOVEC, 1, OUT], [1, 8, 2], [3, 4]],
  path_create_directory: [[DIR, ...str("mkdir")], [1, 1, 2]],
  path_filestat_get: [[DIR, 0, ...str("file.txt"), OUT], [2, 1, 3], [4, 64]],
  path_filestat_set_times: [[DIR, 0, ...str("file.txt"), ZERO, ZERO, 0], [2, 1, 3]],
  path_link: [[DIR, 0, ...str("file.txt"), DIR, ...str("linked")], [2, 1, 3], [5, 1, 6]],
  path_open: [[DIR, 0, ...str("file.txt"), 0, BigInt(2), ZERO, 0, OUT], [2, 1, 3], [8, 4]],
  path_readlink: [[DIR, ...str("link"), BUF, 64, OUT], [1, 1, 2], [3, 1, 4], [5, 4]],
  path_remove_directory: [[DIR, ...str("rmdir")], [1, 1, 2]],
  path_rename: [[DIR, ...str("rename.txt"), DIR, ...str("renamed")], [1, 1, 2], [4, 1, 5]],
  path_symlink: [[...str("file.txt"), DIR, ...str("symlinked")], [0, 1, 1], [3, 1, 4]],
  path_unlink_file: [[DIR, ...str("unlink.txt")], [1, 1, 2]],
  poll_oneoff: [[SUBSCRIPTION, BUF, 1, OUT], [0, 48, 2], [1, 32, 2], [3, 4]],
  random_get: [[BUF, 16], [0, 1, 1]],
  sock_recv: [[FILE, IOVEC, 1, 0, OUT, OUT2], [1, 8, 2], [4, 4], [5, 4]],
  sock_send: [[FILE, IOVEC, 1, 0, OUT], [1, 8, 2], [4, 4]],
};
// prettier-ignore
const NO_GUEST_MEMORY = [
  "fd_advise", "fd_allocate", "fd_close", "fd_datasync", "fd_fdstat_set_flags", "fd_fdstat_set_rights",
  "fd_filestat_set_size", "fd_filestat_set_times", "fd_renumber", "fd_sync", "proc_exit", "proc_raise",
  "sched_yield", "sock_fcntlSetFlags", "sock_pollSocket", "sock_shutdown",
];

// Each way to move one range of a valid call: [what, arguments, bytes to move first, whether it still fits].
function* movedRanges(args, [pointer, bytes, count]) {
  const n = count === undefined ? 1 : args[count];
  const size = bytes * n;
  const at = (to, more) => Object.assign([...args], { [pointer]: to }, more);
  yield ["ends at the end of memory", at(END - size), [args[pointer], END - size, size], true];
  yield ["ends one byte past the end", at(END - size + 1), null, false];
  yield ["starts at the end", at(END), null, false];
  yield ["starts past the end", at(END + 4096), null, false];
  yield ["pointer 0x80000000", at(0x80000000), null, false];
  yield ["pointer 0xffffffff", at(0xffffffff), null, false];
  if (count !== undefined) {
    yield ["one element too many", at(END - size, { [count]: n + 1 }), null, false];
    yield ["count 0x7fffffff", at(args[pointer], { [count]: 0x7fffffff }), null, false];
    yield ["count 0xffffffff", at(args[pointer], { [count]: 0xffffffff }), null, false];
    yield ["empty, at the end", at(END, { [count]: 0 }), null, false];
    yield ["empty, on the last byte", at(END - 1, { [count]: 0 }), null, "empty"];
  }
}
// The same for the buf and len of the iovec at IOVEC: [what, buf, len, whether it still fits].
const MOVED_IOVECS = [
  ["iovec ends at the end of memory", END - 4, 4, true],
  ["iovec ends one byte past the end", END - 3, 4, false],
  ["iovec starts at the end", END, 4, false],
  ["iovec buf 0x80000000", 0x80000000, 4, false],
  ["iovec len reaches past the end", DATA, END, false],
  ["iovec len 0xffffffff", DATA, 0xffffffff, false],
  ["empty iovec at the end", END, 0, false],
  ["empty iovec on the last byte", END - 1, 0, "empty"],
];

it("a hostcall answers EOVERFLOW for guest memory that is out of bounds, before it does anything else", () => {
  using dir = tempDir("wasi-guest-memory", { "file.txt": "0123456789", "unlink.txt": "", "rename.txt": "" });
  fs.mkdirSync(path.join(String(dir), "rmdir"));
  if (!isWindows) fs.symlinkSync("file.txt", path.join(String(dir), "link"));

  // Everything a hostcall does besides answering: host fs calls and hooks, in order.
  const did = [];
  const { bindings } = new WASI({});
  const countedFs = new Proxy(bindings.fs, {
    get: (target, key) =>
      typeof target[key] !== "function" ? target[key] : (...args) => (did.push(key), target[key](...args)),
  });
  const wasi = new WASI({
    args: ["argv0", "b"],
    env: { K: "v" },
    preopens: { "/sandbox": String(dir) },
    bindings: { ...bindings, fs: countedFs },
    sendStdout: bytes => did.push(`stdout ${Buffer.from(bytes)}`),
    getStdin: () => (did.push("stdin"), Buffer.from("in")),
    sleep: () => did.push("sleep"),
  });
  expect(Object.keys(wasi.wasiImport).sort()).toEqual([...Object.keys(GUEST_MEMORY), ...NO_GUEST_MEMORY].sort());

  const signatures = {};
  for (const [hostcall, [args]] of Object.entries(GUEST_MEMORY)) {
    signatures[hostcall] = args.map(arg => (typeof arg === "bigint" ? "I" : "i")).join("");
  }
  const module = new WebAssembly.Module(wasiGuest(signatures));
  const guest = new WebAssembly.Instance(module, wasi.getImports(module)).exports;
  wasi.start({ exports: guest });
  const bytes = Buffer.from(guest.memory.buffer);
  const view = new DataView(guest.memory.buffer);
  for (const string of STRINGS) bytes.write(string, str(string)[0]);
  view.setUint32(IOVEC, DATA, true);
  view.setUint32(IOVEC + 4, 4, true);
  bytes.write("data", DATA);
  view.setUint32(SUBSCRIPTION + 16, 1, true); // a monotonic clock that has already fired
  const rights = BigInt(2 | 4 | 32 | 64 | (1 << 21)); // read, seek, tell, write, filestat_get
  expect(guest.path_open(DIR, 0, ...str("file.txt"), 0, rights, ZERO, 0, OUT)).toBe(0);
  expect(view.getUint32(OUT, true)).toBe(FILE);

  // What one call answered and did: "61", or for example "0 readdirSync lstatSync, wrote guest memory".
  const descriptors = () => JSON.stringify([...wasi.FD_MAP].map(([fd, entry]) => [fd, String(entry.offset)]));
  const observe = (hostcall, args) => {
    did.length = 0;
    const memoryBefore = Buffer.from(bytes);
    const descriptorsBefore = descriptors();
    let answer;
    try {
      answer = guest[hostcall](...args);
    } catch (e) {
      answer = `threw ${e.constructor.name}`;
    }
    return {
      answer,
      did: did.join(" "),
      wrote: !memoryBefore.equals(bytes),
      moved: descriptors() !== descriptorsBefore,
    };
  };
  const rejected = { answer: WASI_EOVERFLOW, did: "", wrote: false, moved: false };

  const unexpected = [];
  for (const [hostcall, [args, ...ranges]] of Object.entries(GUEST_MEMORY)) {
    if (isWindows && (hostcall === "path_readlink" || hostcall === "path_symlink")) continue;
    const first = observe(hostcall, args).answer;
    if (first !== (hostcall.startsWith("sock_") ? WASI_ENOSYS : 0)) unexpected.push([hostcall, "valid call", first]);
    // From the second time on, a call that creates or removes something answers that it is there or gone, so the
    // same call then answers and does the same thing every time.
    const again = observe(hostcall, args);
    const pristine = Buffer.from(bytes);
    const check = (what, probe, fits) => {
      const expected = fits === true ? { ...again, wrote: probe.wrote, moved: probe.moved } : rejected;
      const ok =
        fits === "empty"
          ? typeof probe.answer === "number" && probe.answer !== WASI_EOVERFLOW
          : Bun.deepEquals(probe, expected);
      if (!ok) unexpected.push([hostcall, what, probe]);
      pristine.copy(bytes);
    };
    for (const range of ranges) {
      for (const [what, moved, copy, fits] of movedRanges(args, range)) {
        if (copy) bytes.copyWithin(copy[1], copy[0], copy[0] + copy[2]);
        check(`argument ${range[0]} ${what}`, observe(hostcall, moved), fits);
      }
    }
    if (["fd_pread", "fd_pwrite", "fd_read", "fd_write"].includes(hostcall)) {
      for (const [what, buf, len, fits] of MOVED_IOVECS) {
        view.setUint32(IOVEC, buf, true);
        view.setUint32(IOVEC + 4, len, true);
        bytes.copyWithin(END - 4, DATA, DATA + 4);
        check(what, observe(hostcall, args), fits);
      }
    }
    // A descriptor that is not open (or a clock that does not exist) does not hide a pointer that is out of bounds.
    if (ranges[0][0] !== 0) {
      check(
        "bad first argument and bad pointer",
        observe(hostcall, Object.assign([...args], { 0: 99, [ranges[0][0]]: END })),
        false,
      );
    }
  }
  expect(unexpected).toEqual([]);
});

it("fd_write with iovecs that are out of bounds gives the guest EOVERFLOW and prints nothing on the host", async () => {
  // _start makes the three calls with one page of memory and exits with the sum of what they answered:
  // an iovec whose buf is past the end, an iovec array that is past the end, an iovec whose len reaches past the end.
  const iovecs = Buffer.alloc(16);
  iovecs.writeUInt32LE(70000, 0);
  iovecs.writeUInt32LE(10, 4);
  iovecs.writeUInt32LE(65530, 8);
  iovecs.writeUInt32LE(4096, 12);
  const fdWrite = (iovs, iovsLen) => [
    ...i32Const(2),
    ...i32Const(iovs),
    ...i32Const(iovsLen),
    ...i32Const(128),
    ...wasmCall(0),
  ];
  const add = 0x6a;
  const drop = 0x1a;
  const start = [...fdWrite(0, 1), ...fdWrite(65534, 1), add, ...fdWrite(8, 1), add, ...wasmCall(1), drop];
  using dir = tempDir("wasi-fd-write-oob", {});
  const wasm = path.join(String(dir), "guest.wasm");
  fs.writeFileSync(wasm, wasiGuest({ fd_write: "iiii", proc_exit: "i" }, start, [...iovecs]));

  await using proc = Bun.spawn({ cmd: [bunExe(), wasm], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 3 * WASI_EOVERFLOW });
});

it("a hostcall sees the memory the guest has now: after it grows, and after another one is set", () => {
  const wasi = new WASI({});
  const time = memory => new DataView(memory.buffer).getBigUint64(END + 8, true);
  const clockTimeGet = () => wasi.wasiImport.clock_time_get(1, ZERO, END + 8); // a pointer in the second page

  const shared = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
  wasi.setMemory(shared);
  // clock_res_get is the first hostcall wasi-libc makes.
  const first = wasi.wasiImport.clock_res_get(1, 0);
  const beforeGrow = clockTimeGet();
  shared.grow(1);
  const afterGrow = [clockTimeGet(), time(shared) > ZERO];

  const other = new WebAssembly.Memory({ initial: 2 });
  wasi.setMemory(other);
  const afterSet = [clockTimeGet(), time(other) > ZERO];

  expect({ first, beforeGrow, afterGrow, afterSet }).toEqual({
    first: 0,
    beforeGrow: WASI_EOVERFLOW,
    afterGrow: [0, true],
    afterSet: [0, true],
  });
});

it("a pointer above 2 GiB, which a guest passes as a negative number, names the same memory", () => {
  const pages = 32768 + 1;
  const wasi = new WASI({ args: ["a"] });
  const memory = new WebAssembly.Memory({ initial: pages });
  wasi.setMemory(memory);
  const view = new DataView(memory.buffer);
  const high = 2 ** 31 + 1024; // in the last page
  const end = pages * 65536;

  expect({
    inBounds: [
      wasi.wasiImport.args_sizes_get(high | 0, (high + 4) | 0),
      view.getUint32(high, true),
      view.getUint32(high + 4, true),
    ],
    pastTheEnd: wasi.wasiImport.args_sizes_get(high | 0, (end - 3) | 0),
  }).toEqual({ inBounds: [0, 1, "a\0".length], pastTheEnd: WASI_EOVERFLOW });
});

it("fd_readdir fills a short buffer the way uvwasi does and never writes past it", () => {
  using dir = tempDir("wasi-fd-readdir-short", { "abcdefgh": "" });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const bytes = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  // The one entry: d_next 1, d_ino, d_namlen 8, d_type regular file, three bytes of padding, the name.
  const dirent = Buffer.alloc(24 + 8, 0xaa);
  dirent.writeBigUInt64LE(BigInt(1), 0);
  dirent.writeBigUInt64LE(BigInt(fs.statSync(path.join(String(dir), "abcdefgh")).ino), 8);
  dirent.writeUInt32LE(8, 16);
  dirent.writeUInt8(4, 20);
  dirent.write("abcdefgh", 24);

  const results = {};
  const expected = {};
  for (const bufLen of [1, 23, 24, 25, 31, 32, 33]) {
    // The buffer ends where memory ends. Anything written past it is out of bounds.
    const bufPtr = END - bufLen;
    bytes.fill(0xaa, END - 64);
    const errno = wasi.wasiImport.fd_readdir(3, bufPtr, bufLen, ZERO, OUT);
    results[bufLen] = [errno, view.getUint32(OUT, true), bytes.toString("hex", bufPtr)];
    // An entry whose 24-byte header does not fit is not written and the buffer counts as full. A name is cut.
    const written =
      bufLen < 24
        ? Buffer.alloc(bufLen, 0xaa)
        : Buffer.concat([dirent.subarray(0, bufLen), Buffer.alloc(Math.max(0, bufLen - 32), 0xaa)]);
    expected[bufLen] = [0, Math.min(bufLen, 32), written.toString("hex")];
  }
  expect(results).toEqual(expected);
});

it("an import declared with an i64 where a pointer goes gets EINVAL", () => {
  const wasi = new WASI({});
  const module = new WebAssembly.Module(wasiGuest({ fd_fdstat_get: "iI", random_get: "Ii", fd_write: "iiIi" }));
  const guest = new WebAssembly.Instance(module, wasi.getImports(module)).exports;
  wasi.start({ exports: guest });

  expect({
    fd_fdstat_get: guest.fd_fdstat_get(1, ZERO),
    random_get: guest.random_get(ZERO, 4),
    fd_write: guest.fd_write(1, 0, ZERO, OUT),
  }).toEqual({ fd_fdstat_get: WASI_EINVAL, random_get: WASI_EINVAL, fd_write: WASI_EINVAL });
});

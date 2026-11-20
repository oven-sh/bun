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

const WASI_EBADF = 8;
const WASI_EOVERFLOW = 61;
const END = 65536; // one page of guest memory
const STDOUT = 1;
const DIR = 3; // the preopened directory
// Where the calls below point: one iovec and the 4 bytes it names, and scratch space for what the host writes.
const IOVEC = 2048;
const DATA = 2080;
const OUT = 4096;
const OUT2 = 4160;
const BUF = 8192;
const ZERO = BigInt(0);

it("a hostcall sees the memory the guest has now: after it grows, and after another one is set", () => {
  const stdout = [];
  const wasi = new WASI({ args: ["argv0"], sendStdout: bytes => stdout.push(`${Buffer.from(bytes)}`) });
  // One hostcall for each way the host reaches guest memory, with every pointer in the second page: what they
  // answered, and what is in that page afterwards.
  const inSecondPage = memory => {
    stdout.length = 0;
    if (memory.buffer.byteLength > END) {
      const page = Buffer.from(memory.buffer, END);
      page.fill(0);
      page.writeUInt32LE(END + DATA, IOVEC);
      page.writeUInt32LE(4, IOVEC + 4);
      page.write("data", DATA);
    }
    const answers = [
      wasi.wasiImport.clock_time_get(1, ZERO, END + OUT),
      wasi.wasiImport.args_get(END + OUT2, END + BUF),
      wasi.wasiImport.random_get(END + BUF + 64, 64),
      wasi.wasiImport.fd_write(STDOUT, END + IOVEC, 1, END + OUT + 8),
    ];
    if (memory.buffer.byteLength === END) return { answers, stdout: [...stdout] };
    const page = Buffer.from(memory.buffer, END);
    return {
      answers,
      stdout: [...stdout],
      time: page.readBigUInt64LE(OUT) > ZERO,
      nwritten: page.readUInt32LE(OUT + 8),
      argv: [page.readUInt32LE(OUT2), page.toString("latin1", BUF, BUF + "argv0\0".length)],
      random: page.subarray(BUF + 64, BUF + 128).some(byte => byte !== 0),
    };
  };
  const outOfBounds = { answers: [WASI_EOVERFLOW, WASI_EOVERFLOW, WASI_EOVERFLOW, WASI_EOVERFLOW], stdout: [] };
  const inBounds = {
    answers: [0, 0, 0, 0],
    stdout: ["data"],
    time: true,
    nwritten: 4,
    argv: [END + BUF, "argv0\0"],
    random: true,
  };

  // No hostcall has built the view yet, and a guest may start with this one: Node's test/wasi/wasm/clock_getres.wasm does.
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  expect(wasi.wasiImport.clock_res_get(1, 0)).toBe(0);

  // A grow detaches the buffer of a plain memory, gives a shared memory a new one, and resizes a resizable one.
  const grown = {};
  for (const kind of ["plain", "shared", "resizable"]) {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: kind === "shared" });
    if (kind === "resizable") memory.toResizableBuffer();
    wasi.setMemory(memory);
    const buffer = memory.buffer;
    const before = inSecondPage(memory);
    memory.grow(1);
    grown[kind] = { before, after: inSecondPage(memory), oldBufferLength: buffer.byteLength };
  }
  expect(grown).toEqual({
    plain: { before: outOfBounds, after: inBounds, oldBufferLength: 0 },
    shared: { before: outOfBounds, after: inBounds, oldBufferLength: END },
    resizable: { before: outOfBounds, after: inBounds, oldBufferLength: 2 * END },
  });

  const other = new WebAssembly.Memory({ initial: 2 });
  wasi.setMemory(other);
  expect(inSecondPage(other)).toEqual(inBounds);

  // A host that drops the view gets a new one.
  wasi.view = undefined;
  expect(inSecondPage(other)).toEqual(inBounds);
});

it("a hostcall follows a memory that the fstatSync of the host's fs grows while it runs", () => {
  using dir = tempDir("wasi-binding-grows", { "file.txt": "0123456789" });
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
  const { bindings } = new WASI({});
  let grow = false;
  const fstatSync = (...args) => {
    if (grow) memory.grow(1);
    grow = false;
    return bindings.fs.fstatSync(...args);
  };
  const wasi = new WASI({
    preopens: { "/sandbox": String(dir) },
    bindings: { ...bindings, fs: { ...bindings.fs, fstatSync } },
  });
  wasi.setMemory(memory);
  Buffer.from(memory.buffer).write("file.txt", BUF);

  // The two hostcalls that reach guest memory after they call fstatSync.
  const answers = [];
  for (const hostcall of [
    () => wasi.wasiImport.fd_filestat_get(DIR, OUT),
    () => wasi.wasiImport.path_filestat_set_times(DIR, 0, BUF, "file.txt".length, ZERO, ZERO, 0),
  ]) {
    grow = true;
    answers.push([hostcall(), grow]);
  }
  const WASI_FILETYPE_DIRECTORY = 3;
  expect({
    answers,
    pages: memory.buffer.byteLength / END,
    filetype: new DataView(memory.buffer).getUint8(OUT + 16),
  }).toEqual({
    answers: [
      [0, false],
      [0, false],
    ],
    pages: 3,
    filetype: WASI_FILETYPE_DIRECTORY,
  });
});

it("a pointer or a count of 2 GiB or more names the same memory, as a negative number or not", () => {
  using dir = tempDir("wasi-above-2gib", {});
  const pages = 32768 + 1;
  const wasi = new WASI({ args: ["a"], preopens: { "/sandbox": String(dir) } });
  const memory = new WebAssembly.Memory({ initial: pages });
  wasi.setMemory(memory);
  const view = new DataView(memory.buffer);
  const high = 2 ** 31 + 1024; // in the last page
  const end = pages * 65536;
  const argsSizesGet = (argc, argvBufSize) => {
    view.setBigUint64(high, ZERO);
    return [
      wasi.wasiImport.args_sizes_get(argc, argvBufSize),
      view.getUint32(high, true),
      view.getUint32(high + 4, true),
    ];
  };

  expect({
    // What a wasm guest passes: an i32 arrives as a signed number.
    negative: argsSizesGet(high | 0, (high + 4) | 0),
    // What a caller in JavaScript may pass.
    unsigned: argsSizesGet(high, high + 4),
    pastTheEnd: argsSizesGet(high | 0, (end - 3) | 0),
    // A buffer of 2 GiB for the name of the preopened directory: the count is 2 ** 31.
    count: [
      wasi.wasiImport.fd_prestat_dir_name(DIR, 1024, (2 ** 31) | 0),
      Buffer.from(memory.buffer, 1024, "/sandbox".length).toString(),
    ],
    // A path of 2 GiB. The host does not read it for a descriptor that is not open, nor for a buffer that is out of bounds.
    path: [
      wasi.wasiImport.path_unlink_file(99, 0, (2 ** 31) | 0),
      wasi.wasiImport.path_filestat_get(DIR, 0, 0, (2 ** 31) | 0, end - 63),
    ],
  }).toEqual({
    negative: [0, 1, "a\0".length],
    unsigned: [0, 1, "a\0".length],
    pastTheEnd: [WASI_EOVERFLOW, 0, 0],
    count: [0, "/sandbox"],
    path: [WASI_EBADF, WASI_EOVERFLOW],
  });
});

it("fd_readdir fills a buffer that is too short for an entry and never writes past it", () => {
  using dir = tempDir("wasi-fd-readdir-short", { "abcdefgh": "" });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const bytes = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  // The one entry: d_next 1, d_ino, d_namlen 8, d_type regular file, three bytes of padding, the name.
  // d_ino is the inode of the host file. Node writes 0 there.
  const dirent = Buffer.alloc(24 + 8, 0xaa);
  dirent.writeBigUInt64LE(BigInt(1), 0);
  dirent.writeBigUInt64LE(BigInt(fs.statSync(path.join(String(dir), "abcdefgh")).ino), 8);
  dirent.writeUInt32LE(8, 16);
  dirent.writeUInt8(4, 20);
  dirent.write("abcdefgh", 24);

  const results = {};
  const expected = {};
  for (const bufLen of [1, 23, 24, 25, 31, 32, 33]) {
    // Once with the buffer in the middle of memory, and once with its end at the end of memory.
    for (const bufPtr of [BUF, END - bufLen]) {
      const window = [bufPtr, Math.min(bufPtr + 40, END)];
      bytes.fill(0xaa, ...window);
      const errno = wasi.wasiImport.fd_readdir(DIR, bufPtr, bufLen, ZERO, OUT);
      results[`${bufLen} bytes at ${bufPtr}`] = [errno, view.getUint32(OUT, true), bytes.toString("hex", ...window)];
      // An entry whose 24-byte header does not fit is not written and the buffer counts as full. A name is cut.
      const used = Math.min(bufLen, dirent.length);
      const written = Buffer.alloc(window[1] - window[0], 0xaa);
      if (bufLen >= 24) dirent.copy(written, 0, 0, used);
      expected[`${bufLen} bytes at ${bufPtr}`] = [0, used, written.toString("hex")];
    }
  }
  expect(results).toEqual(expected);
});

it("fd_readdir lists every entry through a buffer that holds two entries at a time", () => {
  const names = Array.from({ length: 50 }, (_, i) => `entry-${String(i).padStart(2, "0")}.wasi-readdir`);
  using dir = tempDir("wasi-fd-readdir-loop", Object.fromEntries(names.map(name => [name, ""])));
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const bytes = Buffer.from(wasi.memory.buffer);
  const bufLen = 128;

  // What readdir() of wasi-libc does: take the entries that are whole, ask again from the cookie of the last one,
  // and stop when the host leaves the buffer short. Two entries of 24 + 21 bytes fit, the name of the third does not.
  const listed = [];
  const answers = new Set();
  let cookie = ZERO;
  for (let call = 0; call < names.length; call++) {
    answers.add(wasi.wasiImport.fd_readdir(DIR, BUF, bufLen, cookie, OUT));
    const used = bytes.readUInt32LE(OUT);
    for (let at = BUF; at + 24 <= BUF + used;) {
      const nameLength = bytes.readUInt32LE(at + 16);
      if (at + 24 + nameLength > BUF + used) break;
      listed.push(bytes.toString("utf8", at + 24, at + 24 + nameLength));
      cookie = bytes.readBigUInt64LE(at);
      at += 24 + nameLength;
    }
    if (used < bufLen) break;
  }
  expect({ answers: [...answers], listed: listed.sort() }).toEqual({ answers: [0], listed: names });
});

it("args_get and environ_get write a table of pointers and the strings it points at", () => {
  const wasi = new WASI({ args: ["argv0", "é", ""], env: { K: "v", EMPTY: "" } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const bytes = Buffer.from(wasi.memory.buffer);
  const argv = Buffer.from("argv0\0é\0\0");
  const environ = Buffer.from("K=v\0EMPTY=\0");
  const words = (at, count) => Array.from({ length: count }, (_, i) => bytes.readUInt32LE(at + 4 * i));

  bytes.fill(0xaa, OUT, BUF + 64);
  const answers = [
    wasi.wasiImport.args_sizes_get(OUT, OUT + 4),
    wasi.wasiImport.environ_sizes_get(OUT + 8, OUT + 12),
    wasi.wasiImport.args_get(OUT2, BUF),
    wasi.wasiImport.environ_get(OUT2 + 16, BUF + argv.length),
  ];
  expect({
    answers,
    sizes: words(OUT, 4),
    // One word after each table and one byte after the strings: the host does not write there.
    argvTable: words(OUT2, 4),
    environTable: words(OUT2 + 16, 3),
    strings: bytes.toString("hex", BUF, BUF + argv.length + environ.length + 1),
  }).toEqual({
    answers: [0, 0, 0, 0],
    sizes: [3, argv.length, 2, environ.length],
    argvTable: [BUF, BUF + argv.indexOf("é"), BUF + argv.length - 1, 0xaaaaaaaa],
    environTable: [BUF + argv.length, BUF + argv.length + environ.indexOf("EMPTY"), 0xaaaaaaaa],
    strings: Buffer.concat([argv, environ, Buffer.from([0xaa])]).toString("hex"),
  });
});

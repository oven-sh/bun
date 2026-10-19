import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import fs from "node:fs";
import path from "node:path";
import tty from "node:tty";
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
  const WASI_ENOTCAPABLE = 76;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const allRights = BigInt.asIntN(64, BigInt("0xffffffffffffffff"));

  const stdinRights = wasi.FD_MAP.get(0).rights;
  const baseBefore = stdinRights.base;
  const inheritingBefore = stdinRights.inheriting;

  expect(wasi.wasiImport.fd_fdstat_set_rights(0, allRights, allRights)).toBe(WASI_ENOTCAPABLE);
  expect(wasi.FD_MAP.get(0).rights).toEqual({ base: baseBefore, inheriting: inheritingBefore });

  expect(wasi.wasiImport.fd_fdstat_set_rights(0, WASI_RIGHT_FD_READ, BigInt(0))).toBe(WASI_ESUCCESS);
  expect(wasi.FD_MAP.get(0).rights).toEqual({ base: WASI_RIGHT_FD_READ, inheriting: BigInt(0) });
});

// Closes the host descriptors that this WASI opened: the preopens, and what path_open added.
function closeDescriptors(wasi) {
  for (const fd of wasi.FD_MAP.keys()) if (fd > 2) wasi.wasiImport.fd_close(fd);
}

it("a hostcall that the rights of the descriptor do not allow returns ENOTCAPABLE", () => {
  using dir = tempDir("wasi-refusal-errno", {
    "file.txt": "file data\n",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_ENOTCAPABLE = 76;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_WRITE = BigInt(64);
  const WASI_WHENCE_CUR = 1;
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const iovsPtr = 2048;
  const countPtr = 3072;
  const bufPtr = 4096;

  const open = rights => {
    const len = memory.write("file.txt", pathPtr);
    expect(wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, 0, rights, BigInt(0), 0, fdPtr)).toBe(WASI_ESUCCESS);
    return view.getUint32(fdPtr, true);
  };
  try {
    const readOnly = open(WASI_RIGHT_FD_READ);
    const writeOnly = open(WASI_RIGHT_FD_WRITE);
    view.setUint32(iovsPtr, bufPtr, true);
    view.setUint32(iovsPtr + 4, 1, true);

    // wasi-libc turns ENOTCAPABLE into the errno of the call: EBADF for write() and read(), ESPIPE for lseek().
    expect({
      "fd_write, opened with FD_READ": wasi.wasiImport.fd_write(readOnly, iovsPtr, 1, countPtr),
      "fd_read, opened with FD_WRITE": wasi.wasiImport.fd_read(writeOnly, iovsPtr, 1, countPtr),
      "fd_seek, opened with FD_READ": wasi.wasiImport.fd_seek(readOnly, BigInt(0), WASI_WHENCE_CUR, countPtr),
      "fd_read, opened with FD_READ": wasi.wasiImport.fd_read(readOnly, iovsPtr, 1, countPtr),
    }).toEqual({
      "fd_write, opened with FD_READ": WASI_ENOTCAPABLE,
      "fd_read, opened with FD_WRITE": WASI_ENOTCAPABLE,
      "fd_seek, opened with FD_READ": WASI_ENOTCAPABLE,
      "fd_read, opened with FD_READ": WASI_ESUCCESS,
    });
  } finally {
    closeDescriptors(wasi);
  }
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

// What Node.js v26.3.0 prints for wasi-path-open-fixture.mjs: "<file type> <base rights> / <inheriting rights>" of the
// new descriptor, or the errno. uvwasi masks the rights that the guest asks for with the maximum of the file type.
const pathOpenRows = {
  "regular file, asked FD_READ|FD_SEEK|FD_TELL|FD_READDIR / -": "regular_file FD_READ|FD_SEEK|FD_TELL / -",
  "regular file, asked - / -": "regular_file - / -",
  "regular file, asked FD_READ / FD_READ|FD_WRITE": "regular_file FD_READ / -",
  "directory, asked FD_READ|FD_SEEK|FD_TELL|FD_READDIR / -": "directory FD_READDIR / -",
  "directory without O_DIRECTORY, asked FD_READ|FD_SEEK|FD_TELL|FD_READDIR / -": "directory FD_READDIR / -",
  "new file with O_CREAT, asked FD_READ|FD_WRITE|PATH_OPEN|FD_READDIR / -": "regular_file FD_READ|FD_WRITE / -",
  "regular file with O_CREAT|O_TRUNC, asked FD_WRITE / -": "regular_file FD_WRITE / -",
  "regular file with FDFLAG_APPEND, asked FD_WRITE / -": "regular_file FD_WRITE / -",
  "regular file with FDFLAG_SYNC, asked FD_WRITE / -": "regular_file FD_WRITE / -",
  "regular file with O_DIRECTORY, asked FD_READDIR / -": "errno 54",
  "regular file, asked FD_READ / -": "regular_file FD_READ / -",
  'path_open(that regular file, "."), asked FD_READ|FD_WRITE / -': "errno 76",
  "directory, asked FD_READDIR / FD_READ": "directory FD_READDIR / FD_READ",
  'path_open(that directory, "a.txt"), asked FD_READ / -': "errno 76",
  "directory, asked PATH_OPEN|FD_READDIR / FD_READ": "directory PATH_OPEN|FD_READDIR / FD_READ",
  'path_open(that directory with PATH_OPEN, "a.txt"), asked FD_READ / -': "regular_file FD_READ / -",
  "regular file, asked FD_READ|FD_SEEK|PATH_OPEN|FD_READDIR / FD_READ": "regular_file FD_READ|FD_SEEK / -",
  "fd_fdstat_set_rights(that regular file, FD_READ|FD_READDIR / -)": "76, then regular_file FD_READ|FD_SEEK / -",
  "fd_fdstat_set_rights(that regular file, FD_READ|PATH_OPEN / -)": "76, then regular_file FD_READ|FD_SEEK / -",
  "fd_fdstat_set_rights(that regular file, FD_READ / FD_READ)": "76, then regular_file FD_READ|FD_SEEK / -",
  "fd_fdstat_set_rights(that regular file, FD_READ / -)": "0, then regular_file FD_READ / -",
};
const pathOpenRowsPosix = {
  "FIFO, asked FD_READ|FD_SEEK|FD_TELL|FD_FILESTAT_GET / FD_READ": "socket_stream FD_READ|FD_FILESTAT_GET / FD_READ",
  // lseek() and ftell() of a libc are refused, and the read that follows gets the data.
  "that FIFO: fd_seek, fd_tell, fd_read": '76, 76, 0 "fifo data\\n"',
  // A character device that is not a terminal can have every right: it keeps what the guest asked for.
  "/dev/null, asked FD_READ|FD_SEEK|FD_TELL|FD_FILESTAT_GET / FD_READ":
    "character_device FD_READ|FD_SEEK|FD_TELL|FD_FILESTAT_GET / FD_READ",
};
const expectedPathOpenRows = isWindows ? pathOpenRows : { ...pathOpenRows, ...pathOpenRowsPosix };

// Runs wasi-path-open-fixture.mjs with `exe` and returns the rows that it prints.
async function pathOpenFixture(exe) {
  using dir = tempDir("wasi-path-open-rights", {
    "file.txt": "file data\n",
    "write.txt": "write\n",
    "dir": { "a.txt": "a" },
  });
  let fifo;
  if (!isWindows) {
    const fifoPath = path.join(String(dir), "fifo");
    mkfifo(fifoPath);
    // This process keeps both ends of the FIFO open, so the open of the guest does not wait for a writer.
    fifo = fs.openSync(fifoPath, fs.constants.O_RDWR);
    fs.writeSync(fifo, "fifo data\n");
  }
  try {
    await using proc = Bun.spawn({
      cmd: [exe, path.join(import.meta.dir, "wasi-path-open-fixture.mjs"), String(dir)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // node also writes its warning about WASI to stderr.
    if (exitCode !== 0) throw new Error(`wasi-path-open-fixture.mjs exited with ${exitCode}: ${stderr}`);
    return JSON.parse(stdout);
  } finally {
    if (fifo !== undefined) fs.closeSync(fifo);
  }
}

it.concurrent("path_open stores the requested rights masked by the maximum of the file type", async () => {
  expect(await pathOpenFixture(bunExe())).toEqual(expectedPathOpenRows);
});

// Not on Windows: the rows come from Node.js on POSIX, and Node.js on Windows was not run.
it.concurrent.skipIf(isWindows || !nodeExe())("node prints the same rows for path_open", async () => {
  expect(await pathOpenFixture(nodeExe())).toEqual(expectedPathOpenRows);
});

// WASI preview1 values that the tests below use.
const RIGHT = {
  FD_READ: 1n << 1n,
  FD_SEEK: 1n << 2n,
  FD_TELL: 1n << 5n,
  FD_WRITE: 1n << 6n,
  FD_READDIR: 1n << 14n,
  FD_FILESTAT_GET: 1n << 21n,
};
const FILETYPE = { CHARACTER_DEVICE: 2, DIRECTORY: 3 };
const WASI_O_DIRECTORY = 1 << 1;

// POSIX only: the child opens its controlling terminal, a pty, as "tty" on a preopen of /dev.
it.concurrent.skipIf(isWindows)("path_open gives a terminal no seek right and no rights to pass on", async () => {
  const childSrc = `
    const { WASI } = require("node:wasi");
    const wasi = new WASI({ preopens: { "/dev": "/dev" } });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    const memory = Buffer.from(wasi.memory.buffer);
    const view = new DataView(wasi.memory.buffer);
    const FD_READ = 1n << 1n, FD_SEEK = 1n << 2n, FD_TELL = 1n << 5n, FD_WRITE = 1n << 6n, FD_FILESTAT_GET = 1n << 21n;
    const WHENCE_CUR = 1;
    const pathPtr = 1024, fdPtr = 1536, statPtr = 2048, offsetPtr = 3072;

    const len = memory.write("tty", pathPtr);
    const base = FD_READ | FD_SEEK | FD_TELL | FD_WRITE | FD_FILESTAT_GET;
    const errno = wasi.wasiImport.path_open(3, 0, pathPtr, len, 0, base, FD_READ | FD_SEEK, 0, fdPtr);
    const result = { errno };
    if (errno === 0) {
      const fd = view.getUint32(fdPtr, true);
      wasi.wasiImport.fd_fdstat_get(fd, statPtr);
      result.filetype = view.getUint8(statPtr);
      result.base = view.getBigUint64(statPtr + 8, true).toString();
      result.inheriting = view.getBigUint64(statPtr + 16, true).toString();
      result.seek = wasi.wasiImport.fd_seek(fd, 0n, WHENCE_CUR, offsetPtr);
      result.tell = wasi.wasiImport.fd_tell(fd, offsetPtr);
    }
    process.stdout.write("RESULT " + JSON.stringify(result) + "\\n");
  `;

  const WASI_ENOTCAPABLE = 76;
  const decoder = new TextDecoder();
  const result = Promise.withResolvers();
  let output = "";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", childSrc],
    env: bunEnv,
    terminal: {
      data(_terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
        const match = output.match(/RESULT (\{.*\})\r?\n/);
        if (match) result.resolve(JSON.parse(match[1]));
      },
      exit() {
        result.reject(new Error("the child printed no RESULT line: " + JSON.stringify(output)));
      },
    },
  });

  // Node.js v26.3.0 gives the same answers for a terminal.
  expect(await result.promise).toEqual({
    errno: 0,
    filetype: FILETYPE.CHARACTER_DEVICE,
    base: String(RIGHT.FD_READ | RIGHT.FD_WRITE | RIGHT.FD_FILESTAT_GET),
    inheriting: "0",
    seek: WASI_ENOTCAPABLE,
    tell: WASI_ENOTCAPABLE,
  });
  expect(await proc.exited).toBe(0);
});

// path_open under `dirfd`. Returns the errno, or the new descriptor with its file type and rights.
function pathOpen(wasi, dirfd, guestPath, { oflags = 0, base = 0n, inheriting = 0n } = {}) {
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);
  const pathPtr = 1024;
  const fdPtr = 1536;
  const statPtr = 2048;
  const sentinel = 0x12345678;

  const len = memory.write(guestPath, pathPtr);
  view.setUint32(fdPtr, sentinel, true);
  const errno = wasi.wasiImport.path_open(dirfd, 0, pathPtr, len, oflags, base, inheriting, 0, fdPtr);
  const fd = view.getUint32(fdPtr, true);
  if (errno !== 0) {
    expect(fd).toBe(sentinel);
    return { errno };
  }
  // The entry is complete when path_open returns: the table and fd_fdstat_get agree.
  const entry = wasi.FD_MAP.get(fd);
  const stored = { filetype: entry.filetype, base: entry.rights.base, inheriting: entry.rights.inheriting };
  expect(wasi.wasiImport.fd_fdstat_get(fd, statPtr)).toBe(0);
  expect({
    filetype: view.getUint8(statPtr),
    base: view.getBigUint64(statPtr + 8, true),
    inheriting: view.getBigUint64(statPtr + 16, true),
  }).toEqual(stored);
  return { fd, ...stored };
}

// The default bindings of node:wasi, with some replaced. The constructor takes the whole object.
function bindingsWith(overrides) {
  return {
    hrtime: () => process.hrtime.bigint(),
    exit: code => process.exit(code),
    kill: signal => process.kill(process.pid, signal),
    randomFillSync: array => crypto.getRandomValues(array),
    isTTY: fd => tty.isatty(fd),
    fs,
    path,
    ...overrides,
  };
}

// POSIX only: the character device is /dev/null.
it.skipIf(isWindows)("path_open asks isTTY about the descriptor of the host, for a character device only", () => {
  using dir = tempDir("wasi-path-open-istty", { "file.txt": "file data\n" });
  const isTTYCalls = [];
  const isTTY = fd => {
    isTTYCalls.push(fd);
    return tty.isatty(fd);
  };
  const wasi = new WASI({ preopens: { "/": String(dir), "/dev": "/dev" }, bindings: bindingsWith({ isTTY }) });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));

  const preopenFd = 3;
  const devFd = 4;
  const base = RIGHT.FD_READ | RIGHT.FD_SEEK;

  try {
    pathOpen(wasi, preopenFd, "file.txt", { base });
    expect(isTTYCalls).toEqual([]);

    const devNull = pathOpen(wasi, devFd, "null", { base });
    expect(devNull).toEqual({ fd: 6, filetype: FILETYPE.CHARACTER_DEVICE, base, inheriting: 0n });
    expect(isTTYCalls).toEqual([wasi.FD_MAP.get(devNull.fd).real]);
  } finally {
    closeDescriptors(wasi);
  }
});

it("path_open closes the host descriptor and adds no entry when the check of the file type fails", () => {
  using dir = tempDir("wasi-path-open-type-check", {
    "file.txt": "file data\n",
    "dir": { "a.txt": "a" },
  });
  const opened = [];
  const closed = [];
  let failFstat = false;
  // This host has no O_DIRECTORY, as Windows, and its fstat can fail.
  const hostFs = {
    ...fs,
    openSync(file, flags, mode) {
      const fd = fs.openSync(file, flags & ~(fs.constants.O_DIRECTORY ?? 0), mode);
      opened.push(fd);
      return fd;
    },
    closeSync(fd) {
      closed.push(fd);
      return fs.closeSync(fd);
    },
    fstatSync(fd, options) {
      if (failFstat) throw Object.assign(new Error("EIO: i/o error, fstat"), { code: "EIO" });
      return fs.fstatSync(fd, options);
    },
  };
  const wasi = new WASI({ preopens: { "/": String(dir) }, bindings: bindingsWith({ fs: hostFs }) });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));

  const WASI_EIO = 29;
  const WASI_ENOTDIR = 54;
  const preopenFd = 3;
  const { FD_READ, FD_READDIR } = RIGHT;
  // The first host descriptor is the preopen.
  expect(opened).toHaveLength(1);

  try {
    failFstat = true;
    const fstatFails = pathOpen(wasi, preopenFd, "file.txt", { base: FD_READ });
    failFstat = false;
    expect({
      "fstat fails": fstatFails,
      "O_DIRECTORY on a file": pathOpen(wasi, preopenFd, "file.txt", { oflags: WASI_O_DIRECTORY, base: FD_READDIR }),
    }).toEqual({
      "fstat fails": { errno: WASI_EIO },
      "O_DIRECTORY on a file": { errno: WASI_ENOTDIR },
    });

    // The table of the guest has no number left.
    wasi.getUnusedFileDescriptor = () => {
      throw new Error("no available file descriptors");
    };
    expect(() => pathOpen(wasi, preopenFd, "file.txt", { base: FD_READ })).toThrow("no available file descriptors");
    delete wasi.getUnusedFileDescriptor;

    expect(opened).toHaveLength(4);
    expect(closed).toEqual(opened.slice(1));
    expect([...wasi.FD_MAP.keys()]).toEqual([0, 1, 2, 3]);

    // A directory passes the same check.
    expect(pathOpen(wasi, preopenFd, "dir", { oflags: WASI_O_DIRECTORY, base: FD_READDIR })).toEqual({
      fd: 4,
      filetype: FILETYPE.DIRECTORY,
      base: FD_READDIR,
      inheriting: 0n,
    });
  } finally {
    closeDescriptors(wasi);
  }
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

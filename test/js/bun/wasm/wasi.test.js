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

// Shared by the pointer-validation tests: a 1-page memory, the directory preopened on
// fd 3 (holding file.txt and, off Windows, a symlink to it), file.txt open on its own
// descriptor, and the guest path strings the hostcalls are given.
function setupGuest(dir) {
  if (!isWindows) {
    fs.symlinkSync("file.txt", path.join(String(dir), "link"));
  }
  const wasi = new WASI({ version: "preview1", args: ["argv0"], env: { K: "v" }, preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);
  const END = wasi.memory.buffer.byteLength;

  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const WASI_RIGHT_FD_TELL = BigInt(32);
  const WASI_RIGHT_FD_FILESTAT_GET = BigInt(1 << 21);
  const preopenFd = 3;
  const FILE_PATH = 1024;
  const fileLen = memory.write("file.txt", FILE_PATH);
  const LINK_PATH = 1088;
  const linkLen = memory.write("link", LINK_PATH);
  const NEW_PATH = 1152;
  const newLen = memory.write("new-entry", NEW_PATH);
  const fdPtr = 2048;
  const rights = WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK | WASI_RIGHT_FD_TELL | WASI_RIGHT_FD_FILESTAT_GET;
  expect(wasi.wasiImport.path_open(preopenFd, 0, FILE_PATH, fileLen, 0, rights, BigInt(0), 0, fdPtr)).toBe(0);
  const fileFd = view.getUint32(fdPtr, true);

  // One clock subscription (monotonic, relative, timeout 0) for poll_oneoff.
  const SUB = 4096;
  view.setBigUint64(SUB, BigInt(1), true);
  view.setUint8(SUB + 8, 0);
  view.setUint32(SUB + 16, 1, true);
  view.setBigUint64(SUB + 24, BigInt(0), true);

  return {
    wasi,
    imports: wasi.wasiImport,
    memory,
    view,
    END,
    preopenFd,
    fileFd,
    paths: { FILE_PATH, fileLen, LINK_PATH, linkLen, NEW_PATH, newLen },
    SUB,
  };
}

it("hostcalls return EOVERFLOW for out-of-bounds guest pointers before doing anything", () => {
  using dir = tempDir("wasi-pointer-oob", {
    "file.txt": "0123456789",
  });
  const { wasi, imports: w, memory, END, preopenFd: DIR, fileFd: FILE, paths, SUB } = setupGuest(dir);
  const { FILE_PATH, fileLen, LINK_PATH, linkLen, NEW_PATH, newLen } = paths;
  const WASI_EOVERFLOW = 61;
  const WASI_O_CREAT = 1;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_WRITE = BigInt(64);
  const ZERO = BigInt(0); // an i64 argument that is not under test
  const OOB = END + 1000;
  // Valid scratch space for whichever pointer argument a row is not testing.
  const OK = 8192;
  const OUT = 16384;

  // [description, hostcall, ...arguments]; exactly one pointer (or pointer + length
  // pair) in each row does not fit in memory. Some rows leave the pointer inside
  // memory but not the range it addresses, and some are the boundary itself: a
  // range that starts at the end of memory is out of bounds even when it is empty.
  // A wasm guest passes addresses >= 2**31 to the host as negative i32s.
  const rows = [
    ["args_get argv", "args_get", END - 2, OK],
    ["args_get argvBuf (argv0 needs 6 bytes)", "args_get", OK, END - 2],
    ["args_sizes_get argc", "args_sizes_get", OOB, OK],
    ["args_sizes_get argvBufSize", "args_sizes_get", OK, END - 2],
    ["environ_get environ", "environ_get", END - 2, OK],
    ["environ_get environBuf (K=v needs 4 bytes)", "environ_get", OK, END - 2],
    ["environ_sizes_get count", "environ_sizes_get", OOB, OK],
    ["environ_sizes_get size", "environ_sizes_get", OK, END - 2],
    ["clock_res_get resolution", "clock_res_get", 1, END - 4],
    ["clock_res_get resolution, unknown clock", "clock_res_get", 99, OOB],
    ["clock_time_get time", "clock_time_get", 1, ZERO, END - 4],
    ["clock_time_get time, unknown clock", "clock_time_get", 99, ZERO, OOB],
    ["fd_fdstat_get buf (24 bytes)", "fd_fdstat_get", 0, END - 23],
    ["fd_fdstat_get buf negative", "fd_fdstat_get", 0, -24],
    ["fd_filestat_get buf (64 bytes)", "fd_filestat_get", FILE, END - 8],
    ["fd_prestat_get buf (8 bytes)", "fd_prestat_get", DIR, END - 4],
    ["fd_prestat_dir_name path past end", "fd_prestat_dir_name", DIR, OOB, 1],
    ["fd_prestat_dir_name path at end, len 1", "fd_prestat_dir_name", DIR, END, 1],
    ["fd_prestat_dir_name path at end, len 0", "fd_prestat_dir_name", DIR, END, 0],
    ["fd_prestat_dir_name len overruns", "fd_prestat_dir_name", DIR, END - 1, 2],
    ["fd_readdir buf", "fd_readdir", DIR, END - 8, 256, ZERO, OUT],
    ["fd_readdir bufused", "fd_readdir", DIR, OK, 256, ZERO, END - 2],
    ["fd_seek newoffset", "fd_seek", FILE, ZERO, 0, END - 7],
    ["fd_tell offset", "fd_tell", FILE, END - 7],
    ["path_create_directory path", "path_create_directory", DIR, END - 2, newLen],
    ["path_filestat_get path", "path_filestat_get", DIR, 0, OOB, fileLen, OUT],
    ["path_filestat_get buf (64 bytes)", "path_filestat_get", DIR, 0, FILE_PATH, fileLen, END - 8],
    ["path_filestat_set_times path", "path_filestat_set_times", DIR, 0, OOB, fileLen, ZERO, ZERO, 0],
    ["path_link old path", "path_link", DIR, 0, OOB, fileLen, DIR, NEW_PATH, newLen],
    ["path_link new path", "path_link", DIR, 0, FILE_PATH, fileLen, DIR, END - 2, newLen],
    ["path_open path", "path_open", DIR, 0, END - 2, fileLen, 0, WASI_RIGHT_FD_READ, ZERO, 0, OUT],
    ["path_open fd", "path_open", DIR, 0, FILE_PATH, fileLen, 0, WASI_RIGHT_FD_READ, ZERO, 0, END - 3],
    ["path_open O_CREAT fd", "path_open", DIR, 0, NEW_PATH, newLen, WASI_O_CREAT, WASI_RIGHT_FD_WRITE, ZERO, 0, OOB],
    ["path_readlink path", "path_readlink", DIR, OOB, linkLen, OK, 64, OUT],
    ["path_readlink buf", "path_readlink", DIR, LINK_PATH, linkLen, END - 2, 64, OUT],
    ["path_readlink bufused", "path_readlink", DIR, LINK_PATH, linkLen, OK, 64, END - 2],
    ["path_remove_directory path", "path_remove_directory", DIR, OOB, 6],
    ["path_rename old path", "path_rename", DIR, OOB, fileLen, DIR, NEW_PATH, newLen],
    ["path_rename new path", "path_rename", DIR, FILE_PATH, fileLen, DIR, END - 2, newLen],
    ["path_symlink old path", "path_symlink", OOB, fileLen, DIR, NEW_PATH, newLen],
    ["path_symlink new path", "path_symlink", FILE_PATH, fileLen, DIR, END - 2, newLen],
    ["path_unlink_file path", "path_unlink_file", DIR, END - 2, fileLen],
    ["poll_oneoff in (48 bytes per subscription)", "poll_oneoff", END - 16, OUT, 1, OK],
    ["poll_oneoff out (32 bytes per event)", "poll_oneoff", SUB, END - 16, 1, OK],
    ["poll_oneoff nevents", "poll_oneoff", SUB, OUT, 1, END - 2],
    ["poll_oneoff nsubscriptions too large for memory", "poll_oneoff", SUB, OUT, 0x10000000, OK],
    ["poll_oneoff no subscriptions, in/out at end", "poll_oneoff", END, END, 0, OK],
    ["random_get buf past end", "random_get", OOB, 4],
    ["random_get len overruns", "random_get", END - 2, 4],
    ["random_get empty buf at end", "random_get", END, 0],
    ["random_get len negative", "random_get", OK, -1],
  ];

  const fdsBefore = [...wasi.FD_MAP.keys()];
  const entriesBefore = fs.readdirSync(String(dir)).sort();
  const results = {};
  for (const [name, hostcall, ...args] of rows) {
    const before = Buffer.from(memory);
    let result;
    try {
      result = w[hostcall](...args);
    } catch (e) {
      result = `threw ${e.constructor.name}`;
    }
    if (!before.equals(memory)) {
      result = `${result}, guest memory modified`;
      before.copy(memory);
    }
    results[name] = result;
  }

  expect(results).toEqual(Object.fromEntries(rows.map(([name]) => [name, WASI_EOVERFLOW])));
  expect([...wasi.FD_MAP.keys()]).toEqual(fdsBefore);
  expect(fs.readdirSync(String(dir)).sort()).toEqual(entriesBefore);
  expect([w.fd_close(FILE), w.fd_close(DIR)]).toEqual([0, 0]);
});

it("hostcalls accept pointers whose range ends exactly at the end of memory", () => {
  using dir = tempDir("wasi-pointer-boundary", {
    "file.txt": "0123456789",
  });
  const { imports: w, memory, view, END, preopenFd: DIR, fileFd: FILE, paths, SUB } = setupGuest(dir);
  const WASI_ESUCCESS = 0;
  const u32 = ptr => view.getUint32(ptr, true);
  const u64 = ptr => view.getBigUint64(ptr, true);

  expect({
    fd_fdstat_get: [w.fd_fdstat_get(FILE, END - 24), view.getUint8(END - 24)],
    fd_filestat_get: [w.fd_filestat_get(FILE, END - 64), u64(END - 64 + 32)],
    fd_prestat_get: [w.fd_prestat_get(DIR, END - 8), u32(END - 4)],
    fd_prestat_dir_name: [w.fd_prestat_dir_name(DIR, END - 1, 1), memory.toString("utf8", END - 1)],
    args_sizes_get: [w.args_sizes_get(END - 4, END - 8), u32(END - 4), u32(END - 8)],
    args_get: [w.args_get(END - 4, END - 10), u32(END - 4), memory.toString("utf8", END - 10, END - 4)],
    environ_sizes_get: [w.environ_sizes_get(END - 4, END - 8), u32(END - 4), u32(END - 8)],
    environ_get: [w.environ_get(END - 4, END - 8), u32(END - 4), memory.toString("utf8", END - 8, END - 4)],
    clock_res_get: w.clock_res_get(1, END - 8),
    clock_time_get: [w.clock_time_get(1, BigInt(0), END - 8), u64(END - 8) > 0],
    fd_seek: [w.fd_seek(FILE, BigInt(3), 0, END - 8), u64(END - 8)],
    fd_tell: [w.fd_tell(FILE, END - 8), u64(END - 8)],
    path_filestat_get: [w.path_filestat_get(DIR, 0, paths.FILE_PATH, paths.fileLen, END - 64), u64(END - 64 + 32)],
    poll_oneoff: [w.poll_oneoff(SUB, END - 36, 1, END - 4), u32(END - 4)],
    fd_readdir: [w.fd_readdir(DIR, END - 260, 256, BigInt(0), END - 4), u32(END - 4) > 0],
    random_get: w.random_get(END - 4, 4),
    random_get_empty_on_last_byte: w.random_get(END - 1, 0),
  }).toEqual({
    fd_fdstat_get: [WASI_ESUCCESS, 4 /* WASI_FILETYPE_REGULAR_FILE */],
    fd_filestat_get: [WASI_ESUCCESS, BigInt("0123456789".length) /* st_size */],
    fd_prestat_get: [WASI_ESUCCESS, "/".length],
    fd_prestat_dir_name: [WASI_ESUCCESS, "/"],
    args_sizes_get: [WASI_ESUCCESS, 1, "argv0\0".length],
    args_get: [WASI_ESUCCESS, END - 10, "argv0\0"],
    environ_sizes_get: [WASI_ESUCCESS, 1, "K=v\0".length],
    environ_get: [WASI_ESUCCESS, END - 8, "K=v\0"],
    clock_res_get: WASI_ESUCCESS,
    clock_time_get: [WASI_ESUCCESS, true],
    fd_seek: [WASI_ESUCCESS, BigInt(3)],
    fd_tell: [WASI_ESUCCESS, BigInt(3)],
    path_filestat_get: [WASI_ESUCCESS, BigInt("0123456789".length)],
    poll_oneoff: [WASI_ESUCCESS, 1],
    fd_readdir: [WASI_ESUCCESS, true],
    random_get: WASI_ESUCCESS,
    random_get_empty_on_last_byte: WASI_ESUCCESS,
  });
  expect([w.fd_close(FILE), w.fd_close(DIR)]).toEqual([WASI_ESUCCESS, WASI_ESUCCESS]);
});

it("a wasm guest gets EOVERFLOW back for bad pointers instead of a host exception unwinding through it", () => {
  // pointer-validation-guest.c reads argv/environ the way a libc start-up does, then
  // passes pointers at the end of memory and in the top half of the address space
  // (a negative i32 by the time it reaches the host) and prints the errnos.
  const chunks = [];
  const wasi = new WASI({
    version: "preview1",
    args: ["guest", "--flag"],
    env: { K: "v" },
    sendStdout: bytes => chunks.push(Buffer.from(bytes).toString()),
  });
  const module = new WebAssembly.Module(fs.readFileSync(path.join(import.meta.dir, "pointer-validation-guest.wasm")));
  const instance = new WebAssembly.Instance(module, wasi.getImports(module));

  let error;
  try {
    wasi.start(instance);
  } catch (e) {
    error = e;
  }
  expect({ error, stdout: chunks.join("") }).toEqual({
    error: undefined,
    stdout: "args: guest --flag\nenviron: K=v\nerrnos: 61 61 61 61 61 61 61\n",
  });
});

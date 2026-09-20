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

  // the rights of a standard descriptor are derived from the host fd on first use
  expect(wasi.wasiImport.fd_fdstat_get(0, 1024)).toBe(WASI_ESUCCESS);
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

it.each([false, true])("hostcalls see linear memory grown after the first call (shared: %p)", shared => {
  const wasi = new WASI({ args: ["a", "bc"] });
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared });
  wasi.setMemory(memory);

  const WASI_ESUCCESS = 0;
  const WASI_CLOCK_REALTIME = 0;

  // the first call caches a view of the one-page memory
  expect(wasi.wasiImport.args_sizes_get(0, 4)).toBe(WASI_ESUCCESS);
  memory.grow(1);

  // every pointer below lives in the page that grow() added
  const argcPtr = 65536 + 16;
  const argvBufSizePtr = argcPtr + 4;
  const timePtr = argcPtr + 8;
  expect(wasi.wasiImport.args_sizes_get(argcPtr, argvBufSizePtr)).toBe(WASI_ESUCCESS);
  expect(wasi.wasiImport.clock_time_get(WASI_CLOCK_REALTIME, BigInt(0), timePtr)).toBe(WASI_ESUCCESS);

  const view = new DataView(memory.buffer);
  expect([view.getUint32(argcPtr, true), view.getUint32(argvBufSizePtr, true)]).toEqual([2, "a\0bc\0".length]);
  expect(view.getBigUint64(timePtr, true)).toBeGreaterThan(BigInt(0));
});

it("fd_seek rejects an unknown whence and an offset before the start of the file", () => {
  using dir = tempDir("wasi-seek", {
    "f.txt": "0123456789",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  const WASI_WHENCE_SET = 0;
  const WASI_WHENCE_CUR = 1;
  const WASI_WHENCE_END = 2;
  const INT64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
  const rights = BigInt(2) | BigInt(4) | BigInt(32); // FD_READ | FD_SEEK | FD_TELL
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 2048;
  const offsetPtr = 4096;
  const iovPtr = 8192;
  const bufPtr = 12288;
  const nreadPtr = 16384;
  const sentinel = BigInt(0xdead);

  const len = memory.write("f.txt", pathPtr);
  expect(wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, 0, rights, BigInt(0), 0, fdPtr)).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);
  const seek = (offset, whence) => wasi.wasiImport.fd_seek(fd, offset, whence, offsetPtr);

  // an unknown whence on a descriptor that was never seeked used to throw out of the import
  expect(seek(BigInt(1), 3)).toBe(WASI_EINVAL);
  expect(seek(BigInt(1), 255)).toBe(WASI_EINVAL);

  expect(seek(BigInt(2), WASI_WHENCE_SET)).toBe(WASI_ESUCCESS);
  expect(view.getBigUint64(offsetPtr, true)).toBe(BigInt(2));

  // a rejected seek writes nothing and leaves the offset where it was
  view.setBigUint64(offsetPtr, sentinel, true);
  expect(seek(BigInt(1), 3)).toBe(WASI_EINVAL);
  expect(seek(BigInt(-5), WASI_WHENCE_SET)).toBe(WASI_EINVAL);
  expect(seek(BigInt(-3), WASI_WHENCE_CUR)).toBe(WASI_EINVAL);
  expect(seek(BigInt(-11), WASI_WHENCE_END)).toBe(WASI_EINVAL);
  expect(view.getBigUint64(offsetPtr, true)).toBe(sentinel);
  expect(wasi.wasiImport.fd_tell(fd, offsetPtr)).toBe(WASI_ESUCCESS);
  expect(view.getBigUint64(offsetPtr, true)).toBe(BigInt(2));

  // the offset cannot leave the range of off_t
  expect(seek(INT64_MAX, WASI_WHENCE_SET)).toBe(WASI_ESUCCESS);
  expect(seek(BigInt(1), WASI_WHENCE_CUR)).toBe(WASI_EINVAL);

  // a backwards seek from the end is valid and the next read starts there
  expect(seek(BigInt(-3), WASI_WHENCE_END)).toBe(WASI_ESUCCESS);
  expect(view.getBigUint64(offsetPtr, true)).toBe(BigInt(7));
  view.setUint32(iovPtr, bufPtr, true);
  view.setUint32(iovPtr + 4, 8, true);
  expect(wasi.wasiImport.fd_read(fd, iovPtr, 1, nreadPtr)).toBe(WASI_ESUCCESS);
  expect(memory.toString("utf8", bufPtr, bufPtr + view.getUint32(nreadPtr, true))).toBe("789");
});

it("fd_filestat_get and path_filestat_get report the host timestamps in nanoseconds", () => {
  using dir = tempDir("wasi-filestat-times", {
    "f.txt": "x",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_RIGHT_FD_FILESTAT_GET = BigInt(2097152);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 2048;
  const statPtr = 4096;
  // filestat layout: dev, ino, filetype, nlink, size, atim, mtim, ctim (8 bytes each).
  // atim is left out: opening the file may update it on some hosts.
  const times = () => ({
    mtim: view.getBigUint64(statPtr + 48, true),
    ctim: view.getBigUint64(statPtr + 56, true),
  });

  const len = memory.write("f.txt", pathPtr);
  expect(wasi.wasiImport.path_filestat_get(preopenFd, 0, pathPtr, len, statPtr)).toBe(WASI_ESUCCESS);
  const fromPath = times();
  expect(
    wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, 0, WASI_RIGHT_FD_FILESTAT_GET, BigInt(0), 0, fdPtr),
  ).toBe(WASI_ESUCCESS);
  expect(wasi.wasiImport.fd_filestat_get(view.getUint32(fdPtr, true), statPtr)).toBe(WASI_ESUCCESS);
  const fromFd = times();

  const host = fs.statSync(path.join(String(dir), "f.txt"), { bigint: true });
  const expected = { mtim: host.mtimeNs, ctim: host.ctimeNs };
  expect(fromPath).toEqual(expected);
  expect(fromFd).toEqual(expected);
});

it("fd_fdstat_get reports the host file type of the standard descriptors", async () => {
  using dir = tempDir("wasi-stdio-fdstat", {
    "stdin.txt": "input",
  });
  const stdoutPath = path.join(String(dir), "stdout.txt");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { WASI } = require("node:wasi");
      const wasi = new WASI({});
      wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
      const view = new DataView(wasi.memory.buffer);
      const WASI_FILETYPE_CHARACTER_DEVICE = 2;
      const WASI_WHENCE_SET = 0;
      const WASI_RIGHT_FD_SEEK_OR_TELL = BigInt(4) | BigInt(32);
      const out = {};
      for (const fd of [0, 1, 2]) {
        const errno = wasi.wasiImport.fd_fdstat_get(fd, 64);
        const filetype = view.getUint8(64);
        const rights = view.getBigUint64(72, true);
        // what wasi-libc's isatty() computes from fd_fdstat_get
        const isatty = filetype === WASI_FILETYPE_CHARACTER_DEVICE && (rights & WASI_RIGHT_FD_SEEK_OR_TELL) === BigInt(0);
        // the host owns the offset of fd 0-2, so none of them can be seeked
        const seek = wasi.wasiImport.fd_seek(fd, BigInt(0), WASI_WHENCE_SET, 128);
        out[fd] = { errno, filetype, isatty, seek };
      }
      process.stdout.write(JSON.stringify(out));
      `,
    ],
    env: bunEnv,
    stdin: Bun.file(path.join(String(dir), "stdin.txt")),
    stdout: Bun.file(stdoutPath),
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const WASI_EPERM = 63;
  const WASI_FILETYPE_REGULAR_FILE = 4;
  const WASI_FILETYPE_SOCKET_STREAM = 6;
  expect(JSON.parse(fs.readFileSync(stdoutPath, "utf8"))).toEqual({
    0: { errno: 0, filetype: WASI_FILETYPE_REGULAR_FILE, isatty: false, seek: WASI_EPERM },
    1: { errno: 0, filetype: WASI_FILETYPE_REGULAR_FILE, isatty: false, seek: WASI_EPERM },
    2: { errno: 0, filetype: WASI_FILETYPE_SOCKET_STREAM, isatty: false, seek: WASI_EPERM },
  });
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("symlinks: only following one is checked against the preopen", () => {
  using dir = tempDir("wasi-symlink-policy", {
    "secret.txt": "outside",
    "sandbox/inside.txt": "inside",
    "sandbox/sub/.keep": "",
  });
  const root = String(dir);
  const sandbox = path.join(root, "sandbox");
  const secret = path.join(root, "secret.txt");
  // links planted before the guest runs: one to a file outside, one dangling
  fs.symlinkSync(path.join("..", "secret.txt"), path.join(sandbox, "escape"));
  fs.symlinkSync(path.join(root, "does-not-exist"), path.join(sandbox, "dangling"));
  const secretBefore = fs.statSync(secret, { bigint: true });

  const wasi = new WASI({ preopens: { "/": sandbox } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EPERM = 63;
  const WASI_ENOTCAPABLE = 76;
  const WASI_FILETYPE_SYMBOLIC_LINK = 7;
  const WASI_LOOKUPFLAGS_SYMLINK_FOLLOW = 1;
  const WASI_FILESTAT_SET_MTIM = 4;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const preopenFd = 3;
  const targetPtr = 1024;
  const pathPtr = 2048;
  const newPathPtr = 3072;
  const statPtr = 4096;
  const bufPtr = 8192;
  const bufUsedPtr = 12288;
  const fdPtr = 16384;
  const symlink = (target, linkPath) =>
    wasi.wasiImport.path_symlink(
      targetPtr,
      memory.write(target, targetPtr),
      preopenFd,
      pathPtr,
      memory.write(linkPath, pathPtr),
    );
  const open = (p, lookupflags) =>
    wasi.wasiImport.path_open(
      preopenFd,
      lookupflags,
      pathPtr,
      memory.write(p, pathPtr),
      0,
      WASI_RIGHT_FD_READ,
      BigInt(0),
      0,
      fdPtr,
    );

  // an absolute target is refused, as in Node. A relative one is stored as
  // written, even when it points outside: it is checked when followed.
  expect(symlink(secret, "abs-link")).toBe(WASI_EPERM);
  expect(symlink("../secret.txt", "rel-link")).toBe(WASI_ESUCCESS);
  expect(symlink("inside.txt", "ok-link")).toBe(WASI_ESUCCESS);
  expect(symlink("../inside.txt", "sub/up-link")).toBe(WASI_ESUCCESS);
  expect(fs.readdirSync(sandbox).sort()).toEqual(["dangling", "escape", "inside.txt", "ok-link", "rel-link", "sub"]);
  expect(fs.readFileSync(path.join(sandbox, "sub", "up-link"), "utf8")).toBe("inside");
  expect(open("rel-link", WASI_LOOKUPFLAGS_SYMLINK_FOLLOW)).toBe(WASI_ENOTCAPABLE);
  expect(open("ok-link", WASI_LOOKUPFLAGS_SYMLINK_FOLLOW)).toBe(WASI_ESUCCESS);

  // calls that do not follow the final component act on the link itself
  let len = memory.write("escape", pathPtr);
  expect(wasi.wasiImport.path_filestat_get(preopenFd, 0, pathPtr, len, statPtr)).toBe(WASI_ESUCCESS);
  expect(view.getUint8(statPtr + 16)).toBe(WASI_FILETYPE_SYMBOLIC_LINK);
  expect(wasi.wasiImport.path_readlink(preopenFd, pathPtr, len, bufPtr, 256, bufUsedPtr)).toBe(WASI_ESUCCESS);
  expect(memory.toString("utf8", bufPtr, bufPtr + view.getUint32(bufUsedPtr, true))).toBe("../secret.txt");
  const mtim = BigInt(1700000000) * BigInt(1e9);
  expect(
    wasi.wasiImport.path_filestat_set_times(preopenFd, 0, pathPtr, len, BigInt(0), mtim, WASI_FILESTAT_SET_MTIM),
  ).toBe(WASI_ESUCCESS);
  expect(fs.lstatSync(path.join(sandbox, "escape"), { bigint: true }).mtimeNs).toBe(mtim);
  // following it is still refused
  expect(wasi.wasiImport.path_filestat_get(preopenFd, WASI_LOOKUPFLAGS_SYMLINK_FOLLOW, pathPtr, len, statPtr)).toBe(
    WASI_ENOTCAPABLE,
  );
  expect(
    wasi.wasiImport.path_filestat_set_times(
      preopenFd,
      WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      pathPtr,
      len,
      BigInt(0),
      mtim,
      WASI_FILESTAT_SET_MTIM,
    ),
  ).toBe(WASI_ENOTCAPABLE);
  const newLen = memory.write("renamed", newPathPtr);
  expect(wasi.wasiImport.path_rename(preopenFd, pathPtr, len, preopenFd, newPathPtr, newLen)).toBe(WASI_ESUCCESS);
  expect(wasi.wasiImport.path_unlink_file(preopenFd, newPathPtr, newLen)).toBe(WASI_ESUCCESS);
  for (const name of ["dangling", "rel-link"]) {
    len = memory.write(name, pathPtr);
    expect(wasi.wasiImport.path_unlink_file(preopenFd, pathPtr, len)).toBe(WASI_ESUCCESS);
  }

  // with the follow flag the times go to the target, which must be inside
  len = memory.write("ok-link", pathPtr);
  expect(
    wasi.wasiImport.path_filestat_set_times(
      preopenFd,
      WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      pathPtr,
      len,
      BigInt(0),
      mtim,
      WASI_FILESTAT_SET_MTIM,
    ),
  ).toBe(WASI_ESUCCESS);
  expect(fs.statSync(path.join(sandbox, "inside.txt"), { bigint: true }).mtimeNs).toBe(mtim);
  expect(fs.lstatSync(path.join(sandbox, "ok-link"), { bigint: true }).mtimeNs).not.toBe(mtim);

  const secretAfter = fs.statSync(secret, { bigint: true });
  expect([secretAfter.mtimeNs, fs.readFileSync(secret, "utf8")]).toEqual([secretBefore.mtimeNs, "outside"]);
  expect(fs.readdirSync(sandbox).sort()).toEqual(["inside.txt", "ok-link", "sub"]);
});

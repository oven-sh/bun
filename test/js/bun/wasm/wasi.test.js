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

it("each instance keeps using its own bindings.fs after another instance is constructed", () => {
  using dir = tempDir("wasi-bindings-fs", {
    "file.txt": "",
  });
  const file = path.join(String(dir), "file.txt");

  // Every fs call an instance makes is recorded under the tag of the fs it was given.
  const calls = { first: [], second: [] };
  const recordingFs = tag =>
    new Proxy(fs, {
      get(target, name) {
        const value = target[name];
        if (typeof value !== "function") return value;
        return (...args) => {
          calls[tag].push(name);
          return value.apply(target, args);
        };
      },
    });
  const drain = () => {
    const recorded = { first: calls.first, second: calls.second };
    calls.first = [];
    calls.second = [];
    return recorded;
  };
  const bindingsWith = tag => ({ ...new WASI().bindings, fs: recordingFs(tag) });

  const first = new WASI({ preopens: { "/": String(dir) }, bindings: bindingsWith("first") });
  const second = new WASI({ preopens: { "/": String(dir) }, bindings: bindingsWith("second") });
  expect(drain()).toEqual({ first: ["openSync"], second: ["openSync"] });

  // WASI#fstatSync, both the stdio branch (fd <= 2) and the general one
  first.fstatSync(1);
  const realFd = fs.openSync(file, "r");
  try {
    first.fstatSync(realFd);
  } finally {
    fs.closeSync(realFd);
  }
  expect(drain()).toEqual({ first: ["fstatSync", "fstatSync"], second: [] });

  second.fstatSync(1);
  expect(drain()).toEqual({ first: [], second: ["fstatSync"] });

  // The syscalls the guest imports (here: open a file, write to it, close it)
  const WASI_ESUCCESS = 0;
  const WASI_RIGHT_FD_WRITE = BigInt(64);
  const preopenFd = 3;
  const pathPtr = 1024;
  const iovPtr = 2048;
  const dataPtr = 4096;
  const fdPtr = 8192;
  const nwrittenPtr = fdPtr + 8;

  first.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(first.memory.buffer);
  const view = new DataView(first.memory.buffer);
  const pathLen = memory.write("file.txt", pathPtr);
  const dataLen = memory.write("written by first", dataPtr);
  view.setUint32(iovPtr, dataPtr, true);
  view.setUint32(iovPtr + 4, dataLen, true);

  expect(first.wasiImport.path_open(preopenFd, 0, pathPtr, pathLen, 0, WASI_RIGHT_FD_WRITE, BigInt(0), 0, fdPtr)).toBe(
    WASI_ESUCCESS,
  );
  const guestFd = view.getUint32(fdPtr, true);
  expect(first.wasiImport.fd_write(guestFd, iovPtr, 1, nwrittenPtr)).toBe(WASI_ESUCCESS);
  expect(view.getUint32(nwrittenPtr, true)).toBe(dataLen);
  expect(first.wasiImport.fd_close(guestFd)).toBe(WASI_ESUCCESS);

  const syscalls = drain();
  expect(syscalls.second).toEqual([]);
  expect(syscalls.first).toEqual(expect.arrayContaining(["openSync", "fstatSync", "writeSync", "closeSync"]));
  expect(fs.readFileSync(file, "utf8")).toBe("written by first");
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

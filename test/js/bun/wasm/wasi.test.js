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

it("proc_raise uses wasi_snapshot_preview1 signal numbering", () => {
  const raised = [];
  const wasi = new WASI({
    bindings: {
      hrtime: () => process.hrtime.bigint(),
      exit: () => {},
      kill: signal => raised.push(signal),
      randomFillSync: array => crypto.getRandomValues(array),
      isTTY: () => false,
      fs,
      path,
    },
  });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;
  // https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md#-signal-variant
  const preview1 = [
    "SIGHUP",
    "SIGINT",
    "SIGQUIT",
    "SIGILL",
    "SIGTRAP",
    "SIGABRT",
    "SIGBUS",
    "SIGFPE",
    "SIGKILL",
    "SIGUSR1",
    "SIGSEGV",
    "SIGUSR2",
    "SIGPIPE",
    "SIGALRM",
    "SIGTERM",
    "SIGCHLD",
    "SIGCONT",
    "SIGSTOP",
    "SIGTSTP",
    "SIGTTIN",
    "SIGTTOU",
    "SIGURG",
    "SIGXCPU",
    "SIGXFSZ",
    "SIGVTALRM",
    "SIGPROF",
    "SIGWINCH",
    "SIGPOLL",
    "SIGPWR",
    "SIGSYS",
  ];
  const errnos = preview1.map((_, i) => wasi.wasiImport.proc_raise(i + 1));
  expect(raised).toEqual(preview1);
  expect(errnos).toEqual(preview1.map(() => WASI_ESUCCESS));
  expect(wasi.wasiImport.proc_raise(0)).toBe(WASI_EINVAL);
  expect(wasi.wasiImport.proc_raise(31)).toBe(WASI_EINVAL);
  expect(raised.length).toBe(preview1.length);
});

it("proc_raise reports ENOTSUP for a signal the host does not have and rethrows anything else", () => {
  const WASI_ENOTSUP = 58;
  const makeWasi = kill => {
    const wasi = new WASI({
      bindings: {
        hrtime: () => process.hrtime.bigint(),
        exit: () => {},
        kill,
        randomFillSync: array => crypto.getRandomValues(array),
        isTTY: () => false,
        fs,
        path,
      },
    });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    return wasi;
  };

  const unknownSignal = makeWasi(signal => {
    throw Object.assign(new TypeError("Unknown signal: " + signal), { code: "ERR_UNKNOWN_SIGNAL" });
  });
  // 28 is SIGPOLL in preview1 numbering.
  expect(unknownSignal.wasiImport.proc_raise(28)).toBe(WASI_ENOTSUP);

  const broken = makeWasi(() => {
    throw new Error("kill binding bug");
  });
  expect(() => broken.wasiImport.proc_raise(28)).toThrow("kill binding bug");
});

it.skipIf(isWindows)("bun prog.wasm: proc_raise(SIGTERM) delivers SIGTERM to the host process", () => {
  // (module
  //   (import "wasi_snapshot_preview1" "proc_raise" (func (param i32) (result i32)))
  //   (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
  //   (memory (export "memory") 1)
  //   (func (export "_start") (drop (call 0 (i32.const 15))) (call 1 (i32.const 42))))
  const s = t => [t.length, ...Buffer.from(t)];
  const sec = (id, b) => [id, b.length, ...b];
  const W = "wasi_snapshot_preview1";
  const body = [0, 0x41, 15, 0x10, 0, 0x1a, 0x41, 42, 0x10, 1, 0x0b];
  const mod = Buffer.from([
    ...[0, 97, 115, 109, 1, 0, 0, 0],
    ...sec(1, [3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 0, 0x60, 0, 0]),
    ...sec(2, [2, ...s(W), ...s("proc_raise"), 0, 0, ...s(W), ...s("proc_exit"), 0, 1]),
    ...sec(3, [1, 2]),
    ...sec(5, [1, 0, 1]),
    ...sec(7, [2, ...s("memory"), 2, 0, ...s("_start"), 0, 2]),
    ...sec(10, [1, body.length, ...body]),
  ]);
  using dir = tempDir("wasi-proc-raise", { "raise.wasm": mod });

  const { stdout, exitCode, signalCode } = spawnSync({
    cmd: [bunExe(), path.join(String(dir), "raise.wasm")],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  expect(stdout.toString()).toBe("");
  expect(signalCode).toBe("SIGTERM");
  expect(exitCode).not.toBe(42);
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

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
  const wasi = new WASI({ version: "preview1", preopens: { "/": String(dir) } });
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
  const wasi = new WASI({ version: "preview1" });
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
  const wasi = new WASI({ version: "preview1", preopens: { "/": String(dir) } });
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

  const wasi = new WASI({ version: "preview1", preopens: { "/": sandbox } });
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

it("implements the Node WASI lifecycle and import-object contract", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const wasi = new WASI({ version: "preview1", stdin: 4, stdout: 5, stderr: 6 });

  expect(wasi.getImportObject()).toEqual({ wasi_snapshot_preview1: wasi.wasiImport });
  expect(wasi.FD_MAP.get(0).real).toBe(4);
  expect(wasi.FD_MAP.get(1).real).toBe(5);
  expect(wasi.FD_MAP.get(2).real).toBe(6);

  let startCalls = 0;
  const command = { exports: { memory, _start: () => startCalls++ } };
  expect(wasi.start(command)).toBe(0);
  expect(startCalls).toBe(1);
  expect(() => wasi.start(command)).toThrow(expect.objectContaining({ code: "ERR_WASI_ALREADY_STARTED" }));
});

it("starts an unstable WASI module through getImportObject()", async () => {
  using dir = tempDir("wasi-start", {});
  const outputPath = path.join(String(dir), "output.txt");
  const outputFd = fs.openSync(outputPath, "w");

  try {
    const wasi = new WASI({ version: "unstable", stdout: outputFd });
    const wasm = await WebAssembly.compile(fs.readFileSync(import.meta.dir + "/hello-wasi.wasm"));
    const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    expect(wasi.start(instance)).toBe(0);
  } finally {
    fs.closeSync(outputFd);
  }

  expect(fs.readFileSync(outputPath, "utf8")).toBe("hello world\n");
});

it("returns a WASI proc_exit code from start()", () => {
  const wasi = new WASI({ version: "preview1" });
  const command = {
    exports: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      _start: () => wasi.wasiImport.proc_exit(7),
    },
  };

  expect(wasi.start(command)).toBe(7);
});

it("initializes reactor modules and rejects command modules", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const wasi = new WASI({ version: "preview1" });
  let initializeCalls = 0;
  const reactor = { exports: { memory, _initialize: () => initializeCalls++ } };

  expect(wasi.initialize(reactor)).toBeUndefined();
  expect(initializeCalls).toBe(1);
  expect(() => wasi.initialize(reactor)).toThrow(expect.objectContaining({ code: "ERR_WASI_ALREADY_STARTED" }));

  const command = {
    exports: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      _start() {},
    },
  };
  expect(() => new WASI({ version: "preview1" }).initialize(command)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
});

it("validates the WASI version option", () => {
  expect(() => new WASI()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  expect(() => new WASI({ version: "unsupported" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );

  const unstable = new WASI({ version: "unstable" });
  expect(unstable.getImportObject()).toEqual({ wasi_unstable: unstable.wasiImport });
});

it("validates and normalizes WASI constructor options", () => {
  expect(() => new WASI({ version: "preview1", args: "args" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => new WASI({ version: "preview1", env: "env" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => new WASI({ version: "preview1", preopens: "preopens" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => new WASI({ version: "preview1", stdout: -1 })).toThrow(
    expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
  );
  expect(() => new WASI({ version: "preview1", returnOnExit: 1 })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );

  const wasi = new WASI({ version: "preview1", args: [42, true] });
  const memory = new WebAssembly.Memory({ initial: 1 });
  wasi.initialize({ exports: { memory } });
  wasi.wasiImport.args_sizes_get(0, 4);
  expect(new DataView(memory.buffer).getUint32(0, true)).toBe(2);
});

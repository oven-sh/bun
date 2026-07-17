import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";
import { WASI } from "node:wasi";

// Builds a minimal wasi_snapshot_preview1 module that imports proc_exit and exports
// memory + _start. startBody is the raw body of _start (import 0 = proc_exit).
function craftProcExitModule(startBody) {
  const u = x => {
    const a = [];
    do {
      let c = x & 127;
      x >>>= 7;
      if (x) c |= 128;
      a.push(c);
    } while (x);
    return a;
  };
  const str = s => [...u(s.length), ...[...s].map(c => c.charCodeAt(0))];
  const sec = (id, b) => [id, ...u(b.length), ...b];
  const type = [2, 0x60, 1, 0x7f, 0, 0x60, 0, 0];
  const imp = [1, ...str("wasi_snapshot_preview1"), ...str("proc_exit"), 0, 0];
  const func = [1, 1];
  const mem = [1, 0, 1];
  const exp = [2, ...str("_start"), 0, 1, ...str("memory"), 2, 0];
  const body = [0, ...startBody, 0x0b];
  const code = [1, ...u(body.length), ...body];
  return new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...sec(1, type),
    ...sec(2, imp),
    ...sec(3, func),
    ...sec(5, mem),
    ...sec(7, exp),
    ...sec(10, code),
  ]);
}

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

describe.concurrent("proc_exit / returnOnExit", () => {
  // _start body: i32.const 7; call 0 (proc_exit); drop-unreachable-padding not needed
  const START_EXIT_7 = [0x41, 7, 0x10, 0];

  async function run(opts, startBody) {
    const bytes = craftProcExitModule(startBody);
    const childSrc = /* js */ `
      const { WASI } = require("node:wasi");
      const wasi = new WASI(${JSON.stringify(opts)});
      const bytes = Uint8Array.from(${JSON.stringify([...bytes])});
      const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
        wasi_snapshot_preview1: wasi.wasiImport,
      });
      const ret = wasi.start(instance);
      console.log("AFTER-START ret=" + ret);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", childSrc],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("returnOnExit: true makes start() return the guest's exit code", async () => {
    const { stdout, stderr, exitCode } = await run({ version: "preview1", returnOnExit: true }, START_EXIT_7);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "AFTER-START ret=7\n", stderr: "", exitCode: 0 });
  });

  it("returnOnExit defaults to true", async () => {
    const { stdout, stderr, exitCode } = await run({ version: "preview1" }, START_EXIT_7);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "AFTER-START ret=7\n", stderr: "", exitCode: 0 });
  });

  it("returnOnExit: false terminates the host process with the guest's exit code", async () => {
    const { stdout, exitCode } = await run({ version: "preview1", returnOnExit: false }, START_EXIT_7);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 7 });
  });

  it("start() returns 0 when _start returns without calling proc_exit", async () => {
    const { stdout, stderr, exitCode } = await run({ version: "preview1", returnOnExit: true }, []);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "AFTER-START ret=0\n", stderr: "", exitCode: 0 });
  });

  it("start() rethrows traps that are not proc_exit", () => {
    const bytes = craftProcExitModule([0x00]); // unreachable
    const wasi = new WASI({ version: "preview1", returnOnExit: true });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    expect(() => wasi.start(instance)).toThrow(WebAssembly.RuntimeError);
  });

  it.each(["yes", null, 1])("validates returnOnExit is a boolean (%p)", value => {
    expect(() => new WASI({ version: "preview1", returnOnExit: value })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  it("`bun file.wasm` still exits with the guest's proc_exit code", async () => {
    using dir = tempDir("wasi-runner-exit", {
      "exit7.wasm": craftProcExitModule(START_EXIT_7),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exit7.wasm"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 7 });
  });
});

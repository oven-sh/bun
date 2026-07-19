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

it("random_get fills the guest buffer and returns success", () => {
  const wasi = new WASI({});
  // 2 pages so the request can exceed getRandomValues' 65536-byte limit.
  wasi.setMemory(new WebAssembly.Memory({ initial: 2 }));

  const WASI_ESUCCESS = 0;
  const CHUNK = 65536;
  const bufPtr = 8;
  const bufLen = 70000; // > CHUNK to exercise the chunking loop
  const guardBefore = bufPtr - 4;
  const guardAfter = bufPtr + bufLen;

  const bytes = new Uint8Array(wasi.memory.buffer);
  bytes[guardBefore] = 0xab;
  bytes[guardAfter] = 0xcd;

  // Stub the RNG so the write is deterministic: each byte is a non-zero value
  // derived from its absolute offset, so a partial or misplaced write is caught.
  const fillByte = offset => (offset % 255) + 1;
  const calls = [];
  const realGetRandomValues = crypto.getRandomValues;
  crypto.getRandomValues = view => {
    calls.push({ byteOffset: view.byteOffset, byteLength: view.byteLength });
    for (let i = 0; i < view.length; i++) view[i] = fillByte(view.byteOffset + i);
    return view;
  };

  try {
    expect(wasi.wasiImport.random_get(bufPtr, bufLen)).toBe(WASI_ESUCCESS);
  } finally {
    crypto.getRandomValues = realGetRandomValues;
  }

  // The whole region must be filled with exactly the expected chunks, in order.
  expect(calls).toEqual([
    { byteOffset: bufPtr, byteLength: CHUNK },
    { byteOffset: bufPtr + CHUNK, byteLength: bufLen - CHUNK },
  ]);

  // Every byte of the requested region must carry its expected value.
  const expected = new Uint8Array(bufLen);
  for (let i = 0; i < bufLen; i++) expected[i] = fillByte(bufPtr + i);
  expect(new Uint8Array(wasi.memory.buffer, bufPtr, bufLen)).toEqual(expected);

  // Bytes just outside the requested region must be untouched.
  expect(bytes[guardBefore]).toBe(0xab);
  expect(bytes[guardAfter]).toBe(0xcd);
});

it("random_get returns EINVAL for out-of-bounds guest memory instead of throwing", () => {
  const wasi = new WASI({});
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const byteLength = wasi.memory.buffer.byteLength;

  const WASI_ESUCCESS = 0;
  const WASI_EINVAL = 28;

  // A range that runs past the end of guest memory must not throw a RangeError.
  expect(wasi.wasiImport.random_get(byteLength - 4, 8)).toBe(WASI_EINVAL);
  expect(wasi.wasiImport.random_get(byteLength + 1, 4)).toBe(WASI_EINVAL);
  expect(wasi.wasiImport.random_get(-1, 4)).toBe(WASI_EINVAL);
  expect(wasi.wasiImport.random_get(0, -1)).toBe(WASI_EINVAL);

  // A range that ends exactly at the boundary is still valid.
  expect(wasi.wasiImport.random_get(byteLength - 8, 8)).toBe(WASI_ESUCCESS);
});

it("getImportObject returns wasi_snapshot_preview1 by default", () => {
  const wasi = new WASI({});
  const importObject = wasi.getImportObject();
  expect(Object.keys(importObject)).toEqual(["wasi_snapshot_preview1"]);
  expect(importObject.wasi_snapshot_preview1).toBe(wasi.wasiImport);
});

it("getImportObject respects version: 'preview1'", () => {
  const wasi = new WASI({ version: "preview1" });
  const importObject = wasi.getImportObject();
  expect(Object.keys(importObject)).toEqual(["wasi_snapshot_preview1"]);
  expect(importObject.wasi_snapshot_preview1).toBe(wasi.wasiImport);
});

it("getImportObject respects version: 'unstable'", () => {
  const wasi = new WASI({ version: "unstable" });
  const importObject = wasi.getImportObject();
  expect(Object.keys(importObject)).toEqual(["wasi_unstable"]);
  expect(importObject.wasi_unstable).toBe(wasi.wasiImport);
});

it("WASI throws for an unsupported version", () => {
  expect(() => new WASI({ version: "bogus" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
});

it("getImportObject provides every import a WASI module needs", async () => {
  // hello-wasi.wasm imports from the wasi_unstable namespace.
  const wasi = new WASI({ version: "unstable" });
  const bytes = fs.readFileSync(path.join(import.meta.dir, "hello-wasi.wasm"));
  // A missing import throws a LinkError, so instantiating proves completeness.
  const { instance } = await WebAssembly.instantiate(bytes, wasi.getImportObject());
  expect(typeof instance.exports._start).toBe("function");
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

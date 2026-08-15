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

const WASI_ESUCCESS = 0;
const WASI_EOVERFLOW = 61;

it("fd_write/fd_read return EOVERFLOW for out-of-bounds iovecs instead of throwing or writing to the host", async () => {
  // Runs in a subprocess so the assertion can also cover what reaches the host's
  // stdout/stderr: previously some of these shapes printed a debug object, some
  // wrote the (truncated) guest bytes to fd 2, and the rest threw a RangeError
  // out of the hostcall. Node.js returns WASI_EOVERFLOW (61) for every one of them.
  const src = `
    const { WASI } = require("node:wasi");
    const wasi = new WASI({ version: "preview1" });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    const END = wasi.memory.buffer.byteLength; // 65536
    const view = new DataView(wasi.memory.buffer);
    const iovec = (index, buf, len) => { view.setUint32(index * 8, buf, true); view.setUint32(index * 8 + 4, len, true); };
    const probe = (name, fn, ...args) => {
      let result;
      try { result = wasi.wasiImport[fn](...args); } catch (e) { result = "threw " + e.constructor.name; }
      console.log(name, result);
    };
    // Every iovec below that is in bounds points at this marker, so any bytes
    // written to the host by a call that reported an error show up in stderr.
    const marker = Buffer.from(wasi.memory.buffer).write("LEAKED\\n", 1024);
    const NWRITTEN = 256;

    probe("iovec-array-oob", "fd_write", 2, END - 2, 1, NWRITTEN);
    probe("iovec-array-past-end", "fd_write", 2, END, 0, NWRITTEN);
    probe("iovec-array-too-long", "fd_write", 2, 0, 0x10000000, NWRITTEN);
    // A pointer or length >= 2**31 reaches the host from a wasm guest as a
    // negative i32. Nothing that large is addressable, so it is EOVERFLOW too.
    probe("iovec-array-negative-ptr", "fd_write", 2, -8, 1, NWRITTEN);
    probe("iovec-array-negative-len", "fd_write", 2, 0, -1, NWRITTEN);

    iovec(0, END + 1000, 10);
    probe("buf-oob", "fd_write", 2, 0, 1, NWRITTEN);
    iovec(0, END, 0);
    probe("empty-buf-past-end", "fd_write", 2, 0, 1, NWRITTEN);
    iovec(0, END - 6, 4096);
    probe("len-overrun", "fd_write", 2, 0, 1, NWRITTEN);
    iovec(0, 1024, marker);
    iovec(1, END - 6, 4096);
    probe("len-overrun-second-iovec", "fd_write", 2, 0, 2, NWRITTEN);

    iovec(0, 1024, marker);
    probe("nwritten-oob", "fd_write", 2, 0, 1, END + 1000);
    probe("nwritten-partially-oob", "fd_write", 2, 0, 1, END - 3);
    probe("nwritten-negative", "fd_write", 2, 0, 1, -4);

    // fd_read shares the decoder. Only shapes that are rejected before any read
    // is attempted are used here so the probe never waits on the host's stdin.
    probe("fd_read-iovec-array-oob", "fd_read", 0, END - 2, 1, NWRITTEN);
    iovec(0, 1024, 0);
    probe("fd_read-nread-oob", "fd_read", 0, 0, 1, END + 1000);

    // Hostcalls that write a struct through a guest pointer get the same errno
    // instead of throwing a RangeError into the host.
    probe("fd_fdstat_get-buf-oob", "fd_fdstat_get", 0, END + 1000);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const cases = [
    "iovec-array-oob",
    "iovec-array-past-end",
    "iovec-array-too-long",
    "iovec-array-negative-ptr",
    "iovec-array-negative-len",
    "buf-oob",
    "empty-buf-past-end",
    "len-overrun",
    "len-overrun-second-iovec",
    "nwritten-oob",
    "nwritten-partially-oob",
    "nwritten-negative",
    "fd_read-iovec-array-oob",
    "fd_read-nread-oob",
    "fd_fdstat_get-buf-oob",
  ];
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: cases.map(name => `${name} ${WASI_EOVERFLOW}\n`).join(""),
    stderr: "",
    exitCode: 0,
  });
});

it("fd_write accepts iovecs, iovec arrays and output pointers that end exactly at the end of memory", () => {
  const chunks = [];
  const wasi = new WASI({ sendStdout: bytes => chunks.push(Buffer.from(bytes).toString()) });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const END = wasi.memory.buffer.byteLength;
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);
  const iovec = (ptr, buf, len) => {
    view.setUint32(ptr, buf, true);
    view.setUint32(ptr + 4, len, true);
  };
  const nwritten = ptr => view.getUint32(ptr, true);
  const WASI_STDOUT = 1;
  memory.write("mid", 1024);
  memory.write("end", END - 3);

  const results = [];
  iovec(0, END - 3, 3);
  results.push(["buf ends at end of memory", wasi.wasiImport.fd_write(WASI_STDOUT, 0, 1, 256), nwritten(256)]);
  iovec(END - 8, 1024, 3);
  results.push([
    "iovec array ends at end of memory",
    wasi.wasiImport.fd_write(WASI_STDOUT, END - 8, 1, 256),
    nwritten(256),
  ]);
  iovec(0, 1024, 3);
  results.push([
    "nwritten ends at end of memory",
    wasi.wasiImport.fd_write(WASI_STDOUT, 0, 1, END - 4),
    nwritten(END - 4),
  ]);
  results.push([
    "empty iovec array at last byte",
    wasi.wasiImport.fd_write(WASI_STDOUT, END - 1, 0, 256),
    nwritten(256),
  ]);
  iovec(0, END - 1, 0);
  results.push(["empty buf at last byte", wasi.wasiImport.fd_write(WASI_STDOUT, 0, 1, 256), nwritten(256)]);

  expect(results).toEqual([
    ["buf ends at end of memory", WASI_ESUCCESS, 3],
    ["iovec array ends at end of memory", WASI_ESUCCESS, 3],
    ["nwritten ends at end of memory", WASI_ESUCCESS, 3],
    ["empty iovec array at last byte", WASI_ESUCCESS, 0],
    ["empty buf at last byte", WASI_ESUCCESS, 0],
  ]);
  expect(chunks).toEqual(["end", "mid", "mid"]);
});

it("fd_read returns EOVERFLOW for an out-of-bounds nread pointer before consuming any input", () => {
  let stdinReads = 0;
  const wasi = new WASI({
    getStdin: () => {
      stdinReads++;
      return Buffer.from("input");
    },
  });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const END = wasi.memory.buffer.byteLength;
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);
  const WASI_STDIN = 0;
  const iovsPtr = 0;
  const bufPtr = 1024;
  const nreadPtr = 256;
  view.setUint32(iovsPtr, bufPtr, true);
  view.setUint32(iovsPtr + 4, 5, true);
  const destination = () => memory.toString("latin1", bufPtr, bufPtr + 5);

  expect(wasi.wasiImport.fd_read(WASI_STDIN, iovsPtr, 1, END + 1000)).toBe(WASI_EOVERFLOW);
  expect({ stdinReads, destination: destination() }).toEqual({
    stdinReads: 0,
    destination: Buffer.alloc(5, 0).toString("latin1"),
  });

  expect(wasi.wasiImport.fd_read(WASI_STDIN, iovsPtr, 1, nreadPtr)).toBe(WASI_ESUCCESS);
  expect({ stdinReads, destination: destination(), nread: view.getUint32(nreadPtr, true) }).toEqual({
    stdinReads: 1,
    destination: "input",
    nread: 5,
  });
});

it("fd_pwrite/fd_pread return EOVERFLOW before touching the file or guest memory", () => {
  using dir = tempDir("wasi-pwrite-oob", {
    "data.txt": "original",
  });
  const file = path.join(String(dir), "data.txt");
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const END = wasi.memory.buffer.byteLength;
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const WASI_RIGHT_FD_WRITE = BigInt(64);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 2048;
  const iovsPtr = 4096;
  const dataPtr = 8192;
  const readPtr = 16384;
  const outPtr = 32768;
  const offset = BigInt(0);
  const iovec = (buf, len) => {
    view.setUint32(iovsPtr, buf, true);
    view.setUint32(iovsPtr + 4, len, true);
  };

  const pathLen = memory.write("data.txt", pathPtr);
  expect(
    wasi.wasiImport.path_open(
      preopenFd,
      0,
      pathPtr,
      pathLen,
      0,
      WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK | WASI_RIGHT_FD_WRITE,
      BigInt(0),
      0,
      fdPtr,
    ),
  ).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);
  const dataLen = memory.write("CLOBBERED", dataPtr);

  iovec(dataPtr, dataLen);
  expect(wasi.wasiImport.fd_pwrite(fd, iovsPtr, 1, offset, END + 1000)).toBe(WASI_EOVERFLOW);
  expect(wasi.wasiImport.fd_pwrite(fd, END + 1000, 1, offset, outPtr)).toBe(WASI_EOVERFLOW);
  iovec(dataPtr, END);
  expect(wasi.wasiImport.fd_pwrite(fd, iovsPtr, 1, offset, outPtr)).toBe(WASI_EOVERFLOW);
  expect(fs.readFileSync(file, "utf8")).toBe("original");

  iovec(dataPtr, dataLen);
  expect(wasi.wasiImport.fd_pwrite(fd, iovsPtr, 1, offset, outPtr)).toBe(WASI_ESUCCESS);
  expect(view.getUint32(outPtr, true)).toBe(dataLen);
  expect(fs.readFileSync(file, "utf8")).toBe("CLOBBERED");

  const destination = () => memory.toString("latin1", readPtr, readPtr + dataLen);
  const untouched = Buffer.alloc(dataLen, 0).toString("latin1");
  iovec(readPtr, dataLen);
  expect(wasi.wasiImport.fd_pread(fd, iovsPtr, 1, offset, END + 1000)).toBe(WASI_EOVERFLOW);
  expect(wasi.wasiImport.fd_pread(fd, END + 1000, 1, offset, outPtr)).toBe(WASI_EOVERFLOW);
  iovec(readPtr, END);
  expect(wasi.wasiImport.fd_pread(fd, iovsPtr, 1, offset, outPtr)).toBe(WASI_EOVERFLOW);
  expect(destination()).toBe(untouched);

  iovec(readPtr, dataLen);
  expect(wasi.wasiImport.fd_pread(fd, iovsPtr, 1, offset, outPtr)).toBe(WASI_ESUCCESS);
  expect(destination()).toBe("CLOBBERED");
  expect(wasi.wasiImport.fd_close(fd)).toBe(WASI_ESUCCESS);
});

it("path_open/fd_seek/fd_tell return EOVERFLOW for an out-of-bounds output pointer before opening or seeking", () => {
  using dir = tempDir("wasi-open-seek-oob", {
    "exists.txt": "0123456789",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const END = wasi.memory.buffer.byteLength;
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_O_CREAT = 1 << 0;
  const WASI_WHENCE_SET = 0;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const WASI_RIGHT_FD_TELL = BigInt(32);
  const rights = WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK | WASI_RIGHT_FD_TELL;
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 2048;
  const offsetPtr = 4096;
  const open = (name, oflags, outPtr) => {
    const len = memory.write(name, pathPtr);
    return wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, oflags, rights, BigInt(0), 0, outPtr);
  };
  const tell = fd => {
    expect(wasi.wasiImport.fd_tell(fd, offsetPtr)).toBe(WASI_ESUCCESS);
    return view.getBigUint64(offsetPtr, true);
  };

  const fdsBefore = [...wasi.FD_MAP.keys()];
  expect(open("exists.txt", 0, END + 1000)).toBe(WASI_EOVERFLOW);
  expect(open("exists.txt", 0, END - 3)).toBe(WASI_EOVERFLOW);
  expect(open("created.txt", WASI_O_CREAT, END + 1000)).toBe(WASI_EOVERFLOW);
  expect([...wasi.FD_MAP.keys()]).toEqual(fdsBefore);
  expect(fs.existsSync(path.join(String(dir), "created.txt"))).toBe(false);

  expect(open("exists.txt", 0, fdPtr)).toBe(WASI_ESUCCESS);
  const fd = view.getUint32(fdPtr, true);
  // A descriptor that has not been positioned yet reads through the host's file
  // position; a rejected fd_tell must not switch it to an explicit offset.
  expect(wasi.wasiImport.fd_tell(fd, END + 1000)).toBe(WASI_EOVERFLOW);
  expect(wasi.wasiImport.fd_tell(fd, END - 7)).toBe(WASI_EOVERFLOW);
  expect(wasi.FD_MAP.get(fd).offset).toBeUndefined();
  expect(wasi.wasiImport.fd_seek(fd, BigInt(5), WASI_WHENCE_SET, END + 1000)).toBe(WASI_EOVERFLOW);
  expect(wasi.wasiImport.fd_seek(fd, BigInt(5), WASI_WHENCE_SET, END - 7)).toBe(WASI_EOVERFLOW);
  expect(tell(fd)).toBe(BigInt(0));
  expect(wasi.wasiImport.fd_seek(fd, BigInt(5), WASI_WHENCE_SET, END - 8)).toBe(WASI_ESUCCESS);
  expect(view.getBigUint64(END - 8, true)).toBe(BigInt(5));
  expect(tell(fd)).toBe(BigInt(5));
  expect(wasi.wasiImport.fd_close(fd)).toBe(WASI_ESUCCESS);
});

it("path_* hostcalls return EOVERFLOW when the path itself lies outside of memory", () => {
  using dir = tempDir("wasi-path-oob", {
    "data.txt": "x",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const END = wasi.memory.buffer.byteLength;
  const preopenFd = 3;
  const statBufPtr = 4096;

  expect(wasi.wasiImport.path_filestat_get(preopenFd, 0, END + 1000, 8, statBufPtr)).toBe(WASI_EOVERFLOW);
  expect(wasi.wasiImport.path_filestat_get(preopenFd, 0, END - 4, 8, statBufPtr)).toBe(WASI_EOVERFLOW);
  expect(wasi.wasiImport.path_create_directory(preopenFd, END + 1000, 8)).toBe(WASI_EOVERFLOW);
  expect(fs.readdirSync(String(dir))).toEqual(["data.txt"]);
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

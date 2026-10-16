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

it("path_open resolves dev/tty and proc/* in the preopen like any other path", () => {
  using dir = tempDir("wasi-path-open-names", {
    "full/dev/tty": "the file dev/tty",
    "full/proc/version": "the file proc/version",
    "empty": {},
  });
  const wasi = new WASI({
    preopens: { "/full": path.join(String(dir), "full"), "/empty": path.join(String(dir), "empty") },
  });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_ENOENT = 44;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const fullFd = 3;
  const emptyFd = 4;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const iovsPtr = 2048;
  const nreadPtr = 3072;
  const bufPtr = 4096;
  const sentinel = 0x12345678;

  const open = (dirfd, guestPath) => {
    const len = memory.write(guestPath, pathPtr);
    view.setUint32(fdPtr, sentinel, true);
    const errno = wasi.wasiImport.path_open(dirfd, 0, pathPtr, len, 0, WASI_RIGHT_FD_READ, BigInt(0), 0, fdPtr);
    return { errno, fd: view.getUint32(fdPtr, true) };
  };
  const read = fd => {
    view.setUint32(iovsPtr, bufPtr, true);
    view.setUint32(iovsPtr + 4, 64, true);
    expect(wasi.wasiImport.fd_read(fd, iovsPtr, 1, nreadPtr)).toBe(WASI_ESUCCESS);
    return memory.toString("latin1", bufPtr, bufPtr + view.getUint32(nreadPtr, true));
  };

  // Each file exists in the preopen: the guest gets a new descriptor for that file.
  expect(open(fullFd, "dev/tty")).toEqual({ errno: WASI_ESUCCESS, fd: 5 });
  expect(read(5)).toBe("the file dev/tty");
  expect(open(fullFd, "proc/version")).toEqual({ errno: WASI_ESUCCESS, fd: 6 });
  expect(read(6)).toBe("the file proc/version");

  // No such file in the preopen: ENOENT, and no descriptor.
  expect({
    "empty: dev/tty": open(emptyFd, "dev/tty"),
    "empty: proc/version": open(emptyFd, "proc/version"),
    "full: proc/missing": open(fullFd, "proc/missing"),
  }).toEqual({
    "empty: dev/tty": { errno: WASI_ENOENT, fd: sentinel },
    "empty: proc/version": { errno: WASI_ENOENT, fd: sentinel },
    "full: proc/missing": { errno: WASI_ENOENT, fd: sentinel },
  });
  expect([...wasi.FD_MAP.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

it.skipIf(isWindows)("path_open opens the host's /dev/tty as a terminal descriptor", async () => {
  // The child has a pty as its controlling terminal. It opens dev/tty on a preopen of the host "/",
  // as a wasi-libc guest under `bun file.wasm` does, and reads one line from the new descriptor.
  const childSrc = `
    const { WASI } = require("node:wasi");
    const wasi = new WASI({ preopens: { "/": "/" } });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    const memory = Buffer.from(wasi.memory.buffer);
    const view = new DataView(wasi.memory.buffer);
    const FD_READ = 2n, FD_SEEK = 4n, FD_TELL = 32n;
    const WHENCE_CUR = 1;
    const pathPtr = 1024, fdPtr = 1536, statPtr = 2048, offsetPtr = 3072, iovsPtr = 4096, nreadPtr = 5120, bufPtr = 8192;

    const len = memory.write("dev/tty", pathPtr);
    const errno = wasi.wasiImport.path_open(3, 0, pathPtr, len, 0, FD_READ | FD_SEEK | FD_TELL, 0n, 0, fdPtr);
    const result = { errno, fd: view.getUint32(fdPtr, true) };
    // Descriptors 0 to 2 are the stdio of this process: do not read them.
    if (errno === 0 && result.fd > 2) {
      wasi.wasiImport.fd_fdstat_get(result.fd, statPtr);
      const rightsBase = view.getBigUint64(statPtr + 8, true);
      result.filetype = view.getUint8(statPtr);
      result.seekRight = (rightsBase & FD_SEEK) !== 0n;
      result.tellRight = (rightsBase & FD_TELL) !== 0n;
      result.seekRefused = wasi.wasiImport.fd_seek(result.fd, 0n, WHENCE_CUR, offsetPtr) !== 0;
      process.stdout.write("READY\\n");
      view.setUint32(iovsPtr, bufPtr, true);
      view.setUint32(iovsPtr + 4, 64, true);
      result.readErrno = wasi.wasiImport.fd_read(result.fd, iovsPtr, 1, nreadPtr);
      result.line = memory.toString("latin1", bufPtr, bufPtr + view.getUint32(nreadPtr, true));
    }
    process.stdout.write("RESULT " + JSON.stringify(result) + "\\n");
  `;

  const WASI_FILETYPE_CHARACTER_DEVICE = 2;
  const decoder = new TextDecoder();
  const result = Promise.withResolvers();
  let output = "";
  let typed = false;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", childSrc],
    env: bunEnv,
    terminal: {
      data(terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
        if (!typed && output.includes("READY")) {
          typed = true;
          terminal.write("typed line\n");
        }
        const match = output.match(/RESULT (\{.*\})\r?\n/);
        if (match) result.resolve(JSON.parse(match[1]));
      },
      exit() {
        result.reject(new Error("the child printed no RESULT line: " + JSON.stringify(output)));
      },
    },
  });

  expect(await result.promise).toEqual({
    errno: 0,
    fd: 4,
    filetype: WASI_FILETYPE_CHARACTER_DEVICE,
    seekRight: false,
    tellRight: false,
    seekRefused: true,
    readErrno: 0,
    line: "typed line\n",
  });
  expect(await proc.exited).toBe(0);
});

it("fd_renumber moves the source descriptor onto the target descriptor", () => {
  using dir = tempDir("wasi-fd-renumber", {
    "a.txt": "file a",
    "b.txt": "file b",
  });
  const wasi = new WASI({ preopens: { "/": String(dir) } });
  wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
  const memory = Buffer.from(wasi.memory.buffer);
  const view = new DataView(wasi.memory.buffer);

  const WASI_ESUCCESS = 0;
  const WASI_EBADF = 8;
  const WASI_RIGHT_FD_READ = BigInt(2);
  const WASI_RIGHT_FD_SEEK = BigInt(4);
  const preopenFd = 3;
  const pathPtr = 1024;
  const fdPtr = 1536;
  const iovsPtr = 2048;
  const nreadPtr = 3072;
  const bufPtr = 4096;

  const open = guestPath => {
    const len = memory.write(guestPath, pathPtr);
    const rights = WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK;
    expect(wasi.wasiImport.path_open(preopenFd, 0, pathPtr, len, 0, rights, BigInt(0), 0, fdPtr)).toBe(WASI_ESUCCESS);
    return view.getUint32(fdPtr, true);
  };
  // The whole file from offset 0, or the errno.
  const read = fd => {
    view.setUint32(iovsPtr, bufPtr, true);
    view.setUint32(iovsPtr + 4, 64, true);
    const errno = wasi.wasiImport.fd_pread(fd, iovsPtr, 1, BigInt(0), nreadPtr);
    return errno === WASI_ESUCCESS ? memory.toString("latin1", bufPtr, bufPtr + view.getUint32(nreadPtr, true)) : errno;
  };

  const fdA = open("a.txt");
  const fdB = open("b.txt");
  expect({ fdA: read(fdA), fdB: read(fdB) }).toEqual({ fdA: "file a", fdB: "file b" });

  // fdA now names the file of fdB, and fdB is closed.
  expect(wasi.wasiImport.fd_renumber(fdB, fdA)).toBe(WASI_ESUCCESS);
  expect({ fdA: read(fdA), fdB: read(fdB) }).toEqual({ fdA: "file b", fdB: WASI_EBADF });

  // The same descriptor on both sides changes nothing. Node.js compares the two numbers before it looks
  // at the table, so this also holds for a descriptor that is not open.
  expect(wasi.wasiImport.fd_renumber(fdA, fdA)).toBe(WASI_ESUCCESS);
  expect(wasi.wasiImport.fd_renumber(fdB, fdB)).toBe(WASI_ESUCCESS);
  expect(read(fdA)).toBe("file b");

  // A descriptor that is not open, on each side: EBADF, and fdA stays.
  expect(wasi.wasiImport.fd_renumber(fdB, fdA)).toBe(WASI_EBADF);
  expect(wasi.wasiImport.fd_renumber(fdA, fdB)).toBe(WASI_EBADF);
  expect(read(fdA)).toBe("file b");
});

it("a file that fd_renumber moves onto descriptor 0 or 2 gets the I/O, not getStdin or sendStderr", async () => {
  using dir = tempDir("wasi-renumber-stdio", {
    "in.txt": "from the file\n",
    "out.txt": "",
  });
  // fd_renumber closes the host descriptor of its target, here 0 and 2 of the child. The child reports on stdout.
  const childSrc = `
    const { WASI } = require("node:wasi");
    const fs = require("node:fs");
    const hooked = [];
    const wasi = new WASI({
      preopens: { "/": process.cwd() },
      getStdin: () => Buffer.from("from the hook\\n"),
      sendStderr: chunk => hooked.push(Buffer.from(chunk).toString()),
    });
    wasi.setMemory(new WebAssembly.Memory({ initial: 1 }));
    const memory = Buffer.from(wasi.memory.buffer);
    const view = new DataView(wasi.memory.buffer);
    const FD_READ = 2n, FD_WRITE = 64n;
    const pathPtr = 1024, fdPtr = 1536, iovsPtr = 2048, countPtr = 3072, bufPtr = 4096;

    const open = (guestPath, rights) => {
      const len = memory.write(guestPath, pathPtr);
      const errno = wasi.wasiImport.path_open(3, 0, pathPtr, len, 0, rights, 0n, 0, fdPtr);
      if (errno !== 0) throw new Error("path_open " + guestPath + ": errno " + errno);
      return view.getUint32(fdPtr, true);
    };
    const read = fd => {
      view.setUint32(iovsPtr, bufPtr, true);
      view.setUint32(iovsPtr + 4, 64, true);
      const errno = wasi.wasiImport.fd_read(fd, iovsPtr, 1, countPtr);
      return errno === 0 ? memory.toString("latin1", bufPtr, bufPtr + view.getUint32(countPtr, true)) : errno;
    };
    const write = (fd, text) => {
      const len = memory.write(text, bufPtr);
      view.setUint32(iovsPtr, bufPtr, true);
      view.setUint32(iovsPtr + 4, len, true);
      return wasi.wasiImport.fd_write(fd, iovsPtr, 1, countPtr);
    };

    const before = { read0: read(0), write2: write(2, "to the hook\\n"), hooked: hooked.splice(0) };
    const renumber = [
      wasi.wasiImport.fd_renumber(open("in.txt", FD_READ), 0),
      wasi.wasiImport.fd_renumber(open("out.txt", FD_WRITE), 2),
    ];
    const after = { read0: read(0), write2: write(2, "to the file\\n"), hooked: hooked.splice(0) };
    console.log(JSON.stringify({ before, renumber, after, outTxt: fs.readFileSync("out.txt", "utf8") }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", childSrc],
    env: bunEnv,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    before: { read0: "from the hook\n", write2: 0, hooked: ["to the hook\n"] },
    renumber: [0, 0],
    after: { read0: "from the file\n", write2: 0, hooked: [] },
    outTxt: "to the file\n",
  });
  expect(exitCode).toBe(0);
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

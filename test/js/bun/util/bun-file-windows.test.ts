import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import fs, { closeSync, openSync } from "fs";
import { open } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";

test('Bun.file("/dev/null") works on windows', async () => {
  expect(await Bun.file("/dev/null").arrayBuffer()).toHaveLength(0);
});

test('openSync("/dev/null") works on windows', async () => {
  const handle = openSync("/dev/null", "r");
  closeSync(handle);
});

test('open("/dev/null") works on windows', async () => {
  const handle = await open("/dev/null", "r");
  await handle.close();
});

function openFile(path: string, flags: string) {
  const fd = openSync(path, flags);
  return { fd, [Symbol.dispose]: () => closeSync(fd) };
}

function readThreeBytes(fd: number) {
  const buffer = Buffer.alloc(3);
  return buffer.toString("utf8", 0, fs.readSync(fd, buffer));
}

function captureError(promise: Promise<unknown>) {
  return promise.then(
    resolved => ({ resolved }),
    ({ code, syscall, path, fd }) => ({ code, syscall, path, fd }),
  );
}

const { symbols: kernel32 } = isWindows
  ? dlopen("kernel32.dll", {
      CreatePipe: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" },
      CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "i64" },
      CloseHandle: { args: ["i64"], returns: "i32" },
      WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
    })
  : ({ symbols: {} } as any);

function createPipe() {
  const handles = new BigUint64Array(2);
  expect(kernel32.CreatePipe(ptr(handles), ptr(handles, 8), null, 0)).not.toBe(0);
  const readFd = fs.createReadStream(null as any, { windowsHandle: handles[0], autoClose: false } as any).fd as number;
  const writeFd = fs.createWriteStream(null as any, { windowsHandle: handles[1], autoClose: false } as any)
    .fd as number;
  const openFds = new Set([readFd, writeFd]);
  const close = (fd: number) => openFds.delete(fd) && closeSync(fd);
  return { readFd, readHandle: handles[0], writeFd, close, [Symbol.dispose]: () => [...openFds].forEach(close) };
}

function createPattern(size: number) {
  return Buffer.alloc(size, "0123456789abcdefghijklmnopqrstuvwxyz!");
}

describe.skipIf(!isWindows)("Bun.file() reads", () => {
  test("reads an fd from the start and preserves its file position", async () => {
    using dir = tempDir("bun-file-position", { file: "0123456789" });
    using file = openFile(join(String(dir), "file"), "r");
    expect(readThreeBytes(file.fd)).toBe("012");
    expect(await Bun.file(file.fd).text()).toBe("0123456789");
    expect(await Bun.file(file.fd).slice(0, 4).text()).toBe("0123");
    expect(readThreeBytes(file.fd)).toBe("345");
  });

  test("leaves the file position of an fd at the start of a slice", async () => {
    using dir = tempDir("bun-file-slice-position", { file: "0123456789" });
    using file = openFile(join(String(dir), "file"), "r");
    expect(await Bun.file(file.fd).slice(5, 7).text()).toBe("56");
    expect(readThreeBytes(file.fd)).toBe("567");
    expect(await Bun.file(file.fd).slice(50).text()).toBe("");
    expect(readThreeBytes(file.fd)).toBe("");
  });

  test("read errors report code, syscall and path", async () => {
    using dir = tempDir("bun-file-read-errors", { file: "x", subdir: {} });
    using writeOnly = openFile(join(String(dir), "file"), "a");
    using directory = openFile(join(String(dir), "subdir"), "r");
    expect({
      missing: await captureError(Bun.file(join(String(dir), "missing")).text()),
      directory: await captureError(Bun.file(join(String(dir), "subdir")).text()),
      directoryFd: await captureError(Bun.file(directory.fd).text()),
      writeOnlyFd: await captureError(Bun.file(writeOnly.fd).text()),
      invalidFd: await captureError(Bun.file(4000).text()),
    }).toEqual({
      missing: { code: "ENOENT", syscall: "open", path: join(String(dir), "missing") },
      directory: { code: "EISDIR", syscall: "read", path: join(String(dir), "subdir") },
      directoryFd: { code: "EISDIR", syscall: "read" },
      writeOnlyFd: { code: "EBADF", syscall: "read" },
      invalidFd: { code: "EBADF", syscall: "fstat" },
    });
  });

  test("lastModified is refreshed by a read", async () => {
    using dir = tempDir("bun-file-last-modified", { file: "x" });
    const path = join(String(dir), "file");
    fs.utimesSync(path, 1000, 1000);
    const file = Bun.file(path);
    expect(file.lastModified).toBe(1_000_000);
    fs.utimesSync(path, 2000, 2000);
    expect(file.lastModified).toBe(1_000_000);
    await file.slice(0, 1).text();
    expect(file.lastModified).toBe(2_000_000);
  });

  test("an empty slice of a pipe does not wait for input", async () => {
    using pipe = createPipe();
    expect(await Bun.file(pipe.readFd).slice(0, 0).text()).toBe("");
  });
});

describe.skipIf(!isWindows)("Bun.write(destination, bytes)", () => {
  test("write errors report code, syscall and path or fd", async () => {
    using dir = tempDir("bun-write-errors", { file: "x", readonly: "x", subdir: {} });
    const tempPath = (...segments: string[]) => join(String(dir), ...segments);
    fs.chmodSync(tempPath("readonly"), 0o444);
    using readOnly = openFile(tempPath("file"), "r");
    expect({
      missingParent: await captureError(Bun.write(tempPath("a", "b"), "x", { createPath: false })),
      parentIsFile: await captureError(Bun.write(tempPath("file", "a"), "x")),
      ancestorIsFile: await captureError(Bun.write(tempPath("file", "a", "b"), "x")),
      directory: await captureError(Bun.write(tempPath("subdir"), "x")),
      readOnlyFile: await captureError(Bun.write(tempPath("readonly"), "x")),
      readOnlyFd: await captureError(Bun.write(readOnly.fd, "x")),
      invalidFd: await captureError(Bun.write(4000, "x")),
    }).toEqual({
      missingParent: { code: "ENOENT", syscall: "open", path: tempPath("a", "b") },
      parentIsFile: { code: "EEXIST", syscall: "mkdir", path: tempPath("file", "a") },
      ancestorIsFile: { code: "ENOTDIR", syscall: "mkdir", path: tempPath("file", "a", "b") },
      directory: { code: "EISDIR", syscall: "open", path: tempPath("subdir") },
      readOnlyFile: { code: "EPERM", syscall: "open", path: tempPath("readonly") },
      readOnlyFd: { code: "EBADF", syscall: "write", fd: readOnly.fd },
      invalidFd: { code: "EBADF", syscall: "write", fd: 4000 },
    });
  });

  test("an error of a stream write reports the path", async () => {
    const body = new Response(new ReadableStream({ pull: controller => controller.enqueue(new Uint8Array(1)) }));
    expect(await captureError(Bun.write("a*", body))).toMatchObject({ code: "ENOENT", path: "a*" });
  });

  test("writes to a path longer than MAX_PATH", async () => {
    using dir = tempDir("bun-write-long-path", {});
    const longName = Buffer.alloc(200, "a").toString();
    await Bun.write(join(String(dir), longName, longName), "x");
    expect(fs.readdirSync(String(dir), { recursive: true }).sort()).toEqual([longName, join(longName, longName)]);
  });

  test.each(["file.", "file "])("stream() reads what was written to the absolute name %j", async name => {
    using dir = tempDir("bun-write-trailing-dot", { file: "other" });
    await Bun.write(join(String(dir), name), "written");
    expect(await new Response(Bun.file(join(String(dir), name)).stream()).text()).toBe("written");
  });

  test("the file is closed when the promise resolves", async () => {
    using dir = tempDir("bun-write-closed", {});
    const path = join(String(dir), "file");
    const GENERIC_READ = 0x80000000;
    const OPEN_EXISTING = 3;
    let failedOpenCount = 0;
    for (let i = 0; i < 50; i++) {
      await Bun.write(path, "x");
      await Bun.file(path).text();
      const handle = kernel32.CreateFileW(
        Buffer.from(path + "\0", "utf16le"),
        GENERIC_READ,
        0,
        null,
        OPEN_EXISTING,
        0,
        null,
      );
      if (handle === -1n) failedOpenCount++;
      else kernel32.CloseHandle(handle);
    }
    expect(failedOpenCount).toBe(0);
  });

  test.each(["process.exit()", "terminate()"])("a Worker completes pending writes on %s", async exitMethod => {
    using dir = tempDir("bun-write-worker-exit", { source: "copied" });
    using pipe = createPipe();
    const worker = new Worker(
      `const { parentPort, workerData: { dir, exitMethod, fd } } = require("node:worker_threads");
       for (let i = 0; i < 100; i++) {
         Bun.write(dir + "/written-" + i, "written");
         Bun.write(dir + "/subdir-" + i + "/written", "written");
         Bun.write(dir + "/copied-" + i, Bun.file(dir + "/source"));
         Bun.write(fd, "written");
         Bun.write(fd, Bun.file(dir + "/source"));
       }
       if (exitMethod === "process.exit()") process.exit(0);
       parentPort.on("message", () => {});
       parentPort.postMessage("started");`,
      { eval: true, workerData: { dir: String(dir), exitMethod, fd: pipe.writeFd } },
    );
    worker.once("message", () => worker.terminate());
    await once(worker, "exit");
    const contents = new Set<string>();
    for (let i = 0; i < 100; i++) {
      for (const name of [`written-${i}`, `subdir-${i}/written`, `copied-${i}`]) {
        contents.add(fs.readFileSync(join(String(dir), name), "utf8"));
      }
    }
    expect([...contents]).toEqual(["written", "copied"]);
    pipe.close(pipe.writeFd);
    expect(await Bun.file(pipe.readFd).text()).toBe(Buffer.alloc(1300, "writtencopied").toString());
  });

  test.concurrent.each([
    "Bun.write(pipe, Buffer.alloc(1 << 18))",
    "Bun.write(pipe, Bun.file(source))",
    "Bun.file(pipe).writer().write(Buffer.alloc(1 << 18))",
  ])("a Worker that exits completes %s for a slow reader", async write => {
    using dir = tempDir("bun-write-worker-slow-reader", { source: Buffer.alloc(1 << 18) });
    using pipe = createPipe();
    const worker = new Worker(
      `const source = require("node:worker_threads").workerData, pipe = ${pipe.writeFd};
         ${write};
         process.exit(0);`,
      { eval: true, workerData: join(String(dir), "source") },
    );
    worker.once("exit", () => pipe.close(pipe.writeFd));
    let received = 0;
    // The 64 reads take longer than the 500 ms that an exit waits for.
    for (let bytesRead = -1; bytesRead !== 0; await Bun.sleep(12)) {
      ({ bytesRead } = await promisify(fs.read)(pipe.readFd, Buffer.alloc(4096), 0, 4096, null));
      received += bytesRead;
    }
    expect(received).toBe(1 << 18);
  });
});

describe.skipIf(!isWindows)("Bun.write(destination, Bun.file())", () => {
  test("path to path preserves mtime, and the mode option overrides the source mode", async () => {
    using dir = tempDir("bun-copy-metadata", { source: "x" });
    const tempPath = (name: string) => join(String(dir), name);
    fs.utimesSync(tempPath("source"), 1000, 1000);
    fs.chmodSync(tempPath("source"), 0o444);
    await Bun.write(tempPath("pipe"), Bun.file(tempPath("source")));
    await Bun.write(tempPath("writable"), Bun.file(tempPath("source")), { mode: 0o644 });
    expect(fs.statSync(tempPath("pipe"))).toMatchObject({ mtimeMs: 1_000_000, mode: 0o100444 });
    expect(fs.statSync(tempPath("writable"))).toMatchObject({ mode: 0o100666 });
  });

  test.each([
    ["path", "path"],
    ["link", "path"],
    ["path", "r"],
    ["link", "r"],
    ["path", "r+"],
    ["r+", "path"],
    ["a", "path"],
    ["a", "r"],
  ])("copying a file onto itself leaves it unchanged (to %s from %s)", async (destinationKind, sourceKind) => {
    using dir = tempDir("bun-copy-same-file", { path: "0123456789" });
    const path = join(String(dir), "path");
    fs.linkSync(path, join(String(dir), "link"));
    using stack = new DisposableStack();
    const createBlob = (kind: string) =>
      Bun.file(kind === "path" || kind === "link" ? join(String(dir), kind) : stack.use(openFile(path, kind)).fd);
    expect(await Bun.write(createBlob(destinationKind), createBlob(sourceKind))).toBe(10);
    expect(fs.readFileSync(path, "utf8")).toBe("0123456789");
  });

  test("fd to path copies the whole file and preserves the file position", async () => {
    using dir = tempDir("bun-copy-from-fd", {
      source: createPattern(2_500_000),
      longer: createPattern(2_600_000).reverse(),
    });
    using source = openFile(join(String(dir), "source"), "r");
    expect(readThreeBytes(source.fd)).toBe("012");
    for (const name of ["longer", join("new", "file")]) {
      expect(await Bun.write(join(String(dir), name), Bun.file(source.fd))).toBe(2_500_000);
      expect(fs.readFileSync(join(String(dir), name)).equals(createPattern(2_500_000))).toBe(true);
    }
    expect(await Bun.write(Bun.file(join(String(dir), "longer")).slice(0, 4), Bun.file(source.fd))).toBe(4);
    expect(fs.readFileSync(join(String(dir), "longer"), "utf8")).toBe("0123");
    expect(readThreeBytes(source.fd)).toBe("345");
  });

  test.each(["r", "r+", "a"])("fd (%s) to path preserves mtime and the source mode", async flags => {
    using dir = tempDir("bun-copy-fd-metadata", { source: "x" });
    using source = openFile(join(String(dir), "source"), flags);
    fs.utimesSync(join(String(dir), "source"), 1000, 1000);
    fs.chmodSync(join(String(dir), "source"), 0o444);
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(source.fd))).toBe(1);
    expect(fs.statSync(join(String(dir), "copy"))).toMatchObject({ mtimeMs: 1_000_000, mode: 0o100444 });
  });

  test("fd to a sliced path copies the slice length from a read-only file", async () => {
    using dir = tempDir("bun-copy-fd-slice", { source: "0123456789" });
    fs.chmodSync(join(String(dir), "source"), 0o444);
    using source = openFile(join(String(dir), "source"), "r");
    expect(await Bun.write(Bun.file(join(String(dir), "copy")).slice(0, 4), Bun.file(source.fd))).toBe(4);
    expect(fs.readFileSync(join(String(dir), "copy"), "utf8")).toBe("0123");
  });

  test("fd to path applies the mode option", async () => {
    using dir = tempDir("bun-write-fd-mode", { source: "abc" });
    using source = openFile(join(String(dir), "source"), "r");
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(source.fd), { mode: 0o444 })).toBe(3);
    expect(fs.statSync(join(String(dir), "copy")).mode & 0o777).toBe(0o444);
  });

  test("fd to pipe starts at the current file position", async () => {
    using dir = tempDir("bun-copy-fd-to-pipe", { source: "0123456789" });
    using source = openFile(join(String(dir), "source"), "r");
    using pipe = createPipe();
    expect(readThreeBytes(source.fd)).toBe("012");
    expect(await Bun.write(pipe.writeFd, Bun.file(source.fd))).toBe(7);
    pipe.close(pipe.writeFd);
    expect(await Bun.file(pipe.readFd).text()).toBe("3456789");
  });

  test("copies from an fd whose file was unlinked", async () => {
    using dir = tempDir("bun-copy-deleted", { source: "still here" });
    using source = openFile(join(String(dir), "source"), "r");
    fs.unlinkSync(join(String(dir), "source"));
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(source.fd))).toBe(10);
    expect(fs.readFileSync(join(String(dir), "copy"), "utf8")).toBe("still here");
  });

  test("copies from an fd whose file is waiting to be deleted", async () => {
    using dir = tempDir("bun-copy-delete-pending", { source: "still here" });
    using source = openFile(join(String(dir), "source"), "r");
    const DELETE = 0x10000;
    const FILE_FLAG_DELETE_ON_CLOSE = 0x04000000;
    const path = Buffer.from(join(String(dir), "source") + "\0", "utf16le");
    kernel32.CloseHandle(kernel32.CreateFileW(path, DELETE, 7, null, 3, FILE_FLAG_DELETE_ON_CLOSE, null));
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(source.fd))).toBe(10);
    expect(fs.readFileSync(join(String(dir), "copy"), "utf8")).toBe("still here");
  });

  test.each(["copy", "source", "source:other", "source:new"])(
    "copies from an fd of an alternate data stream to %s",
    async destination => {
      using dir = tempDir("bun-copy-stream", { source: "a longer file", copy: "old" });
      fs.writeFileSync(join(String(dir), "source:name"), "stream");
      fs.writeFileSync(join(String(dir), "source:other"), "Stream");
      using source = openFile(join(String(dir), "source:name"), "r");
      expect(await Bun.write(join(String(dir), destination), Bun.file(source.fd))).toBe(6);
      expect(fs.readFileSync(join(String(dir), destination), "utf8")).toBe("stream");
    },
  );

  test("path to fd writes at the current file position", async () => {
    using dir = tempDir("bun-copy-to-fd", { source: "0123456789" });
    using destination = openFile(join(String(dir), "destination"), "w");
    fs.writeSync(destination.fd, "head:");
    expect(await Bun.write(destination.fd, Bun.file(join(String(dir), "source")))).toBe(10);
    fs.writeSync(destination.fd, ":tail");
    expect(fs.readFileSync(join(String(dir), "destination"), "utf8")).toBe("head:0123456789:tail");
  });

  test("a sliced pipe destination receives only the slice length", async () => {
    using dir = tempDir("bun-copy-to-pipe-slice", { source: "0123456789" });
    using pipe = createPipe();
    expect(await Bun.write(Bun.file(pipe.writeFd).slice(0, 4), Bun.file(join(String(dir), "source")))).toBe(4);
    pipe.close(pipe.writeFd);
    expect(await Bun.file(pipe.readFd).text()).toBe("0123");
  });

  test("a sliced file destination leaves the remaining bytes in the source pipe", async () => {
    using dir = tempDir("bun-copy-from-pipe-slice", { destination: "a longer file" });
    using pipe = createPipe();
    fs.writeSync(pipe.writeFd, "0123456789");
    expect(await Bun.write(Bun.file(join(String(dir), "destination")).slice(0, 4), Bun.file(pipe.readFd))).toBe(4);
    expect(fs.readFileSync(join(String(dir), "destination"), "utf8")).toBe("0123");
    expect(readThreeBytes(pipe.readFd)).toBe("456");
  });

  test("copies from a pipe to a hidden file", async () => {
    using dir = tempDir("bun-copy-hidden", { destination: "a longer file" });
    const path = join(String(dir), "destination");
    expect(Bun.spawnSync(["attrib", "+h", path]).exitCode).toBe(0);
    using pipe = createPipe();
    fs.writeSync(pipe.writeFd, "new");
    pipe.close(pipe.writeFd);
    expect(await Bun.write(path, Bun.file(pipe.readFd))).toBe(3);
    expect(fs.readFileSync(path, "utf8")).toBe("new");
  });

  test("copies to and from a named pipe path", async () => {
    using dir = tempDir("bun-copy-named-pipe", { source: "to the server" });
    const pipePath = `\\\\.\\pipe\\bun-copy-${crypto.randomUUID()}`;
    const received = Promise.withResolvers<string>();
    const handlers = [
      (socket: net.Socket) =>
        Array.fromAsync(socket).then(chunks => received.resolve(chunks.join("")), received.reject),
      (socket: net.Socket) => socket.end("from the server"),
    ];
    await using server = net.createServer(socket => handlers.shift()!(socket));
    await once(server.listen(pipePath), "listening");
    expect(await Bun.write(pipePath, Bun.file(join(String(dir), "source")))).toBe(13);
    expect(await received.promise).toBe("to the server");
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(pipePath))).toBe(15);
    expect(fs.readFileSync(join(String(dir), "copy"), "utf8")).toBe("from the server");
  });

  test("path to path errors report code, syscall and path", async () => {
    using dir = tempDir("bun-copy-errors", { file: "x", subdir: {} });
    const tempPath = (...segments: string[]) => join(String(dir), ...segments);
    const file = Bun.file(tempPath("file"));
    expect({
      missingSource: await captureError(Bun.write(tempPath("a", "b"), Bun.file(tempPath("missing")))),
      missingParent: await captureError(Bun.write(tempPath("a", "b"), file, { createPath: false })),
      ancestorIsFile: await captureError(Bun.write(tempPath("file", "a", "b"), file)),
      toDirectory: await captureError(Bun.write(tempPath("subdir"), file)),
      fromDirectory: await captureError(Bun.write(tempPath("a"), Bun.file(tempPath("subdir")))),
      files: fs.readdirSync(String(dir)).sort(),
    }).toEqual({
      missingSource: { code: "ENOENT", syscall: "copyfile", path: tempPath("missing") },
      missingParent: { code: "ENOENT", syscall: "copyfile", path: tempPath("a", "b") },
      ancestorIsFile: { code: "ENOTDIR", syscall: "mkdir", path: tempPath("file", "a") },
      toDirectory: { code: "ENOENT", syscall: "copyfile", path: tempPath("subdir") },
      fromDirectory: { code: "ENOENT", syscall: "copyfile", path: tempPath("a") },
      files: ["file", "subdir"],
    });
  });

  test("errors involving an fd leave the destination unchanged", async () => {
    using dir = tempDir("bun-copy-fd-errors", { source: "new", empty: "", destination: "old", subdir: {} });
    const tempPath = (...segments: string[]) => join(String(dir), ...segments);
    using source = openFile(tempPath("source"), "r");
    using empty = openFile(tempPath("empty"), "r");
    using directory = openFile(tempPath("subdir"), "r");
    using pipe = createPipe();
    expect({
      invalidSourceFd: await captureError(Bun.write(tempPath("destination"), Bun.file(4000))),
      invalidDestinationFd: await captureError(Bun.write(4000, Bun.file(tempPath("missing")))),
      fromDirectory: await captureError(Bun.write(tempPath("destination"), Bun.file(directory.fd))),
      toDirectory: await captureError(Bun.write(tempPath("subdir"), Bun.file(empty.fd))),
      pipeToDirectory: await captureError(Bun.write(tempPath("subdir"), Bun.file(pipe.readFd))),
      missingParent: await captureError(Bun.write(tempPath("a", "b"), Bun.file(source.fd), { createPath: false })),
      missingSource: await captureError(Bun.write(pipe.writeFd, Bun.file(tempPath("missing")))),
      destination: fs.readFileSync(tempPath("destination"), "utf8"),
    }).toEqual({
      invalidSourceFd: { code: "EBADF", syscall: "fstat" },
      invalidDestinationFd: { code: "EBADF", syscall: "fstat" },
      fromDirectory: { code: "EISDIR", syscall: "read" },
      toDirectory: { code: "ENOENT", syscall: "copyfile", path: tempPath("subdir") },
      pipeToDirectory: { code: "EISDIR", syscall: "open", path: tempPath("subdir") },
      missingParent: { code: "ENOENT", syscall: "copyfile", path: tempPath("a", "b") },
      missingSource: { code: "ENOENT", syscall: "open", path: tempPath("missing") },
      destination: "old",
    });
  });
});

describe.skipIf(!isWindows)("unawaited Bun.write() calls are applied in order", () => {
  const chunks = Array.from({ length: 200 }, (_, i) => `${i} `);

  test("to Bun.stdout", async () => {
    using dir = tempDir("bun-write-order-stdout", { file: "file " });
    const script = `for (let i = 0; i < 200; i++) Bun.write(Bun.stdout, i % 50 ? i + " " : Bun.file("file"));`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: chunks.map((chunk, i) => (i % 50 ? chunk : "file ")).join(""),
      stderr: "",
      exitCode: 0,
    });
  });

  test("to an fd", async () => {
    using dir = tempDir("bun-write-order-fd", {});
    using file = openFile(join(String(dir), "file"), "w");
    await Promise.all(chunks.map(chunk => Bun.write(file.fd, chunk)));
    expect(fs.readFileSync(join(String(dir), "file"), "utf8")).toBe(chunks.join(""));
  });

  test("to a path", async () => {
    using dir = tempDir("bun-write-order-path", { source: "a copy that is longer" });
    const path = join(String(dir), "file");
    for (let i = 0; i < 20; i++) {
      await Promise.all([
        Bun.write(path, "a first version that is longer"),
        Bun.write(path, Bun.file(join(String(dir), "source"))),
        Bun.write(Bun.file(path), `last ${i}`),
      ]);
      expect(fs.readFileSync(path, "utf8")).toBe(`last ${i}`);
    }
  });

  test.each(["./subdir/../file", "FILE", "absolute"])("to a path and an alias of it (%s)", async alias => {
    using dir = tempDir("bun-write-order-alias", {});
    const script = `
      const alias = ${JSON.stringify(alias === "absolute" ? join(String(dir), "file") : alias)};
      for (let i = 0; i < 20; i++) {
        await Promise.all([Bun.write("file", "a first version that is longer"), Bun.write(alias, "last")]);
        console.write(fs.readFileSync("file", "utf8"));
      }`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), stderr: "inherit" });
    expect(await proc.stdout.text()).toBe(Buffer.alloc(80, "last").toString());
    expect(await proc.exited).toBe(0);
  });

  test("to an fd that is closed before they complete", async () => {
    using dir = tempDir("bun-write-order-close", { source: "source" });
    const fd = openSync(join(String(dir), "file"), "w");
    const fileWrites = [...chunks, Bun.file(join(String(dir), "source"))].map(data => Bun.write(fd, data));
    closeSync(fd);
    await Promise.all(fileWrites);
    expect(fs.readFileSync(join(String(dir), "file"), "utf8")).toBe(chunks.join("") + "source");

    using pipe = createPipe();
    const pipeWrites = chunks.map(chunk => Bun.write(pipe.writeFd, chunk));
    pipe.close(pipe.writeFd);
    expect(await Bun.file(pipe.readFd).text()).toBe(chunks.join(""));
    await Promise.all(pipeWrites);
  });

  test("a failed write does not block the next one", async () => {
    using dir = tempDir("bun-write-order-failure", {});
    const path = join(String(dir), "subdir", "file");
    const results = await Promise.all([
      captureError(Bun.write(path, "a", { createPath: false })),
      captureError(Bun.write(path, Bun.file(join(String(dir), "missing")))),
      captureError(Bun.write(path, "b")),
    ]);
    expect(results).toMatchObject([{ code: "ENOENT" }, { code: "ENOENT" }, { resolved: 1 }]);
  });

  test.each(["bytes", "file"])("except to a named pipe path, where each call connects (%s)", async kind => {
    using dir = tempDir("bun-write-order-named-pipe", { source: createPattern(1 << 20) });
    const data = kind === "file" ? Bun.file(join(String(dir), "source")) : createPattern(1 << 20);
    const pipePath = `\\\\.\\pipe\\bun-write-${crypto.randomUUID()}`;
    const peers: net.Socket[] = [];
    await using server = net.createServer({ pauseOnConnect: true }, peer => {
      if (peers.push(peer) === 2) for (const socket of peers) socket.resume();
    });
    await once(server.listen(pipePath), "listening");
    expect(await Promise.all([Bun.write(pipePath, data), Bun.write(pipePath, data)])).toEqual([1 << 20, 1 << 20]);
  });

  test("a copy waiting for input does not block the next write", async () => {
    using input = createPipe();
    using output = createPipe();
    const pendingCopy = Bun.write(output.writeFd, Bun.file(input.readFd));
    expect(await Bun.write(output.writeFd, "one")).toBe(3);
    fs.writeSync(input.writeFd, "two");
    input.close(input.writeFd);
    expect(await pendingCopy).toBe(3);
    output.close(output.writeFd);
    expect(await Bun.file(output.readFd).text()).toBe("onetwo");
  });
});

describe.skipIf(!isWindows)("unawaited node:fs calls run in order", () => {
  const chunks = Array.from({ length: 200 }, (_, i) => `${i} `);
  const writeMethods = {
    write: (fd: number, text: string) => promisify(fs.write)(fd, text),
    writev: (fd: number, text: string) => promisify(fs.writev)(fd, [Buffer.from(text)]),
    writeFile: (fd: number, text: string) => promisify(fs.writeFile)(fd, text),
    appendFile: (fd: number, text: string) => promisify(fs.appendFile)(fd, text),
  };

  test.each(Object.entries(writeMethods))("%s to a file, then close", async (_, write) => {
    using dir = tempDir("fs-order-file", {});
    const fd = openSync(join(String(dir), "file"), "w");
    await Promise.all([...chunks.map(chunk => write(fd, chunk)), promisify(fs.close)(fd)]);
    expect(fs.readFileSync(join(String(dir), "file"), "utf8")).toBe(chunks.join(""));
  });

  test.each(Object.entries(writeMethods))("%s to a pipe", async (_, write) => {
    using pipe = createPipe();
    const text = Bun.file(pipe.readFd).text();
    await Promise.all(chunks.map(chunk => write(pipe.writeFd, chunk)));
    pipe.close(pipe.writeFd);
    expect(await text).toBe(chunks.join(""));
  });

  test("read from a pipe", async () => {
    using pipe = createPipe();
    const bytes = Buffer.from(chunks.map((_, i) => i));
    const received = Buffer.alloc(bytes.length);
    const reads = chunks.map((_, i) => promisify(fs.read)(pipe.readFd, received, i, 1, null));
    fs.writeSync(pipe.writeFd, bytes);
    await Promise.all(reads);
    expect(received).toEqual(bytes);
  });

  test("fstat, ftruncate and Bun.file() run after pending writes", async () => {
    using dir = tempDir("fs-order-mixed", {});
    using file = openFile(join(String(dir), "file"), "w+");
    const writes = chunks.map(chunk => writeMethods.write(file.fd, chunk));
    const [{ size }, text, , truncatedText] = await Promise.all([
      promisify(fs.fstat)(file.fd),
      Bun.file(file.fd).text(),
      promisify(fs.ftruncate)(file.fd, 2),
      Bun.file(file.fd).text(),
      ...writes,
    ]);
    expect({ size, text, truncatedText }).toEqual({
      size: chunks.join("").length,
      text: chunks.join(""),
      truncatedText: "0 ",
    });
  });

  test("calls that wait for a pipe read do not hold up files", async () => {
    using pipe = createPipe();
    const read = promisify(fs.read)(pipe.readFd, Buffer.alloc(1), 0, 1, null);
    // The handle is not signaled while a request is in flight.
    const isIdle = () => kernel32.WaitForSingleObject(pipe.readHandle, 0) === 0;
    for (const deadline = Date.now() + 4000; isIdle() && Date.now() < deadline;) await Bun.sleep(1);
    expect(isIdle()).toBe(false);
    const calls = Array.from({ length: 8 }, () => captureError(promisify(fs.futimes)(pipe.readFd, 1, 1)));
    await (await open(import.meta.path)).close();
    fs.writeSync(pipe.writeFd, "x");
    await Promise.all([read, ...calls]);
  });

  test.each(["fsync", "fdatasync"])("a Worker that exits does not wait for %s on a pipe", async method => {
    using pipe = createPipe();
    const worker = new Worker(
      `const fs = require("fs");
       fs.write(${pipe.writeFd}, "abc", () => {});
       fs.${method}(${pipe.writeFd}, () => {});
       process.exit(0);`,
      { eval: true },
    );
    await once(worker, "exit");
    expect(readThreeBytes(pipe.readFd)).toBe("abc");
  });

  test("a Worker that exits completes queued ftruncate, futimes and fchmod calls", async () => {
    using dir = tempDir("fs-order-worker-exit", {});
    const path = join(String(dir), "file");
    const worker = new Worker(
      `const fs = require("fs");
       const fd = fs.openSync(require("worker_threads").workerData, "w");
       for (let size = 1; size <= 1000; size++) fs.ftruncate(fd, size, () => {});
       fs.futimes(fd, 5, 5, () => {});
       fs.fchmod(fd, 0o444, () => {});
       fs.close(fd, () => {});
       process.exit(0);`,
      { eval: true, workerData: path },
    );
    await once(worker, "exit");
    expect(fs.statSync(path)).toMatchObject({ size: 1000, mtimeMs: 5000, mode: 0o100444 });
  });

  test("errors report the fd", async () => {
    using pipe = createPipe();
    expect(await captureError(writeMethods.write(pipe.readFd, "x"))).toMatchObject({
      code: "EBADF",
      syscall: "write",
      fd: pipe.readFd,
    });
  });
});

test.skipIf(!isWindows)("relative paths resolve against the cwd at call time", async () => {
  using dir = tempDir("bun-file-chdir", { "subdir/source": "source", "empty": {} });
  const script = `
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(Bun.write("subdir/bytes", "bytes", { createPath: false }));
      promises.push(Bun.write("subdir/copy", Bun.file("subdir/source"), { createPath: false }));
      promises.push(Bun.file("subdir/source").text());
    }
    process.chdir("empty");
    console.log(new Set(await Promise.all(promises)));`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), stderr: "inherit" });
  expect((await proc.stdout.text()).replace(/\s+/g, " ").trim()).toBe(`Set(3) { 5, 6, "source", }`);
  expect(await proc.exited).toBe(0);
});

describe.concurrent("unawaited writes complete before the process exits", () => {
  async function run(script: string, stdoutKind: "pipe" | "file") {
    using dir = tempDir("write-then-exit", {});
    const stdoutPath = join(String(dir), "stdout");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: stdoutKind === "pipe" ? "pipe" : Bun.file(stdoutPath),
      stderr: "ignore",
    });
    const [pipedStdout, exitCode] = await Promise.all([stdoutKind === "pipe" ? proc.stdout!.text() : "", proc.exited]);
    const filePath = join(String(dir), "file");
    return {
      stdout: stdoutKind === "pipe" ? pipedStdout : fs.readFileSync(stdoutPath, "utf8"),
      file: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined,
      exitCode,
    };
  }

  describe.each(["pipe", "file"] as const)("stdout is a %s", stdoutKind => {
    test.each([
      ["process.exit()", "process.exit(7)", 7],
      ["an uncaught error", "throw new Error()", 1],
    ])("Bun.write(), then %s", async (_, exitStatement, exitCode) => {
      const script = `for (const text of "abc") Bun.write(1, text); Bun.write("file", "d"); ${exitStatement};`;
      expect(await run(script, stdoutKind)).toEqual({ stdout: "abc", file: "d", exitCode });
    });

    test
      .skipIf(!isWindows)
      .each([
        `fs.write(1, "a", () => {})`,
        `fs.writev(1, [Buffer.from("a")], () => {})`,
        `fs.writeFile(1, "a", () => {})`,
        `fs.appendFile(1, "a", () => {})`,
      ])("%s, then process.exit()", async call => {
      expect(await run(`${call}; process.exit(7);`, stdoutKind)).toEqual({ stdout: "a", file: undefined, exitCode: 7 });
    });
  });

  // The data fits the pipe's buffer, so the write does not depend on the reader.
  test.skipIf(!isWindows).each(["Buffer.alloc(1 << 15)", `Bun.file("source")`])(
    "Bun.write(named pipe path, %s), then process.exit()",
    async data => {
      using dir = tempDir("bun-write-exit-named-pipe", { source: Buffer.alloc(1 << 15) });
      const pipePath = `\\\\.\\pipe\\bun-write-${crypto.randomUUID()}`;
      await using server = net.createServer();
      await once(server.listen(pipePath), "listening");
      const connection = once(server, "connection");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `Bun.write(${JSON.stringify(pipePath)}, ${data}); process.exit(7);`],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
      });
      expect(Buffer.concat(await Array.fromAsync((await connection)[0])).length).toBe(1 << 15);
      expect(await proc.exited).toBe(7);
    },
  );

  test.skipIf(!isWindows)("several writers on an extra stdio pipe, then process.exit()", async () => {
    const script = `for (const text of "abcdefghijklmnop") {
      const writer = Bun.file(3).writer();
      writer.write(text);
      writer.end();
    }
    process.exit(7);`;
    using child = spawn(bunExe(), ["-e", script], { env: bunEnv, stdio: ["ignore", "ignore", "inherit", "pipe"] });
    const exit = once(child, "exit");
    expect(Buffer.concat(await Array.fromAsync(child.stdio[3] as Readable)).toString()).toBe("abcdefghijklmnop");
    expect(await exit).toEqual([7, null]);
  });

  test.skipIf(!isWindows).each([
    [`Bun.write(1, bytes)`, undefined],
    [`Bun.write(1, bytes)`, "1"],
    [`fs.write(1, bytes, () => {})`, undefined],
    [`fs.write(1, bytes, () => {})`, "1"],
  ])(
    "%s does not block process.exit() when the pipe is never drained (BUN_DESTRUCT_VM_ON_EXIT=%s)",
    async (call, BUN_DESTRUCT_VM_ON_EXIT) => {
      using pipe = createPipe();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const bytes = Buffer.alloc(1 << 20); ${call}; process.exit(7);`],
        env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT },
        stdout: pipe.writeFd,
        stderr: "inherit",
      });
      expect(await proc.exited).toBe(7);
    },
  );
});

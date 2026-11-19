import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import fs, { closeSync, openSync } from "fs";
import { open } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
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

function readThree(fd: number) {
  const buffer = Buffer.alloc(3);
  return buffer.toString("utf8", 0, fs.readSync(fd, buffer));
}

function failure(promise: Promise<unknown>) {
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
    })
  : ({ symbols: {} } as any);

function createPipe() {
  const handles = new BigUint64Array(2);
  expect(kernel32.CreatePipe(ptr(handles), ptr(handles, 8), null, 0)).not.toBe(0);
  const read = fs.createReadStream(null as any, { windowsHandle: handles[0], autoClose: false } as any).fd as number;
  const write = fs.createWriteStream(null as any, { windowsHandle: handles[1], autoClose: false } as any).fd as number;
  const open = new Set([read, write]);
  const close = (fd: number) => open.delete(fd) && closeSync(fd);
  return { read, write, close, [Symbol.dispose]: () => [...open].forEach(close) };
}

function pattern(size: number) {
  return Buffer.alloc(size, "0123456789abcdefghijklmnopqrstuvwxyz!");
}

describe.skipIf(!isWindows)("Bun.file() reads", () => {
  test("a descriptor is read from the start of the file and keeps its position", async () => {
    using dir = tempDir("bun-file-position", { file: "0123456789" });
    using file = openFile(join(String(dir), "file"), "r");
    expect(readThree(file.fd)).toBe("012");
    expect(await Bun.file(file.fd).text()).toBe("0123456789");
    expect(await Bun.file(file.fd).slice(0, 4).text()).toBe("0123");
    expect(readThree(file.fd)).toBe("345");
  });

  test("a descriptor is left at the start of a slice", async () => {
    using dir = tempDir("bun-file-slice-position", { file: "0123456789" });
    using file = openFile(join(String(dir), "file"), "r");
    expect(await Bun.file(file.fd).slice(5, 7).text()).toBe("56");
    expect(readThree(file.fd)).toBe("567");
    expect(await Bun.file(file.fd).slice(50).text()).toBe("");
    expect(readThree(file.fd)).toBe("");
  });

  test("errors", async () => {
    using dir = tempDir("bun-file-read-errors", { file: "x", folder: {} });
    using writeOnly = openFile(join(String(dir), "file"), "a");
    using folder = openFile(join(String(dir), "folder"), "r");
    expect({
      missing: await failure(Bun.file(join(String(dir), "missing")).text()),
      folder: await failure(Bun.file(join(String(dir), "folder")).text()),
      folderFd: await failure(Bun.file(folder.fd).text()),
      writeOnly: await failure(Bun.file(writeOnly.fd).text()),
      closed: await failure(Bun.file(4000).text()),
    }).toEqual({
      missing: { code: "ENOENT", syscall: "open", path: join(String(dir), "missing") },
      folder: { code: "EISDIR", syscall: "read", path: join(String(dir), "folder") },
      folderFd: { code: "EISDIR", syscall: "read" },
      writeOnly: { code: "EBADF", syscall: "read" },
      closed: { code: "EBADF", syscall: "fstat" },
    });
  });

  test("lastModified follows a read", async () => {
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
    expect(await Bun.file(pipe.read).slice(0, 0).text()).toBe("");
  });
});

describe.skipIf(!isWindows)("Bun.write(destination, bytes)", () => {
  test("errors", async () => {
    using dir = tempDir("bun-write-errors", { file: "x", readonly: "x", folder: {} });
    const at = (...parts: string[]) => join(String(dir), ...parts);
    fs.chmodSync(at("readonly"), 0o444);
    using readOnly = openFile(at("file"), "r");
    expect({
      noFolder: await failure(Bun.write(at("a", "b"), "x", { createPath: false })),
      inFile: await failure(Bun.write(at("file", "a"), "x")),
      belowFile: await failure(Bun.write(at("file", "a", "b"), "x")),
      folder: await failure(Bun.write(at("folder"), "x")),
      readonly: await failure(Bun.write(at("readonly"), "x")),
      readOnlyFd: await failure(Bun.write(readOnly.fd, "x")),
      closed: await failure(Bun.write(4000, "x")),
    }).toEqual({
      noFolder: { code: "ENOENT", syscall: "open", path: at("a", "b") },
      inFile: { code: "EEXIST", syscall: "mkdir", path: at("file", "a") },
      belowFile: { code: "ENOTDIR", syscall: "mkdir", path: at("file", "a", "b") },
      folder: { code: "EISDIR", syscall: "open", path: at("folder") },
      readonly: { code: "EPERM", syscall: "open", path: at("readonly") },
      readOnlyFd: { code: "EBADF", syscall: "write", fd: readOnly.fd },
      closed: { code: "EBADF", syscall: "write", fd: 4000 },
    });
  });

  test("a path can have any length", async () => {
    using dir = tempDir("bun-write-names", {});
    const long = Buffer.alloc(200, "a").toString();
    await Bun.write(join(String(dir), long, long), "x");
    expect(fs.readdirSync(String(dir), { recursive: true }).sort()).toEqual([long, join(long, long)]);
  });

  test("the file is closed when the promise resolves", async () => {
    using dir = tempDir("bun-write-closed", {});
    const path = join(String(dir), "file");
    const [GENERIC_READ, OPEN_EXISTING] = [0x80000000, 3];
    let refused = 0;
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
      if (handle === -1n) refused++;
      else kernel32.CloseHandle(handle);
    }
    expect(refused).toBe(0);
  });

  test.each(["process.exit()", "terminate()"])("a Worker finishes its writes before it ends by %s", async how => {
    using dir = tempDir("bun-write-worker-exit", { source: "copied" });
    using pipe = createPipe();
    const worker = new Worker(
      `const { parentPort, workerData: { dir, how, fd } } = require("node:worker_threads");
       for (let i = 0; i < 100; i++) {
         Bun.write(dir + "/written-" + i, "written");
         Bun.write(dir + "/folder-" + i + "/written", "written");
         Bun.write(dir + "/copied-" + i, Bun.file(dir + "/source"));
         Bun.write(fd, "written");
         Bun.write(fd, Bun.file(dir + "/source"));
       }
       if (how === "process.exit()") process.exit(0);
       parentPort.on("message", () => {});
       parentPort.postMessage("started");`,
      { eval: true, workerData: { dir: String(dir), how, fd: pipe.write } },
    );
    worker.once("message", () => worker.terminate());
    await once(worker, "exit");
    const contents = new Set<string>();
    for (let i = 0; i < 100; i++) {
      for (const name of [`written-${i}`, `folder-${i}/written`, `copied-${i}`]) {
        contents.add(fs.readFileSync(join(String(dir), name), "utf8"));
      }
    }
    expect([...contents]).toEqual(["written", "copied"]);
    pipe.close(pipe.write);
    expect(await Bun.file(pipe.read).text()).toBe(Buffer.alloc(1300, "writtencopied").toString());
  });
});

describe.skipIf(!isWindows)("Bun.write(destination, Bun.file())", () => {
  test("from path to path it keeps the modification time, and mode wins over the mode of the source", async () => {
    using dir = tempDir("bun-copy-metadata", { source: "x" });
    const at = (name: string) => join(String(dir), name);
    fs.utimesSync(at("source"), 1000, 1000);
    fs.chmodSync(at("source"), 0o444);
    await Bun.write(at("pipe"), Bun.file(at("source")));
    await Bun.write(at("writable"), Bun.file(at("source")), { mode: 0o644 });
    expect(fs.statSync(at("pipe"))).toMatchObject({ mtimeMs: 1_000_000, mode: 0o100444 });
    expect(fs.statSync(at("writable"))).toMatchObject({ mode: 0o100666 });
  });

  test.each([
    ["path", "path"],
    ["link", "path"],
    ["path", "r"],
    ["link", "r"],
    ["r+", "path"],
    ["a", "path"],
    ["a", "r"],
  ])("onto itself: to %s from %s", async (to, from) => {
    using dir = tempDir("bun-copy-onto-itself", { path: "0123456789" });
    const path = join(String(dir), "path");
    fs.linkSync(path, join(String(dir), "link"));
    using stack = new DisposableStack();
    const file = (how: string) =>
      Bun.file(how === "path" || how === "link" ? join(String(dir), how) : stack.use(openFile(path, how)).fd);
    expect(await Bun.write(file(to), file(from))).toBe(10);
    expect(fs.readFileSync(path, "utf8")).toBe("0123456789");
  });

  test("from a descriptor to a path it copies the whole file and keeps the position", async () => {
    using dir = tempDir("bun-copy-from-fd", { source: pattern(2_500_000), longer: pattern(2_600_000).reverse() });
    using source = openFile(join(String(dir), "source"), "r");
    expect(readThree(source.fd)).toBe("012");
    for (const name of ["longer", join("new", "file")]) {
      expect(await Bun.write(join(String(dir), name), Bun.file(source.fd))).toBe(2_500_000);
      expect(fs.readFileSync(join(String(dir), name)).equals(pattern(2_500_000))).toBe(true);
    }
    expect(await Bun.write(Bun.file(join(String(dir), "longer")).slice(0, 4), Bun.file(source.fd))).toBe(4);
    expect(fs.readFileSync(join(String(dir), "longer"), "utf8")).toBe("0123");
    expect(readThree(source.fd)).toBe("345");
  });

  test("from a descriptor to a path it sets the mode", async () => {
    using dir = tempDir("bun-write-fd-mode", { source: "abc" });
    using source = openFile(join(String(dir), "source"), "r");
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(source.fd), { mode: 0o444 })).toBe(3);
    expect(fs.statSync(join(String(dir), "copy")).mode & 0o777).toBe(0o444);
  });

  test("from a descriptor to a pipe it starts at the position", async () => {
    using dir = tempDir("bun-copy-fd-to-pipe", { source: "0123456789" });
    using source = openFile(join(String(dir), "source"), "r");
    using pipe = createPipe();
    expect(readThree(source.fd)).toBe("012");
    expect(await Bun.write(pipe.write, Bun.file(source.fd))).toBe(7);
    pipe.close(pipe.write);
    expect(await Bun.file(pipe.read).text()).toBe("3456789");
  });

  test("from a descriptor whose file was deleted", async () => {
    using dir = tempDir("bun-copy-deleted", { source: "still here" });
    using source = openFile(join(String(dir), "source"), "r");
    fs.unlinkSync(join(String(dir), "source"));
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(source.fd))).toBe(10);
    expect(fs.readFileSync(join(String(dir), "copy"), "utf8")).toBe("still here");
  });

  test("to a descriptor it writes at the position", async () => {
    using dir = tempDir("bun-copy-to-fd", { source: "0123456789" });
    using destination = openFile(join(String(dir), "destination"), "w");
    fs.writeSync(destination.fd, "head:");
    expect(await Bun.write(destination.fd, Bun.file(join(String(dir), "source")))).toBe(10);
    fs.writeSync(destination.fd, ":tail");
    expect(fs.readFileSync(join(String(dir), "destination"), "utf8")).toBe("head:0123456789:tail");
  });

  test("a slice of a pipe gets as many bytes as it has", async () => {
    using dir = tempDir("bun-copy-to-pipe-slice", { source: "0123456789" });
    using pipe = createPipe();
    expect(await Bun.write(Bun.file(pipe.write).slice(0, 4), Bun.file(join(String(dir), "source")))).toBe(4);
    pipe.close(pipe.write);
    expect(await Bun.file(pipe.read).text()).toBe("0123");
  });

  test("a slice of a file leaves the rest in the pipe", async () => {
    using dir = tempDir("bun-copy-from-pipe-slice", { destination: "a longer file" });
    using pipe = createPipe();
    fs.writeSync(pipe.write, "0123456789");
    expect(await Bun.write(Bun.file(join(String(dir), "destination")).slice(0, 4), Bun.file(pipe.read))).toBe(4);
    expect(fs.readFileSync(join(String(dir), "destination"), "utf8")).toBe("0123");
    expect(readThree(pipe.read)).toBe("456");
  });

  test("to and from the path of a named pipe", async () => {
    using dir = tempDir("bun-copy-named-pipe", { source: "to the server" });
    const name = `\\\\.\\pipe\\bun-copy-${crypto.randomUUID()}`;
    const received = Promise.withResolvers<string>();
    const handlers = [
      (socket: net.Socket) =>
        Array.fromAsync(socket).then(chunks => received.resolve(chunks.join("")), received.reject),
      (socket: net.Socket) => socket.end("from the server"),
    ];
    await using server = net.createServer(socket => handlers.shift()!(socket));
    await once(server.listen(name), "listening");
    expect(await Bun.write(name, Bun.file(join(String(dir), "source")))).toBe(13);
    expect(await received.promise).toBe("to the server");
    expect(await Bun.write(join(String(dir), "copy"), Bun.file(name))).toBe(15);
    expect(fs.readFileSync(join(String(dir), "copy"), "utf8")).toBe("from the server");
  });

  test("errors from path to path", async () => {
    using dir = tempDir("bun-copy-errors", { file: "x", folder: {} });
    const at = (...parts: string[]) => join(String(dir), ...parts);
    const file = Bun.file(at("file"));
    expect({
      missing: await failure(Bun.write(at("a", "b"), Bun.file(at("missing")))),
      noFolder: await failure(Bun.write(at("a", "b"), file, { createPath: false })),
      belowFile: await failure(Bun.write(at("file", "a", "b"), file)),
      toFolder: await failure(Bun.write(at("folder"), file)),
      fromFolder: await failure(Bun.write(at("a"), Bun.file(at("folder")))),
      files: fs.readdirSync(String(dir)).sort(),
    }).toEqual({
      missing: { code: "ENOENT", syscall: "copyfile", path: at("missing") },
      noFolder: { code: "ENOENT", syscall: "copyfile", path: at("a", "b") },
      belowFile: { code: "ENOTDIR", syscall: "mkdir", path: at("file", "a") },
      toFolder: { code: "ENOENT", syscall: "copyfile", path: at("folder") },
      fromFolder: { code: "ENOENT", syscall: "copyfile", path: at("a") },
      files: ["file", "folder"],
    });
  });

  test("errors with a descriptor leave the destination as it is", async () => {
    using dir = tempDir("bun-copy-fd-errors", { source: "new", empty: "", destination: "old", folder: {} });
    const at = (...parts: string[]) => join(String(dir), ...parts);
    using source = openFile(at("source"), "r");
    using empty = openFile(at("empty"), "r");
    using folder = openFile(at("folder"), "r");
    using pipe = createPipe();
    expect({
      closedSource: await failure(Bun.write(at("destination"), Bun.file(4000))),
      closedDestination: await failure(Bun.write(4000, Bun.file(at("missing")))),
      fromFolder: await failure(Bun.write(at("destination"), Bun.file(folder.fd))),
      toFolder: await failure(Bun.write(at("folder"), Bun.file(empty.fd))),
      pipeToFolder: await failure(Bun.write(at("folder"), Bun.file(pipe.read))),
      noFolder: await failure(Bun.write(at("a", "b"), Bun.file(source.fd), { createPath: false })),
      missing: await failure(Bun.write(pipe.write, Bun.file(at("missing")))),
      destination: fs.readFileSync(at("destination"), "utf8"),
    }).toEqual({
      closedSource: { code: "EBADF", syscall: "fstat" },
      closedDestination: { code: "EBADF", syscall: "fstat" },
      fromFolder: { code: "EISDIR", syscall: "read" },
      toFolder: { code: "EISDIR", syscall: "open", path: at("folder") },
      pipeToFolder: { code: "EISDIR", syscall: "open", path: at("folder") },
      noFolder: { code: "ENOENT", syscall: "open", path: at("a", "b") },
      missing: { code: "ENOENT", syscall: "open", path: at("missing") },
      destination: "old",
    });
  });
});

describe.skipIf(!isWindows)("calls of Bun.write() that are not awaited arrive in order", () => {
  const numbers = Array.from({ length: 200 }, (_, i) => `${i} `);

  test("Bun.stdout", async () => {
    using dir = tempDir("bun-write-order-stdout", { file: "file " });
    const script = `for (let i = 0; i < 200; i++) Bun.write(Bun.stdout, i % 50 ? i + " " : Bun.file("file"));`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: numbers.map((number, i) => (i % 50 ? number : "file ")).join(""),
      stderr: "",
      exitCode: 0,
    });
  });

  test("a descriptor", async () => {
    using dir = tempDir("bun-write-order-fd", {});
    using file = openFile(join(String(dir), "file"), "w");
    await Promise.all(numbers.map(number => Bun.write(file.fd, number)));
    expect(fs.readFileSync(join(String(dir), "file"), "utf8")).toBe(numbers.join(""));
  });

  test("a path", async () => {
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

  test.each(["./folder/../file", "FILE", "absolute"])("a path that is also written as %s", async other => {
    using dir = tempDir("bun-write-order-spelling", {});
    const script = `
      const other = ${JSON.stringify(other === "absolute" ? join(String(dir), "file") : other)};
      for (let i = 0; i < 20; i++) {
        await Promise.all([Bun.write("file", "a first version that is longer"), Bun.write(other, "last")]);
        console.write(fs.readFileSync("file", "utf8"));
      }`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), stderr: "inherit" });
    expect(await proc.stdout.text()).toBe(Buffer.alloc(80, "last").toString());
    expect(await proc.exited).toBe(0);
  });

  test("a descriptor that is closed behind them", async () => {
    using dir = tempDir("bun-write-order-close", { source: "source" });
    const fd = openSync(join(String(dir), "file"), "w");
    const writes = [...numbers, Bun.file(join(String(dir), "source"))].map(it => Bun.write(fd, it));
    closeSync(fd);
    await Promise.all(writes);
    expect(fs.readFileSync(join(String(dir), "file"), "utf8")).toBe(numbers.join("") + "source");

    using pipe = createPipe();
    const piped = numbers.map(number => Bun.write(pipe.write, number));
    pipe.close(pipe.write);
    expect(await Bun.file(pipe.read).text()).toBe(numbers.join(""));
    await Promise.all(piped);
  });

  test("one that fails does not hold up the next", async () => {
    using dir = tempDir("bun-write-order-failure", {});
    const path = join(String(dir), "folder", "file");
    const results = await Promise.all([
      failure(Bun.write(path, "a", { createPath: false })),
      failure(Bun.write(path, Bun.file(join(String(dir), "missing")))),
      failure(Bun.write(path, "b")),
    ]);
    expect(results).toMatchObject([{ code: "ENOENT" }, { code: "ENOENT" }, { resolved: 1 }]);
  });

  test("a copy that waits for input does not hold up the next", async () => {
    using input = createPipe();
    using output = createPipe();
    const copied = Bun.write(output.write, Bun.file(input.read));
    expect(await Bun.write(output.write, "one")).toBe(3);
    fs.writeSync(input.write, "two");
    input.close(input.write);
    expect(await copied).toBe(3);
    output.close(output.write);
    expect(await Bun.file(output.read).text()).toBe("onetwo");
  });
});

describe.skipIf(!isWindows)("calls of node:fs that are not awaited are made in order", () => {
  const numbers = Array.from({ length: 200 }, (_, i) => `${i} `);
  const calls = {
    write: (fd: number, text: string) => promisify(fs.write)(fd, text),
    writev: (fd: number, text: string) => promisify(fs.writev)(fd, [Buffer.from(text)]),
    writeFile: (fd: number, text: string) => promisify(fs.writeFile)(fd, text),
    appendFile: (fd: number, text: string) => promisify(fs.appendFile)(fd, text),
  };

  test.each(Object.entries(calls))("%s to a file, then close", async (_, call) => {
    using dir = tempDir("fs-order-file", {});
    const fd = openSync(join(String(dir), "file"), "w");
    await Promise.all([...numbers.map(number => call(fd, number)), promisify(fs.close)(fd)]);
    expect(fs.readFileSync(join(String(dir), "file"), "utf8")).toBe(numbers.join(""));
  });

  test.each(Object.entries(calls))("%s to a pipe", async (_, call) => {
    using pipe = createPipe();
    const text = Bun.file(pipe.read).text();
    await Promise.all(numbers.map(number => call(pipe.write, number)));
    pipe.close(pipe.write);
    expect(await text).toBe(numbers.join(""));
  });

  test("read from a pipe", async () => {
    using pipe = createPipe();
    const bytes = Buffer.from(numbers.map((_, i) => i));
    const read = Buffer.alloc(bytes.length);
    const reads = numbers.map((_, i) => promisify(fs.read)(pipe.read, read, i, 1, null));
    fs.writeSync(pipe.write, bytes);
    await Promise.all(reads);
    expect(read).toEqual(bytes);
  });

  test("fstat, ftruncate and Bun.file() come after write", async () => {
    using dir = tempDir("fs-order-others", {});
    using file = openFile(join(String(dir), "file"), "w+");
    const writes = numbers.map(number => calls.write(file.fd, number));
    const [{ size }, text, , cut] = await Promise.all([
      promisify(fs.fstat)(file.fd),
      Bun.file(file.fd).text(),
      promisify(fs.ftruncate)(file.fd, 2),
      Bun.file(file.fd).text(),
      ...writes,
    ]);
    expect({ size, text, cut }).toEqual({ size: numbers.join("").length, text: numbers.join(""), cut: "0 " });
  });

  test("an error names the descriptor", async () => {
    using pipe = createPipe();
    expect(await failure(calls.write(pipe.read, "x"))).toMatchObject({
      code: "EBADF",
      syscall: "write",
      fd: pipe.read,
    });
  });
});

test.skipIf(!isWindows)("a relative path starts at the working directory of the call", async () => {
  using dir = tempDir("bun-file-chdir", { "folder/source": "source", "empty": {} });
  const script = `
    const calls = [];
    for (let i = 0; i < 20; i++) {
      calls.push(Bun.write("folder/bytes", "bytes", { createPath: false }));
      calls.push(Bun.write("folder/copy", Bun.file("folder/source"), { createPath: false }));
      calls.push(Bun.file("folder/source").text());
    }
    process.chdir("empty");
    console.log(new Set(await Promise.all(calls)));`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), stderr: "inherit" });
  expect((await proc.stdout.text()).replace(/\s+/g, " ").trim()).toBe(`Set(3) { 5, 6, "source", }`);
  expect(await proc.exited).toBe(0);
});

describe.concurrent("writes that are not awaited arrive although the process ends", () => {
  async function run(script: string, to: "pipe" | "file") {
    using dir = tempDir("write-then-exit", {});
    const path = join(String(dir), "stdout");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: to === "pipe" ? "pipe" : Bun.file(path),
      stderr: "ignore",
    });
    const [piped, exitCode] = await Promise.all([to === "pipe" ? proc.stdout!.text() : "", proc.exited]);
    const named = join(String(dir), "named");
    return {
      stdout: to === "pipe" ? piped : fs.readFileSync(path, "utf8"),
      named: fs.existsSync(named) ? fs.readFileSync(named, "utf8") : undefined,
      exitCode,
    };
  }

  describe.each(["pipe", "file"] as const)("stdout is a %s", to => {
    test.each([
      ["process.exit()", "process.exit(7)", 7],
      ["an uncaught error", "throw new Error()", 1],
    ])("Bun.write(), then %s", async (_, end, exitCode) => {
      const script = `for (const text of "abc") Bun.write(1, text); Bun.write("named", "d"); ${end};`;
      expect(await run(script, to)).toEqual({ stdout: "abc", named: "d", exitCode });
    });

    // Elsewhere the thread pool races with the exit.
    test
      .skipIf(!isWindows)
      .each([
        `fs.write(1, "a", () => {})`,
        `fs.writev(1, [Buffer.from("a")], () => {})`,
        `fs.writeFile(1, "a", () => {})`,
        `fs.appendFile(1, "a", () => {})`,
      ])("%s, then process.exit()", async call => {
      expect(await run(`${call}; process.exit(7);`, to)).toEqual({ stdout: "a", named: undefined, exitCode: 7 });
    });
  });

  test.skipIf(!isWindows).each([
    [`Bun.write(1, bytes)`, undefined],
    [`Bun.write(1, bytes)`, "1"],
    [`fs.write(1, bytes, () => {})`, undefined],
    [`fs.write(1, bytes, () => {})`, "1"],
  ])(
    "%s does not keep the process when nobody reads the pipe (BUN_DESTRUCT_VM_ON_EXIT=%s)",
    async (call, BUN_DESTRUCT_VM_ON_EXIT) => {
      using pipe = createPipe();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const bytes = Buffer.alloc(1 << 20); ${call}; process.exit(7);`],
        env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT },
        stdout: pipe.write,
        stderr: "inherit",
      });
      expect(await proc.exited).toBe(7);
    },
  );
});

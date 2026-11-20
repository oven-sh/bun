import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readSync, renameSync, writeSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";
import { constants } from "os";
import { join } from "path";
import { openFifo, untilWatched } from "../io/fifo-helpers";

// Reading a Bun.file() backed by a file descriptor goes through
// ReadFile::open, which derives the expected size from fstat. That
// computation previously used @intCast to u52 guarded by a dead @truncate,
// so an abnormal fstat size could trip integerOutOfBounds. Triggering that
// directly requires fstat to report > 4.5 PB which is not achievable here,
// but these tests lock in the fd-backed ReadFile path that the fuzzer hit.
describe.skipIf(isWindows)("Bun.file(fd) read", () => {
  async function withFd<T>(path: string, fn: (fd: number) => Promise<T>): Promise<T> {
    const fd = openSync(path, "r");
    try {
      return await fn(fd);
    } finally {
      closeSync(fd);
    }
  }

  test("text() and arrayBuffer() on a regular-file fd return file contents", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-read.txt": "hello from fd" });
    const path = join(String(dir), "fd-read.txt");

    // Each read needs a fresh fd because Bun.file(fd) does not own or rewind
    // the descriptor, and a completed read leaves it positioned at EOF.
    expect(await withFd(path, fd => Bun.file(fd).text())).toBe("hello from fd");

    const buf = await withFd(path, fd => Bun.file(fd).arrayBuffer());
    expect(new Uint8Array(buf)).toEqual(new TextEncoder().encode("hello from fd"));
  });

  test("slice() with an end beyond the real size reads the actual file contents", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-slice.txt": "0123456789" });
    const path = join(String(dir), "fd-slice.txt");

    // The expected size should come from fstat (10), not from the requested slice
    // end, so the initial buffer allocation stays small.
    expect(await withFd(path, fd => Bun.file(fd).slice(0, Number.MAX_SAFE_INTEGER).text())).toBe("0123456789");
    expect(await withFd(path, fd => Bun.file(fd).slice(2, 5).text())).toBe("234");
  });

  test("empty regular file via fd resolves with empty content", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-empty.txt": "" });
    const path = join(String(dir), "fd-empty.txt");

    expect(await withFd(path, fd => Bun.file(fd).text())).toBe("");
    expect((await withFd(path, fd => Bun.file(fd).arrayBuffer())).byteLength).toBe(0);
  });
});

test.skipIf(!isLinux)("an empty read of a FIFO by path stays open until its writer has written", async () => {
  using dir = tempDir("bun-file-fd-read", {});
  using fifo = openFifo(String(dir));
  const text = Bun.file(fifo.path).slice(0, 0).text();
  await untilWatched(fifo.reader);
  fifo.close(fifo.reader);
  expect(writeSync(fifo.writer, "x")).toBe(1);
  expect(await text).toBe("");
});

test.skipIf(isWindows)("a file that was empty and is a silent FIFO now reads as empty", async () => {
  using dir = tempDir("bun-file-fd-read", { file: "" });
  using fifo = openFifo(String(dir));
  const file = Bun.file(join(String(dir), "file"));
  expect(file.size).toBe(0);
  renameSync(fifo.path, file.name!);
  expect(await file.text()).toBe("");
});

test.skipIf(isWindows)("a read of a pipe waits again after each chunk", async () => {
  using dir = tempDir("bun-file-fd-read", {});
  using fifo = openFifo(String(dir));
  const text = Bun.file(fifo.reader).slice(0, 30).text();
  for (let i = 0; i < 30; i++) {
    // A writer that keeps up, and one that does not.
    await Bun.sleep(i % 4);
    writeSync(fifo.writer, "x");
  }
  expect(await text).toBe(Buffer.alloc(30, "x").toString());
});

// More than the thread that waits takes from the kernel at once.
describe.skipIf(isWindows).concurrent("300 reads wait", () => {
  async function run(script: string) {
    using dir = tempDir("bun-file-fd-read", {});
    const prelude = `
      import { openFifo } from ${JSON.stringify(join(import.meta.dir, "..", "io", "fifo-helpers.ts"))};
      import { closeSync, constants, mkdirSync, openSync, writeSync } from "node:fs";
      const open = dir => (mkdirSync(dir), openFifo(dir));
      using shared = open("shared");
      const readers = Array.from({ length: 300 }, () => openSync(shared.path, constants.O_RDONLY | constants.O_NONBLOCK));
      // Behind the others on the pool, so most of them wait by then.
      const fence = () => Bun.file(${JSON.stringify(import.meta.path)}).text();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + script],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("and get ready together", async () => {
    const result = await run(`
      const texts = readers.map(fd => Bun.file(fd).slice(0, 1).text());
      await fence();
      writeSync(shared.writer, Buffer.alloc(300, "x"));
      console.log((await Promise.all(texts)).join("").length);
    `);
    expect(result).toEqual({ stdout: "300\n", stderr: "", exitCode: 0 });
  });

  test.each([false, true])("and are cancelled beside one that is not, fds closed: %p", async closed => {
    const result = await run(`
      using own = open("own");
      const graph = new Bun.ModuleGraph();
      for (const fd of readers) graph.run(() => void Bun.file(fd).text().catch(() => {}));
      for (const byte of "ab") {
        const text = Bun.file(own.reader).slice(0, 1).text();
        await fence();
        if (${closed}) readers.splice(0).forEach(fd => closeSync(fd));
        if (byte === "a") graph.dispose();
        await fence();
        writeSync(own.writer, byte);
        console.log(await text);
      }
    `);
    expect(result).toEqual({ stdout: "a\nb\n", stderr: "", exitCode: 0 });
  });
});

describe.skipIf(!isLinux)("EPOLLERR while Bun.file(fd).text() waits for a socket", () => {
  const [AF_INET, SOCK_STREAM, SOCK_DGRAM, SOL_SOCKET, SO_TIMESTAMPING] = [2, 1, 2, 1, 37];
  const libc = () =>
    dlopen(libcPathForDlopen(), {
      socket: { args: ["i32", "i32", "i32"], returns: "i32" },
      setsockopt: { args: ["i32", "i32", "i32", "ptr", "u32"], returns: "i32" },
      connect: { args: ["i32", "ptr", "u32"], returns: "i32" },
    }).symbols;

  /** A socket that the event loop does not know. */
  function connectTo(port: number, type: number) {
    const fd = libc().socket(AF_INET, type, 0);
    const address = new Uint8Array([AF_INET, 0, port >> 8, port & 255, 127, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(libc().connect(fd, ptr(address), address.length)).toBe(0);
    return { fd, [Symbol.dispose]: () => closeSync(fd) };
  }

  // read() has nothing to report here, and epoll never stops reporting it.
  test("rejects when it stands for a message in the error queue", async () => {
    const peer = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    try {
      using socket = connectTo(peer.port, SOCK_DGRAM);
      const timestampWhatIsSent = new Int32Array([(1 << 1) | (1 << 4)]);
      expect(libc().setsockopt(socket.fd, SOL_SOCKET, SO_TIMESTAMPING, ptr(timestampWhatIsSent), 4)).toBe(0);
      const text = Bun.file(socket.fd).text();
      await untilWatched(socket.fd);
      writeSync(socket.fd, "x");
      await expect(text).rejects.toMatchObject({ syscall: "epoll_ctl" });
    } finally {
      peer.close();
    }
  });

  test("leaves the pending error on the socket", async () => {
    const accepted = Promise.withResolvers<Bun.Socket>();
    using server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: accepted.resolve, data() {} } });
    using socket = connectTo(server.port, SOCK_STREAM);
    const text = Bun.file(socket.fd).text();
    await untilWatched(socket.fd);
    (await accepted.promise).terminate();
    await expect(text).rejects.toMatchObject({ syscall: "epoll_ctl" });
    expect(() => readSync(socket.fd, Buffer.alloc(1))).toThrow(expect.objectContaining({ code: "ECONNRESET" }));
  });
});

// epoll keeps the entry while the pipe is open elsewhere, and only the closed number could remove it.
test.skipIf(!isLinux)(
  "a pipe gets ready after the read that waited for it was cancelled and its fd closed",
  async () => {
    using dir = tempDir("bun-file-fd-read", {});
    const script = `
    import { openFifo, untilWatched } from ${JSON.stringify(join(import.meta.dir, "..", "io", "fifo-helpers.ts"))};
    import { mkdirSync, writeSync } from "node:fs";
    const open = dir => (mkdirSync(dir), openFifo(dir));
    // The thread that waits handles everything in order.
    async function fence(dir) {
      using fifo = open(dir);
      const text = Bun.file(fifo.reader).slice(0, 1).text();
      await untilWatched(fifo.reader);
      writeSync(fifo.writer, "y");
      console.log(await text);
    }

    const stale = Array.from({ length: 8 }, (_, i) => open("stale-" + i));
    await using holder = Bun.spawn({ cmd: ["cat"], stdio: ["pipe", "ignore", "ignore", ...stale.map(fifo => fifo.reader)] });
    const graph = new Bun.ModuleGraph();
    for (const fifo of stale) graph.run(() => void Bun.file(fifo.reader).text());
    for (const fifo of stale) await untilWatched(fifo.reader);
    for (const fifo of stale) fifo.close(fifo.reader);
    graph.dispose();
    await fence("cancelled");
    // Takes over the memory of the jobs.
    const junk = Array.from({ length: 1000 }, (_, i) => new Blob([Buffer.alloc(64 + (i % 60) * 16, 2)]));
    for (const fifo of stale) writeSync(fifo.writer, "x");
    await fence("reported");
  `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], cwd: String(dir), env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "y\ny\n", stderr: "", exitCode: 0 });
  },
);

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// FUSE, /proc/kmsg and trace_pipe do this, and need root.
test.skipIf(!isLinux || !cc)("read() is called again after EAGAIN from a regular file", async () => {
  using dir = tempDir("bun-file-fd-read", { "file.txt": "hello" });
  const file = join(String(dir), "file.txt");
  const supervisor = join(String(dir), "fail-nth-read");
  const source = join(import.meta.dir, "..", "io", "fail-nth-read.c");
  await using compile = Bun.spawn({ cmd: [cc!, "-O0", "-o", supervisor, source], env: bunEnv, stderr: "inherit" });
  expect(await compile.exited).toBe(0);

  // The second read() is the one that finds the end of the file, so no bytes are lost.
  const failSecondRead = [supervisor, file, "2", String(constants.errno.EAGAIN), "--"];
  await using proc = Bun.spawn({
    cmd: [...failSecondRead, bunExe(), "-e", "console.log(await Bun.file(process.argv[1]).text())", file],
    // LeakSanitizer does not work under ptrace.
    env: {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      LSAN_OPTIONS: "detect_leaks=0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("hello\n");
  expect(stderr).toContain("matched read() calls on target: 3\n");
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux)("a write that has waited ends while other jobs hold every pool thread", async () => {
  using dir = tempDir("bun-file-fd-read", {});
  const script = `
    import { fill, openFifo, untilWatched } from ${JSON.stringify(join(import.meta.dir, "..", "io", "fifo-helpers.ts"))};
    import { mkdirSync, openSync, read, readSync, writeSync } from "node:fs";
    const open = dir => (mkdirSync(dir), openFifo(dir));
    using full = open("full");
    using silent = open("silent");
    const [writer, reader] = [openSync(full.path, "w"), openSync(silent.path, "r")]; // They block.
    const buffer = Buffer.alloc(fill(full.writer));
    function take(length) {
      for (;;) {
        try {
          return readSync(full.reader, buffer, 0, length);
        } catch (e) {
          if (e.code !== "EAGAIN") throw e;
        }
      }
    }

    const file = Bun.file(writer);
    file.size;
    const written = Bun.write(file, new Blob([Buffer.alloc(buffer.length + 1)]));
    await untilWatched(writer);
    take(buffer.length);
    // The job is in write(), with one byte that does not fit.
    take(1);
    for (let i = 0; i < 8; i++) read(reader, Buffer.alloc(1), () => {});
    take(buffer.length);
    console.log((await written) - buffer.length);
    writeSync(silent.writer, "12345678");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    cwd: String(dir),
    env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
});

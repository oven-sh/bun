import { describe, expect, test } from "bun:test";
import { closeSync, openSync } from "fs";
import { bunEnv, bunExe, isPosix, isWindows, tempDir } from "harness";
import { join } from "path";

// Reading a Bun.file() backed by a file descriptor goes through
// ReadFile.runAsync -> getFd (opened_fd already set) -> runAsyncWithFD ->
// resolveSizeAndLastModified, which derives total_size from fstat. That
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

    // total_size should come from fstat (10), not from the requested slice
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

// FileReader.onStart() increments the parent refcount and sets
// waiting_for_onReaderDone=true so the native source outlives the JS wrapper
// until I/O completes. On POSIX, when a read syscall fails,
// PosixBufferedReader.onError only invokes onReaderError and does not follow
// up with done()/onReaderDone. FileReader.onReaderError previously rejected
// the pending pull but never cleared waiting_for_onReaderDone or called
// decrementCount(), so after JS finalize the refcount sat at 1, deinit never
// ran, and the dup'd fd/poll leaked forever.
test.skipIf(!isPosix)("Bun.file(fd).stream() does not leak fds when read fails (ECONNRESET)", async () => {
  // Run in a subprocess so fd counting is not polluted by the test runner's
  // own descriptors and GC finalization is deterministic at exit.
  const fixture = /* js */ `
    import net from "node:net";
    import fs from "node:fs";

    const countFds = () =>
      fs.readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").length;

    // Bun.listen socket.terminate() closes with SO_LINGER{1,0} so the peer's
    // next recv() returns ECONNRESET, which is the read-syscall error path
    // (PosixBufferedReader.onError -> FileReader.onReaderError) we need.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) { socket.terminate(); },
        open() {}, close() {}, error() {},
      },
    });

    async function once() {
      const sock = new net.Socket();
      await new Promise((resolve, reject) => {
        sock.once("connect", resolve);
        sock.once("error", reject);
        sock.connect(server.port, "127.0.0.1");
      });
      const fd = sock._handle.fd;

      // getReader() triggers FileReader.onStart() synchronously: dups fd,
      // registers epoll poll, increments refcount.
      const reader = Bun.file(fd).stream().getReader();

      // Wake the server so it RSTs us.
      sock.write("x");

      let caught;
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch (e) {
        caught = e;
      }
      sock.destroy();
      return caught;
    }

    // Warm up so any one-time allocations (epoll fd, etc.) don't count as leaks.
    await once();
    Bun.gc(true);
    const before = countFds();

    let errored = 0;
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      if (await once()) errored++;
    }

    Bun.gc(true);
    await Bun.sleep(0);
    Bun.gc(true);
    const after = countFds();

    console.log(JSON.stringify({ before, after, leaked: after - before, errored, iterations }));
    server.stop(true);
    // Leaked polls keep the event loop alive on the buggy build; exit
    // explicitly so the fd-count assertion above is what fails, not a timeout.
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  // The read must actually fail with ECONNRESET; if it doesn't, the test
  // isn't exercising the onReaderError path and would pass vacuously.
  expect(result.errored).toBeGreaterThan(result.iterations / 2);
  // Allow a little slack for incidental fds, but a per-iteration leak would
  // show ~iterations extra fds here.
  expect(result.leaked).toBeLessThan(5);
  expect(exitCode).toBe(0);
});

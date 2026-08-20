import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// stream() dup()s the descriptor when the stream starts. On Windows a
// descriptor that is not open used to be reported as EMFILE: it maps to
// INVALID_HANDLE_VALUE, which DuplicateHandle accepts as the current-process
// pseudo handle.
describe.concurrent("Bun.file(fd).stream() on a descriptor that is not open", () => {
  const dupSyscall = isWindows ? "dup" : "fcntl";

  test("descriptor that was never opened fails with EBADF", async () => {
    const fd = 1 << 20;
    let error: unknown;
    try {
      await Bun.file(fd).stream().text();
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: "EBADF", syscall: dupSyscall, fd });
  });

  test("descriptor that was closed fails with EBADF", async () => {
    // A fresh process, so nothing can reuse the number between close and stream().
    using dir = tempDir("bun-file-closed-fd-stream", { "fd-closed.txt": "hello" });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { openSync, closeSync } = require("fs");
        const fd = openSync("fd-closed.txt", "r");
        closeSync(fd);
        try {
          await Bun.file(fd).stream().text();
          console.log(JSON.stringify({ resolved: true }));
        } catch (err) {
          console.log(JSON.stringify({ code: err.code, syscall: err.syscall, fdMatches: err.fd === fd }));
        }
        `,
      ],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ code: "EBADF", syscall: dupSyscall, fdMatches: true });
    expect(exitCode).toBe(0);
  });

  test("descriptor that is open still streams", async () => {
    // This file rather than a tempDir: the stream closes its copy of the
    // descriptor asynchronously, which would race the directory removal.
    const fd = openSync(import.meta.path, "r");
    try {
      expect(await Bun.file(fd).stream().text()).toBe(readFileSync(import.meta.path, "utf8"));
    } finally {
      closeSync(fd);
    }
  });
});

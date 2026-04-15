import { describe, expect, test } from "bun:test";
import { closeSync, openSync, unlinkSync, writeFileSync } from "fs";
import { isWindows, tmpdirSync } from "harness";
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
    const dir = tmpdirSync();
    const path = join(dir, "fd-read.txt");
    writeFileSync(path, "hello from fd");
    try {
      // Each read needs a fresh fd because Bun.file(fd) does not own or rewind
      // the descriptor, and a completed read leaves it positioned at EOF.
      expect(await withFd(path, fd => Bun.file(fd).text())).toBe("hello from fd");

      const buf = await withFd(path, fd => Bun.file(fd).arrayBuffer());
      expect(new Uint8Array(buf)).toEqual(new TextEncoder().encode("hello from fd"));
    } finally {
      unlinkSync(path);
    }
  });

  test("slice() with an end beyond the real size reads the actual file contents", async () => {
    const dir = tmpdirSync();
    const path = join(dir, "fd-slice.txt");
    writeFileSync(path, "0123456789");
    try {
      // total_size should come from fstat (10), not from the requested slice
      // end, so the initial buffer allocation stays small.
      expect(await withFd(path, fd => Bun.file(fd).slice(0, Number.MAX_SAFE_INTEGER).text())).toBe("0123456789");
      expect(await withFd(path, fd => Bun.file(fd).slice(2, 5).text())).toBe("234");
    } finally {
      unlinkSync(path);
    }
  });

  test("empty regular file via fd resolves with empty content", async () => {
    const dir = tmpdirSync();
    const path = join(dir, "fd-empty.txt");
    writeFileSync(path, "");
    try {
      expect(await withFd(path, fd => Bun.file(fd).text())).toBe("");
      expect((await withFd(path, fd => Bun.file(fd).arrayBuffer())).byteLength).toBe(0);
    } finally {
      unlinkSync(path);
    }
  });
});

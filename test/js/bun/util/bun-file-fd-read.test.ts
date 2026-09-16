import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readSync } from "fs";
import { isWindows, tempDir } from "harness";
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

// A read moves the descriptor's position everywhere but on Windows, where a regular file is read at a
// position of the read's own and the descriptor's stays where it was.
test("Bun.file(fd) reads from the descriptor's position, which a read moves except on Windows", async () => {
  using dir = tempDir("bun-file-fd-position", { "file.txt": "0123456789" });
  const fd = openSync(join(String(dir), "file.txt"), "r");
  try {
    const first = await Bun.file(fd).text();
    const second = await Bun.file(fd).text();
    const buffer = Buffer.alloc(4);
    const left = readSync(fd, buffer, 0, 4, null);
    expect({ first, second, left: buffer.subarray(0, left).toString() }).toEqual(
      isWindows
        ? { first: "0123456789", second: "0123456789", left: "0123" }
        : { first: "0123456789", second: "", left: "" },
    );
  } finally {
    closeSync(fd);
  }
});

test.skipIf(!isWindows)("Bun.file(fd).slice() reads its range whatever the descriptor's position is", async () => {
  using dir = tempDir("bun-file-fd-slice-position", { "file.txt": "0123456789" });
  const fd = openSync(join(String(dir), "file.txt"), "r");
  try {
    const buffer = Buffer.alloc(3);
    readSync(fd, buffer, 0, 3, null);
    const sliced = await Bun.file(fd).slice(2, 5).text();
    const again = await Bun.file(fd).slice(2, 5).text();
    const left = readSync(fd, buffer, 0, 3, null);
    expect({ sliced, again, next: buffer.subarray(0, left).toString() }).toEqual({
      sliced: "234",
      again: "234",
      next: "345",
    });
  } finally {
    closeSync(fd);
  }
});

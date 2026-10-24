import { describe, expect, test } from "bun:test";
import { appendFileSync, closeSync, openSync } from "fs";
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

// `.size` and exists() ask for the size of the file behind the descriptor. The answer is not the byte budget of a later read.
test.each([
  [".size", (file: Bun.BunFile) => void file.size],
  ["exists()", (file: Bun.BunFile) => file.exists()],
])("Bun.file(fd): %s, then the file grows: text() returns all of it", async (_name, ask) => {
  using dir = tempDir("bun-file-fd-read", { "fd-grow.txt": "0123456789" });
  const path = join(String(dir), "fd-grow.txt");
  const fd = openSync(path, "r");
  try {
    const file = Bun.file(fd);
    await ask(file);
    appendFileSync(path, "abcdefghij");
    expect(await file.text()).toBe("0123456789abcdefghij");
  } finally {
    closeSync(fd);
  }
});

test("Bun.stdin.text() returns a file on stdin as it is now, after Bun.stdin.size", async () => {
  using dir = tempDir("bun-stdin-size", { "in.txt": "0123456789" });
  const input = join(String(dir), "in.txt");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `void Bun.stdin.size;
       require("node:fs").appendFileSync(process.env.INPUT, "abcdefghij");
       process.stdout.write(await Bun.stdin.text());`,
    ],
    env: { ...bunEnv, INPUT: input },
    stdin: Bun.file(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0123456789abcdefghij", stderr: "", exitCode: 0 });
});

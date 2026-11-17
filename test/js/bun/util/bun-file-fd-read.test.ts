import { describe, expect, test } from "bun:test";
import { closeSync, fstatSync, openSync, writeSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { constants } from "os";
import { join } from "path";
import { openFifo, untilWaits } from "../io/fifo-helpers";

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

function fifoIn(dir: ReturnType<typeof tempDir>) {
  const path = join(String(dir), "fifo");
  mkfifo(path);
  return Object.assign(openFifo(path), { path });
}

test.skipIf(isWindows)("an empty slice of a pipe that nobody writes to resolves", async () => {
  using dir = tempDir("bun-file-fd-read", {});
  using fifo = fifoIn(dir);
  expect(await Bun.file(fifo.path).slice(0, 0).text()).toBe("");
  expect(await Bun.file(fifo.reader).slice(0, 0).text()).toBe("");
});

// /proc/self/fdinfo shows that a read waits.
describe.skipIf(!isLinux).concurrent("Bun.file(fd) read of an empty pipe", () => {
  const outcome = (promise: Promise<string>) => promise.catch(({ code, syscall }) => ({ code, syscall }));

  test("two reads wait on one descriptor", async () => {
    using dir = tempDir("bun-file-fd-read", {});
    using fifo = fifoIn(dir);
    const reads = Promise.all([outcome(Bun.file(fifo.reader).text()), outcome(Bun.file(fifo.reader).text())]);
    const waits = await untilWaits(fifo.inode, 2);
    writeSync(fifo.writer, "hello");
    fifo.close(fifo.writer);
    expect({ waits, reads: (await reads).sort() }).toEqual({ waits: 2, reads: ["", "hello"] });
  });

  test("finishes after the caller has closed the descriptor", async () => {
    using dir = tempDir("bun-file-fd-read", {});
    using fifo = fifoIn(dir);
    const read = outcome(Bun.file(fifo.reader).text());
    expect(await untilWaits(fifo.inode, 1)).toBe(1);
    fifo.close(fifo.reader);
    writeSync(fifo.writer, "late");
    fifo.close(fifo.writer);
    expect(await read).toBe("late");
  });

  test("rejects with ECONNRESET when the peer of a socket leaves with unread data", async () => {
    await using peer = Bun.spawn({ cmd: ["sleep", "60"], env: bunEnv, stdio: ["ignore", "ignore", "inherit", "pipe"] });
    const socket = peer.stdio[3] as number;
    writeSync(socket, "unread");
    const read = outcome(Bun.file(socket).text());
    expect(await untilWaits(fstatSync(socket).ino, 1)).toBe(1);
    peer.kill();
    expect(await read).toEqual({ code: "ECONNRESET", syscall: "read" });
  });
});

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// FUSE, /proc/kmsg and trace_pipe do this, and need root.
test.skipIf(!isLinux || !cc)("read() is called again after EAGAIN from a regular file", async () => {
  using dir = tempDir("bun-file-fd-read", { "file.txt": "hello" });
  const file = join(String(dir), "file.txt");
  const supervisor = join(String(dir), "fail-nth-read");
  const source = join(import.meta.dir, "..", "io", "fail-nth-read.c");
  expect(Bun.spawnSync({ cmd: [cc!, "-o", supervisor, source], env: bunEnv, stderr: "inherit" }).exitCode).toBe(0);

  // The second read() is the one that finds the end of the file, so no bytes are lost.
  const failSecondRead = [supervisor, file, "2", String(constants.errno.EAGAIN), "--"];
  await using proc = Bun.spawn({
    cmd: [...failSecondRead, bunExe(), "-e", "console.log(await Bun.file(process.argv[1]).text())", file],
    // LeakSanitizer does not work under ptrace.
    env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({
    stdout: "hello\n",
    stderr: "[fail-nth-read] matched read() calls on target: 3\n",
  });
  expect(exitCode).toBe(0);
});

import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readdirSync, readFileSync, readlinkSync, writeSync } from "fs";
import { isLinux, isMusl, isWindows, tempDir } from "harness";
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

// Bun.file().text() on a pollable fd parks its read on the io thread's epoll.
// A hung-up tty wakes it with EPOLLERR|EPOLLHUP|EPOLLIN. That flag carries no
// errno: the next read() returns the remaining bytes, then 0. It must not be
// reported as an error, and the bytes read before the hangup must survive.
//
// Linux only: the wake-up comes from epoll, and the wait below reads
// /proc/self/fdinfo.

// openpty via bun:ffi. glibc keeps openpty in libutil; musl keeps everything
// in libc. Same pattern as test/js/bun/terminal/terminal-spawn.test.ts.
const openptyDecl = {
  openpty: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
} as const;
const closeDecl = {
  close: { args: [FFIType.i32], returns: FFIType.i32 },
} as const;

function openPty() {
  const lib = isMusl
    ? dlopen(process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1", {
        ...openptyDecl,
        ...closeDecl,
      })
    : dlopen("libutil.so.1", openptyDecl);
  const libc = isMusl ? lib : dlopen("libc.so.6", closeDecl);
  const masterBuf = new Int32Array(1);
  const slaveBuf = new Int32Array(1);
  expect((lib.symbols as any).openpty(masterBuf, slaveBuf, null, null, null)).toBe(0);
  const close = (fd: number) => (libc.symbols as any).close(fd);
  return {
    master: masterBuf[0],
    slave: slaveBuf[0],
    closeMaster: () => close(masterBuf[0]),
    [Symbol.dispose]() {
      close(masterBuf[0]);
      close(slaveBuf[0]);
    },
  };
}

// Resolves once `fd` is armed for EPOLLIN in one of this process's epoll
// instances. That is the moment the read is parked.
async function waitForEpollRegistration(fd: number) {
  const deadline = Date.now() + 30_000;
  const re = new RegExp(`^tfd:\\s+${fd}\\s+events:\\s+([0-9a-f]+)`, "m");
  while (Date.now() < deadline) {
    for (const name of readdirSync("/proc/self/fd")) {
      let info: string;
      try {
        if (readlinkSync(`/proc/self/fd/${name}`) !== "anon_inode:[eventpoll]") continue;
        info = readFileSync(`/proc/self/fdinfo/${name}`, "utf8");
      } catch {
        continue;
      }
      const m = info.match(re);
      if (m && parseInt(m[1], 16) & 1) return;
    }
    await Bun.sleep(1);
  }
  throw new Error(`fd ${fd} was never registered with epoll`);
}

describe.skipIf(!isLinux)("Bun.file read on a tty", () => {
  test("text() on a tty that hangs up while parked returns the bytes read so far", async () => {
    using pty = openPty();
    writeSync(pty.master, "hello\n");
    const text = Bun.file(pty.slave).text();
    await waitForEpollRegistration(pty.slave);
    pty.closeMaster();
    expect(await text).toBe("hello\n");
  });
});

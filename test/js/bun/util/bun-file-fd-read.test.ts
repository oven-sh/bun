import { describe, expect, test } from "bun:test";
import { closeSync, openSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";
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

// When epoll reports EPOLLERR for a ReadFile/WriteFile fd, onUpdateEpoll
// previously called getErrno(event.events) — but event.events is an epoll
// flag bitmask, not a syscall return value, so getErrno() always returned
// .SUCCESS (0). That zero errno reached errnoToZigErr() which asserts on
// non-zero, crashing the IO thread. This test provokes EPOLLERR by sending a
// TCP RST to a socket that ReadFile is polling on; the fix queries SO_ERROR
// for the real errno and surfaces it as a rejection.
test.skipIf(!isLinux)("Bun.file(fd) read rejects (does not crash) when EPOLLERR fires", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { dlopen, FFIType, ptr } = require("bun:ffi");
const net = require("net");

const libc = dlopen(process.env.LIBC_PATH, {
  socket: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  connect: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  setsockopt: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
});

const AF_INET = 2, SOCK_STREAM = 1, SOL_SOCKET = 1, SO_LINGER = 13;

function sockaddr_in(port) {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, AF_INET, true);
  dv.setUint16(2, port, false);
  buf[4] = 127; buf[7] = 1;
  return buf;
}

const server = net.createServer();
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

let serverSocket;
const gotConn = new Promise(r => server.on("connection", s => { serverSocket = s; r(); }));

// Raw client socket owned only by the io.zig epoll loop (not usockets), so
// nothing else drains the pending error before ReadFile sees EPOLLERR.
const fd = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
if (fd < 0) throw new Error("socket() failed");
const addr = sockaddr_in(port);
if (libc.symbols.connect(fd, ptr(addr), 16) !== 0) throw new Error("connect() failed");
await gotConn;
serverSocket.pause();

// ReadFile fstat()s the fd, sees a socket, sets could_block=true, polls for
// readable and finds nothing, then registers with the io.zig epoll.
const read = Bun.file(fd).text().then(
  v => ({ ok: true, v }),
  e => ({ ok: false, code: e?.code }),
);
await Bun.sleep(100);

// SO_LINGER with l_linger=0 makes the close() send RST instead of FIN. The
// client's epoll entry then reports EPOLLERR with a pending ECONNRESET.
const linger = new Int32Array([1, 0]);
libc.symbols.setsockopt(serverSocket._handle.fd, SOL_SOCKET, SO_LINGER, ptr(linger), 8);
serverSocket.destroy();

const result = await read;
server.close();
console.log(JSON.stringify(result));
`,
    ],
    env: { ...bunEnv, LIBC_PATH: libcPathForDlopen() },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // If the RST lands before ReadFile registers with epoll, recv() on the
  // worker thread observes ECONNRESET directly — same user-visible result.
  expect(JSON.parse(stdout.trim())).toEqual({ ok: false, code: "ECONNRESET" });
  expect(exitCode).toBe(0);
});

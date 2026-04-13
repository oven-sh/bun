// Tests for `internalBinding('util').guessHandleType(fd)` — the Zig impl
// in src/bun.js/node/node_util_binding.zig. Exposed for testing via
// `bun:internal-for-testing`.
import { createSocketPair, guessHandleType, guessHandleTypeNative, memfd_create } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, tempDir } from "harness";
import { execFileSync } from "node:child_process";
import { closeSync, constants as fsConstants, openSync, rmSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { devNull } from "node:os";
import path from "node:path";

const fixture = path.join(import.meta.dir, "guess-handle-type-fixture.cjs");

// Node's internal/util.js: const handleTypes = ['TCP', 'TTY', 'UDP', 'FILE', 'PIPE', 'UNKNOWN'];
// The native binding returns the index; the wrapper returns the string.
describe("guessHandleType native binding", () => {
  test("invalid (not-open) fd → index 5 / UNKNOWN", () => {
    // Pick an fd well above anything the test runner would have open.
    const badFd = 2 ** 30 - 1;
    expect(guessHandleTypeNative(badFd)).toBe(5);
    expect(guessHandleType(badFd)).toBe("UNKNOWN");
  });

  test("throws TypeError on non-number fd", () => {
    expect(() => (guessHandleTypeNative as any)("0")).toThrow(TypeError);
    expect(() => (guessHandleTypeNative as any)({})).toThrow(TypeError);
  });
});

describe("guessHandleType per-fd-type", () => {
  test("regular file → FILE", () => {
    using dir = tempDir("ght-file", { "f.txt": "x" });
    const fd = openSync(path.join(String(dir), "f.txt"), "r");
    try {
      expect(guessHandleType(fd)).toBe("FILE");
    } finally {
      closeSync(fd);
    }
  });

  test("null device (character device) → FILE", () => {
    const fd = openSync(devNull, "r");
    try {
      expect(guessHandleType(fd)).toBe("FILE");
    } finally {
      closeSync(fd);
    }
  });

  test("not-open fd → UNKNOWN", () => {
    // Pick an fd well above anything the test runner would have open.
    expect(guessHandleType(2 ** 30 - 1)).toBe("UNKNOWN");
  });

  // Node asserts `fd >= 0` (CHECK-aborts). Bun returns UNKNOWN instead of
  // crashing; we only assert Bun doesn't crash here, not parity.
  test("negative fd → UNKNOWN (Bun is crash-safe; Node CHECK-aborts)", () => {
    expect(guessHandleType(-1)).toBe("UNKNOWN");
  });

  test.skipIf(isWindows)("directory → UNKNOWN", () => {
    using dir = tempDir("ght-dir", {});
    const fd = openSync(String(dir), "r");
    try {
      expect(guessHandleType(fd)).toBe("UNKNOWN");
    } finally {
      closeSync(fd);
    }
  });

  // AF_UNIX SOCK_STREAM socketpair — Node/libuv map this to PIPE.
  test.skipIf(isWindows)("AF_UNIX stream socket (socketpair) → PIPE", () => {
    const [a, b] = createSocketPair();
    try {
      expect(guessHandleType(a)).toBe("PIPE");
      expect(guessHandleType(b)).toBe("PIPE");
    } finally {
      closeSync(a);
      closeSync(b);
    }
  });

  // FIFO (named pipe). Linux/macOS only; use `mkfifo` via shell.
  test.skipIf(!isPosix)("FIFO (named pipe) → PIPE", () => {
    using dir = tempDir("ght-fifo", {});
    const fifo = path.join(String(dir), "p");
    execFileSync("mkfifo", [fifo]);
    const fd = openSync(fifo, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    try {
      expect(guessHandleType(fd)).toBe("PIPE");
    } finally {
      closeSync(fd);
      rmSync(fifo, { force: true });
    }
  });

  // TCP listening socket. On POSIX, node:net exposes the underlying fd via
  // `server._handle.fd`. On Windows libuv doesn't expose int fds.
  test.skipIf(isWindows)("AF_INET SOCK_STREAM (TCP) → TCP", async () => {
    const server = createTcpServer();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
    await promise;
    try {
      const fd = (server as any)._handle?.fd;
      if (typeof fd !== "number" || fd < 0) {
        // If Bun's net.Server doesn't expose fd yet, don't fail the suite.
        console.warn("net.Server._handle.fd not available; skipping TCP assertion");
        return;
      }
      expect(guessHandleType(fd)).toBe("TCP");
    } finally {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    }
  });

  // UDP: Bun's node:dgram handle does not expose a numeric fd today, and
  // Bun.udpSocket has no `.fd` either, so there is no way to obtain a bound
  // AF_INET SOCK_DGRAM fd in-process. The DGRAM branch in guessHandleTypeFromFd
  // shares getsockname()/getsockopt(SO_TYPE) with the TCP path exercised above.

  // TTY: only assert when a controlling terminal is reachable.
  test.skipIf(!isPosix)("TTY (/dev/tty when available) → TTY", () => {
    let fd: number;
    try {
      fd = openSync("/dev/tty", "r");
    } catch {
      // No controlling terminal (CI). Nothing to assert.
      return;
    }
    try {
      expect(guessHandleType(fd)).toBe("TTY");
    } finally {
      closeSync(fd);
    }
  });
});

// The contract that `process.stdin`'s createHandle/getStdin depend on: what
// fd 0 looks like to a child under each parent stdio configuration.
describe.concurrent("guessHandleType stdio matrix (child fd 0)", () => {
  async function runBun(stdin: Parameters<typeof Bun.spawn>[0]["stdin"]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, "0"],
      env: bunEnv,
      stdin,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const parsed = JSON.parse(stdout.trim()) as string[];
    expect(parsed).toHaveLength(1);
    expect(exitCode).toBe(0);
    return parsed;
  }

  test('stdin: "pipe" → PIPE', async () => {
    const [result] = await runBun("pipe");
    expect(result).toBe("PIPE");
  });

  test('stdin: "ignore" → FILE (null device)', async () => {
    const [result] = await runBun("ignore");
    expect(result).toBe("FILE");
  });

  test("stdin: file fd → FILE", async () => {
    using dir = tempDir("ght-stdin-file", { "in.txt": "" });
    const fd = openSync(path.join(String(dir), "in.txt"), "r");
    try {
      const [result] = await runBun(fd);
      expect(result).toBe("FILE");
    } finally {
      closeSync(fd);
    }
  });

  // stdin: "inherit" — child sees whatever the parent's stdin is. In CI that
  // is usually FILE or PIPE; under a terminal it's TTY. Assert only that it
  // resolves to one of the valid handle types and matches what guessHandleType
  // returns for fd 0 in this process.
  test('stdin: "inherit" → matches parent fd 0', async () => {
    const [result] = await runBun("inherit");
    expect(["TCP", "TTY", "UDP", "FILE", "PIPE", "UNKNOWN"]).toContain(result);
    expect(result).toBe(guessHandleType(0));
  });
});

// On Linux, use memfd to get a regular-file fd without touching disk — catches
// any path where Bun might special-case on-disk files.
test.skipIf(!isLinux)("memfd → FILE", () => {
  const fd = memfd_create(16);
  try {
    expect(guessHandleType(fd)).toBe("FILE");
  } finally {
    closeSync(fd);
  }
});

import { dlopen, ptr } from "bun:ffi";
import { expect } from "bun:test";
import { bunEnv, libcPathForDlopen } from "harness";
import { closeSync, writeSync } from "node:fs";

const [F_SETPIPE_SZ, AF_UNIX, SOCK_STREAM, SOL_SOCKET, SO_SNDBUF, MSG_DONTWAIT] = [1031, 1, 1, 1, 7, 0x40];
const openLibc = () =>
  dlopen(libcPathForDlopen(), {
    pipe: { args: ["ptr"], returns: "int" },
    fcntl: { args: ["int", "int", "int"], returns: "int" },
    socketpair: { args: ["int", "int", "int", "ptr"], returns: "int" },
    setsockopt: { args: ["int", "int", "int", "ptr", "u32"], returns: "int" },
    send: { args: ["int", "ptr", "usize", "int"], returns: "i64" },
  });

/** Puts a socketpair into `fds` and sends `input` with nothing reading. Returns how many bytes the socket took, or -1. */
function fillSocket(libc: ReturnType<typeof openLibc>, fds: Int32Array, input: Uint8Array) {
  if (libc.symbols.socketpair(AF_UNIX, SOCK_STREAM, 0, ptr(fds)) !== 0) return -1;
  if (libc.symbols.setsockopt(fds[1], SOL_SOCKET, SO_SNDBUF, ptr(new Int32Array([212_992])), 4) !== 0) return -1;
  return Number(libc.symbols.send(fds[1], ptr(input), input.length, MSG_DONTWAIT));
}

/**
 * Whether a socket of this host holds `size` bytes before anything reads them. The kernel cuts SO_SNDBUF to
 * net.core.wmem_max, so a host with a lower limit than the default cannot run the rows with a prefilled socket.
 */
export function socketHolds(size: number) {
  const libc = openLibc();
  const fds = new Int32Array([-1, -1]);
  try {
    return fillSocket(libc, fds, new Uint8Array(size)) === size;
  } finally {
    for (const fd of fds) if (fd !== -1) closeSync(fd);
    libc.close();
  }
}

/**
 * Runs `cmd` with a pipe or a socket on fd 0 that holds `input` and the EOF before the process exists, so nothing
 * depends on a writer's pace. Linux only: the default capacity of a pipe or of a socket is less than one read of Bun's
 * reader, and this raises it with F_SETPIPE_SZ or SO_SNDBUF.
 */
export async function runWithPrefilledStdin(
  cmd: string[],
  input: Uint8Array,
  { kind = "pipe" }: { kind?: "pipe" | "socket" } = {},
) {
  const libc = openLibc();
  const fds = new Int32Array([-1, -1]);
  try {
    if (kind === "pipe") {
      expect(libc.symbols.pipe(ptr(fds))).toBe(0);
      expect(libc.symbols.fcntl(fds[1], F_SETPIPE_SZ, 1 << 20)).toBeGreaterThanOrEqual(input.length);
      expect(writeSync(fds[1], input)).toBe(input.length);
    } else {
      expect(fillSocket(libc, fds, input)).toBe(input.length);
    }
    closeSync(fds[1]);
    fds[1] = -1;
    await using proc = Bun.spawn({ cmd, stdin: fds[0], stdout: "pipe", stderr: "pipe", env: bunEnv });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  } finally {
    for (const fd of fds) if (fd !== -1) closeSync(fd);
    libc.close();
  }
}

/** What the writers of these tests send: at each offset, the byte that `once-data-fixture.js` expects there. */
export function patterned(size: number) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i ^ (i >>> 8) ^ (i >>> 16)) & 255;
  return bytes;
}

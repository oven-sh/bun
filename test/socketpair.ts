import { dlopen, ptr } from "bun:ffi";
import { closeSync } from "node:fs";

// <sys/socket.h> on Linux and on macOS.
const linux = process.platform === "linux";
const AF_UNIX = 1;
const SOCK_STREAM = 1;
const SOL_SOCKET = linux ? 1 : 0xffff;
const SO_SNDBUF = linux ? 7 : 0x1001;
const SO_RCVBUF = linux ? 8 : 0x1002;
const MSG_DONTWAIT = linux ? 0x40 : 0x80;

/**
 * Unix stream sockets for a test that needs a source which hangs up with bytes unread.
 *
 * `libcPath` is `libcPathForDlopen()` of the harness. This module does not import the harness, because a
 * fixture uses it too and a debug build takes seconds to load the harness. A test gives the path to its
 * fixtures.
 */
export function unixSockets(libcPath: string) {
  const libc = dlopen(libcPath, {
    socketpair: { args: ["i32", "i32", "i32", "ptr"], returns: "i32" },
    setsockopt: { args: ["i32", "i32", "i32", "ptr", "u32"], returns: "i32" },
    send: { args: ["i32", "ptr", "usize", "i32"], returns: "i64" },
  }).symbols;

  // A socket holds 208 KiB by default on Linux and 8 KiB on macOS. The kernel cuts the request to its limit
  // (net.core.wmem_max, kern.ipc.maxsockbuf) and reports no error, so a test checks `holds()` first.
  function setBuffer(fd: number, option: number): void {
    if (libc.setsockopt(fd, SOL_SOCKET, option, ptr(new Int32Array([1 << 20])), 4) !== 0) {
      throw new Error(`setsockopt() failed on fd ${fd}`);
    }
  }

  /** Queues `bytes` on the socket `fd` and does not wait for room. Returns how many bytes the socket took. */
  function sendWithoutBlocking(fd: number, bytes: Uint8Array): number {
    return Number(libc.send(fd, ptr(bytes), bytes.length, MSG_DONTWAIT));
  }

  /** A connected pair of sockets that holds up to 1 MiB of unread bytes. */
  function pair() {
    const fds = new Int32Array(2);
    if (libc.socketpair(AF_UNIX, SOCK_STREAM, 0, ptr(fds)) !== 0) throw new Error("socketpair() failed");
    const [source, peer] = fds;
    setBuffer(peer, SO_SNDBUF);
    setBuffer(source, SO_RCVBUF);
    let peerIsOpen = true;
    return {
      source,
      peer,
      /** Queues `bytes` and closes the peer: `source` holds the bytes and the hangup. Returns the bytes queued. */
      hangUp(bytes: Uint8Array): number {
        const queued = sendWithoutBlocking(peer, bytes);
        closeSync(peer);
        peerIsOpen = false;
        return queued;
      },
      [Symbol.dispose]() {
        if (peerIsOpen) closeSync(peer);
        closeSync(source);
      },
    };
  }

  return {
    pair,
    sendWithoutBlocking,
    /** Asks the kernel to hold up to 1 MiB of unread bytes that are written to the socket `fd`. */
    raiseSendBuffer(fd: number): void {
      setBuffer(fd, SO_SNDBUF);
    },
    /** Whether a socket of this host holds `length` unread bytes. A host with a low limit does not. */
    holds(length: number): boolean {
      using probe = pair();
      return probe.hangUp(Buffer.alloc(length)) === length;
    },
  };
}

const unit = Buffer.from(
  Array.from({ length: 251 }, (_, i) => "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(i % 36)),
);

/**
 * Bytes that depend on their position, so a part that arrives twice or out of order does not compare equal.
 * The pattern repeats every 251 bytes. 251 is prime, so no read size is a multiple of it. An HTML parser
 * copies these bytes as they are.
 */
export function positionDependentBytes(length: number): Buffer {
  return Buffer.alloc(length, unit);
}

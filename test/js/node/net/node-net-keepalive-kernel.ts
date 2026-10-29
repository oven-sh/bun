// What the kernel has for the TCP keep-alive of a socket, read with getsockopt(2) through bun:ffi.
import { dlopen, ptr } from "bun:ffi";
import { isWindows, libcPathForDlopen } from "harness";

// SOL_SOCKET and SO_KEEPALIVE, then TCP_KEEPIDLE (TCP_KEEPALIVE on macOS), TCP_KEEPINTVL and TCP_KEEPCNT of IPPROTO_TCP.
const names = {
  linux: { socket: 1, keepAlive: 9, idle: 4, interval: 5, count: 6 },
  darwin: { socket: 0xffff, keepAlive: 0x0008, idle: 0x10, interval: 0x101, count: 0x102 },
  win32: { socket: 0xffff, keepAlive: 0x0008, idle: 3, interval: 17, count: 16 },
}[process.platform as string];
const IPPROTO_TCP = 6;

/** False on a system whose option numbers are not listed here. */
export const canReadKeepAlive = names !== undefined;

export type KeepAlive = [enabled: number, idle: number, interval: number, count: number];

let getsockopt: ((fd: number, level: number, name: number, value: number, length: number) => number) | undefined;

function option(fd: number, level: number, name: number) {
  getsockopt ??= isWindows
    ? dlopen("ws2_32.dll", { getsockopt: { args: ["u64", "int", "int", "ptr", "ptr"], returns: "int" } }).symbols
        .getsockopt
    : dlopen(libcPathForDlopen(), { getsockopt: { args: ["int", "int", "int", "ptr", "ptr"], returns: "int" } }).symbols
        .getsockopt;
  const value = new Int32Array(1);
  const length = new Int32Array([value.byteLength]);
  if (getsockopt(fd, level, name, ptr(value), ptr(length)) !== 0) {
    throw new Error(`getsockopt(${fd}, ${level}, ${name}) failed`);
  }
  return value[0];
}

/** Of a `net.Socket`, or of a socket of `Bun.connect()`: SO_KEEPALIVE as 0 or 1, then the seconds before the first probe, the seconds between two probes and the count of probes. */
export function keepAliveOf(socket: object): KeepAlive {
  const { fd } = "fd" in socket ? (socket as { fd: number }) : (socket as { _handle: { fd: number } })._handle;
  return [
    // macOS answers with the flag itself, 8.
    option(fd, names!.socket, names!.keepAlive) ? 1 : 0,
    option(fd, IPPROTO_TCP, names!.idle),
    option(fd, IPPROTO_TCP, names!.interval),
    option(fd, IPPROTO_TCP, names!.count),
  ];
}

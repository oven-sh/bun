// The transport of tls-pause-parked-handshake-fixture.ts and tls-close-all-sibling-fixture.ts.
//
// Both count what one loop iteration reads, so a write() must return with its bytes already in
// the peer's receive buffer. TCP loopback does that on Linux and Windows. macOS hands a loopback
// segment to the dlil input thread first, and on a busy machine it arrives many iterations later.
// An AF_UNIX stream delivers inside write() everywhere. So on macOS the test passes a directory
// (runFixture in socket-syscall-fault.test.ts) and the fixtures use unix sockets in it. The
// handshake queue and the teardown walk are the same code for both kinds of socket.
import type { UnixSocketOptions } from "bun";
import { join } from "node:path";

type Options<Data> = Omit<UnixSocketOptions<Data>, "unix">;

/** `address` is what connect() and node's net.connect() take: the port, or the unix socket path. */
export function listen<Data = undefined>(name: string, options: Options<Data>) {
  const dir = process.env.TLS_FIXTURE_UNIX_DIR;
  if (dir) {
    const unix = join(dir, name + ".sock");
    return { server: Bun.listen<Data>({ ...options, unix }), address: unix };
  }
  const server = Bun.listen<Data>({ ...options, hostname: "127.0.0.1", port: 0 });
  return { server, address: server.port };
}

export function connect<Data = undefined>(address: string | number, options: Options<Data>) {
  return typeof address === "string"
    ? Bun.connect<Data>({ ...options, unix: address })
    : Bun.connect<Data>({ ...options, hostname: "127.0.0.1", port: address });
}

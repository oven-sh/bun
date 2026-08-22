import { dlopen } from "bun:ffi";
import { isLinux, isWindows, libcPathForDlopen } from "harness";
import net from "node:net";

export interface Blackhole {
  hostname: string;
  port: number;
  [Symbol.dispose](): void;
}

/**
 * A TCP address whose connect(2) returns EINPROGRESS and never completes, for
 * tests that need a socket to stay in the connecting state until they close
 * it. Tests used to dial a TEST-NET-1 address (192.0.2.1) for this, which only
 * works on a network that silently drops the packets. Some CI hosts get an
 * ICMP unreachable back within milliseconds or have no route at all, and the
 * connect then fails instead.
 *
 * On Linux and macOS this is a listener on 127.0.0.1 that nobody accepts from.
 * Once its accept queue is full, the kernel drops every further SYN, and a
 * connect to the port sits in SYN_SENT until it is closed. Bun's own listeners
 * accept every connection and do not expose the backlog, so the listener is a
 * raw libc socket, and a few connections of our own fill its queue. The queue
 * is kernel state, so child processes can dial the address too.
 *
 * Windows answers a full accept queue with RST, so there this is still
 * TEST-NET-1, which the Windows CI network drops.
 */
export async function blackholeListener(): Promise<Blackhole> {
  if (isWindows) {
    return { hostname: "192.0.2.1", port: 80, [Symbol.dispose]() {} };
  }

  const libc = dlopen(libcPathForDlopen(), {
    socket: { args: ["int", "int", "int"], returns: "int" },
    bind: { args: ["int", "ptr", "u32"], returns: "int" },
    listen: { args: ["int", "int"], returns: "int" },
    getsockname: { args: ["int", "ptr", "ptr"], returns: "int" },
    close: { args: ["int"], returns: "int" },
  });
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  // struct sockaddr_in for 127.0.0.1, port 0. Linux starts it with a 16-bit
  // native-endian sin_family; the BSDs with sin_len followed by sin_family.
  const addr = new Uint8Array(16);
  if (isLinux) {
    new DataView(addr.buffer).setUint16(0, AF_INET, true);
  } else {
    addr[0] = addr.byteLength;
    addr[1] = AF_INET;
  }
  addr.set([127, 0, 0, 1], 4);

  const fd = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) throw new Error("socket() failed");
  const fillers: net.Socket[] = [];
  const dispose = () => {
    for (const filler of fillers) filler.destroy();
    libc.symbols.close(fd);
  };

  try {
    if (libc.symbols.bind(fd, addr, addr.byteLength) !== 0) throw new Error("bind() failed");
    // The smallest queue each kernel allows: Linux admits backlog + 1
    // connections, and macOS turns a backlog of 0 into the default.
    if (libc.symbols.listen(fd, isLinux ? 0 : 1) !== 0) throw new Error("listen() failed");
    const addrLen = new Uint32Array([addr.byteLength]);
    if (libc.symbols.getsockname(fd, addr, addrLen) !== 0) throw new Error("getsockname() failed");
    const port = (addr[2] << 8) | addr[3];

    // More fillers than either kernel admits. The first SYN is always
    // admitted, so at least one filler connects. The others stay in SYN_SENT.
    // Every filler has called connect(2) before the "connect" event below can
    // be delivered, so the queue is full before any later connect sends its
    // SYN.
    const { promise: filled, resolve: onFilled } = Promise.withResolvers<void>();
    for (let i = 0; i < 8; i++) {
      fillers.push(
        net
          .connect(port, "127.0.0.1")
          .on("error", () => {})
          .once("connect", onFilled),
      );
    }
    await filled;

    return { hostname: "127.0.0.1", port, [Symbol.dispose]: dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

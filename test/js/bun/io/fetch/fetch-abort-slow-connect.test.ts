import { dlopen } from "bun:ffi";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { isLinux, isWindows, libcPathForDlopen } from "harness";
import net from "node:net";

// A URL whose TCP connect returns EINPROGRESS and never completes. A TEST-NET-1
// address (192.0.2.1) only behaves that way on a network that silently drops
// the packets. Some CI hosts get an ICMP unreachable back within milliseconds
// or have no route at all, and the fetch then fails before the signal fires.
//
// A listener nobody accepts from behaves that way on any network: once its
// accept queue is full, the kernel drops every further SYN, and a connect to
// the port sits in SYN_SENT until it is closed. Bun's own listeners accept
// every connection and do not expose the backlog, so this one is a raw libc
// socket, and a few connections of our own fill its queue. Windows answers a
// full queue with RST instead, so it keeps dialing TEST-NET-1, which its CI
// network drops.
let url: string;
const cleanup: (() => void)[] = [];

beforeAll(async () => {
  if (isWindows) {
    url = "http://192.0.2.1:80/";
    return;
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
  cleanup.push(() => libc.symbols.close(fd));
  if (libc.symbols.bind(fd, addr, addr.byteLength) !== 0) throw new Error("bind() failed");
  // The smallest queue each kernel allows: Linux admits backlog + 1
  // connections, and macOS turns a backlog of 0 into the default.
  if (libc.symbols.listen(fd, isLinux ? 0 : 1) !== 0) throw new Error("listen() failed");
  const addrLen = new Uint32Array([addr.byteLength]);
  if (libc.symbols.getsockname(fd, addr, addrLen) !== 0) throw new Error("getsockname() failed");
  const port = (addr[2] << 8) | addr[3];

  // More fillers than either kernel admits. The first SYN is always admitted,
  // so at least one filler connects. The others stay in SYN_SENT. Every
  // filler has called connect(2) before the "connect" event below can be
  // delivered, so the queue is full before any later connect sends its SYN.
  const { promise: filled, resolve: onFilled } = Promise.withResolvers<void>();
  const fillers = Array.from({ length: 8 }, () =>
    net
      .connect(port, "127.0.0.1")
      .on("error", () => {})
      .once("connect", onFilled),
  );
  cleanup.push(() => fillers.forEach(filler => filler.destroy()));
  await filled;

  url = `http://127.0.0.1:${port}/`;
});

afterAll(() => {
  while (cleanup.length) cleanup.pop()!();
});

test.concurrent("fetch aborts when connect() returns EINPROGRESS but never completes", async () => {
  const start = performance.now();
  try {
    await fetch(url, {
      signal: AbortSignal.timeout(50),
    });
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("TimeoutError");
    expect(elapsed).toBeLessThan(1000); // But not more than 1000ms
  }
});

test.concurrent("fetch aborts immediately during EINPROGRESS connect", async () => {
  // Start the fetch
  const fetchPromise = fetch(url, {
    signal: AbortSignal.timeout(1),
  });

  const start = performance.now();
  try {
    await fetchPromise;
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("TimeoutError");
    expect(elapsed).toBeLessThan(1000); // Should reject very quickly after abort
  }
});

test.concurrent("pre-aborted signal prevents connection attempt", async () => {
  const start = performance.now();
  try {
    await fetch(url, {
      signal: AbortSignal.abort(),
    });
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("AbortError");
    expect(elapsed).toBeLessThan(10); // Should fail immediately
  }
});

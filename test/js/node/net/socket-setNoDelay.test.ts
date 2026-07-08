// node:net defaults to Nagle enabled (TCP_NODELAY=0); setNoDelay(false) and
// {noDelay:false} must actually reach the kernel. Bun's uSockets layer forces
// TCP_NODELAY=1 on every fd, so the node:net layer has to undo that.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isWindows, libcPathForDlopen } from "harness";
import net from "node:net";

// POSIX getsockopt; Windows uses SOCKET handles rather than fds for this path.
const { getsockopt } = isWindows
  ? { getsockopt: null as never }
  : dlopen(libcPathForDlopen(), {
      getsockopt: {
        args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
    }).symbols;

const IPPROTO_TCP = 6;
const TCP_NODELAY = 1;

function readNoDelay(sock: net.Socket): number {
  const fd = (sock as any)._handle?.fd;
  expect(typeof fd).toBe("number");
  expect(fd).toBeGreaterThanOrEqual(0);
  const val = new Int32Array(1);
  const len = new Uint32Array([4]);
  const rc = getsockopt(fd, IPPROTO_TCP, TCP_NODELAY, ptr(val), ptr(len));
  expect(rc).toBe(0);
  return val[0];
}

async function withPair(
  serverOpts: net.ServerOpts,
  clientOpts: net.NetConnectOpts & { noDelay?: boolean },
  body: (client: net.Socket, accepted: net.Socket) => void | Promise<void>,
) {
  let accepted: net.Socket | undefined;
  const server = net.createServer(serverOpts, s => {
    accepted = s;
    s.on("error", () => {});
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as net.AddressInfo).port;
    const client = await new Promise<net.Socket>((resolve, reject) => {
      const c = net.connect({ ...clientOpts, port, host: "127.0.0.1" });
      c.on("error", reject);
      c.on("connect", () => resolve(c));
    });
    try {
      // Ensure the accept callback has fired.
      while (!accepted) await new Promise(r => setImmediate(r));
      await body(client, accepted);
    } finally {
      client.destroy();
      accepted?.destroy();
    }
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

describe.skipIf(isWindows)("net.Socket TCP_NODELAY kernel state", () => {
  test("client default is Nagle enabled (TCP_NODELAY=0)", async () => {
    await withPair({}, {}, client => {
      expect(readNoDelay(client)).toBe(0);
    });
  });

  test("accepted socket default is Nagle enabled (TCP_NODELAY=0)", async () => {
    await withPair({}, {}, (_client, accepted) => {
      expect(readNoDelay(accepted)).toBe(0);
    });
  });

  test("setNoDelay(false) on a fresh socket clears TCP_NODELAY", async () => {
    await withPair({}, {}, client => {
      client.setNoDelay(false);
      expect(readNoDelay(client)).toBe(0);
    });
  });

  test("setNoDelay(true) sets TCP_NODELAY", async () => {
    await withPair({}, {}, client => {
      client.setNoDelay(true);
      expect(readNoDelay(client)).toBe(1);
    });
  });

  test("setNoDelay(true) then setNoDelay(false) toggles the kernel flag", async () => {
    await withPair({}, {}, client => {
      client.setNoDelay(true);
      expect(readNoDelay(client)).toBe(1);
      client.setNoDelay(false);
      expect(readNoDelay(client)).toBe(0);
    });
  });

  test("net.connect({ noDelay: false }) yields TCP_NODELAY=0", async () => {
    await withPair({}, { noDelay: false }, client => {
      expect(readNoDelay(client)).toBe(0);
    });
  });

  test("net.connect({ noDelay: true }) yields TCP_NODELAY=1", async () => {
    await withPair({}, { noDelay: true }, client => {
      expect(readNoDelay(client)).toBe(1);
    });
  });

  test("net.createServer({ noDelay: true }) sets TCP_NODELAY on accepted sockets", async () => {
    await withPair({ noDelay: true }, {}, (_client, accepted) => {
      expect(readNoDelay(accepted)).toBe(1);
    });
  });

  test("net.createServer({ noDelay: false }) leaves TCP_NODELAY=0 on accepted sockets", async () => {
    await withPair({ noDelay: false }, {}, (_client, accepted) => {
      expect(readNoDelay(accepted)).toBe(0);
    });
  });

  test("setNoDelay(false) before connect applies once connected", async () => {
    let accepted: net.Socket | undefined;
    const server = net.createServer(s => {
      accepted = s;
      s.on("error", () => {});
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = (server.address() as net.AddressInfo).port;
      const client = new net.Socket();
      client.setNoDelay(false);
      await new Promise<void>((resolve, reject) => {
        client.on("error", reject);
        client.connect(port, "127.0.0.1", resolve);
      });
      try {
        expect(readNoDelay(client)).toBe(0);
      } finally {
        client.destroy();
        accepted?.destroy();
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

import { file, serve } from "bun";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isArm64, isWindows, tmpdirSync } from "harness";
import net from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const networks = Object.values(networkInterfaces()).flat() as NetworkInterfaceInfo[];
const hasIPv4 = networks.some(({ family }) => family === "IPv4");
const hasIPv6 = networks.some(({ family }) => family === "IPv6");

const unix = join(tmpdirSync(), "unix.sock").replaceAll("\\", "/");
const tls = {
  cert: file(new URL("./fixtures/cert.pem", import.meta.url)),
  key: file(new URL("./fixtures/cert.key", import.meta.url)),
};

describe.each([
  {
    options: {
      hostname: undefined,
      port: 0,
    },
    url: {
      protocol: "http:",
    },
  },
  {
    options: {
      hostname: undefined,
      port: 0,
      tls,
    },
    url: {
      protocol: "https:",
    },
  },
  {
    options: {
      hostname: "localhost",
      port: 0,
    },
    hostname: "localhost",
    url: {
      protocol: "http:",
      hostname: "localhost",
    },
  },
  {
    options: {
      hostname: "localhost",
      port: 0,
      tls,
    },
    hostname: "localhost",
    url: {
      protocol: "https:",
      hostname: "localhost",
    },
  },
  {
    if: hasIPv4,
    options: {
      hostname: "127.0.0.1",
      port: 0,
    },
    hostname: "127.0.0.1",
    url: {
      protocol: "http:",
      hostname: "127.0.0.1",
    },
  },
  {
    if: hasIPv4,
    options: {
      hostname: "127.0.0.1",
      port: 0,
      tls,
    },
    hostname: "127.0.0.1",
    url: {
      protocol: "https:",
      hostname: "127.0.0.1",
    },
  },
  {
    if: hasIPv6,
    options: {
      hostname: "::1",
      port: 0,
    },
    hostname: "::1",
    url: {
      protocol: "http:",
      hostname: "[::1]",
    },
  },
  {
    if: hasIPv6,
    options: {
      hostname: "::1",
      port: 0,
      tls,
    },
    hostname: "::1",
    url: {
      protocol: "https:",
      hostname: "[::1]",
    },
  },
  {
    options: {
      unix: unix,
    },
    url: isWindows
      ? {
          protocol: "unix:",
          pathname: unix.substring(unix.indexOf(":") + 1),
          hostname: unix.substring(0, unix.indexOf(":")),
          port: "",
        }
      : {
          protocol: "unix:",
          pathname: unix,
        },
  },
])("Bun.serve()", ({ if: enabled = true, options, hostname, url }) => {
  const title = Bun.inspect(options).replaceAll("\n", " ");
  const unix = options.unix;

  describe.if(enabled)(title, () => {
    const server = serve({
      ...options,
      fetch() {
        return new Response();
      },
    });
    test(".hostname", () => {
      if (unix) {
        expect(server.hostname).toBeUndefined();
      } else if (hostname) {
        expect(server.hostname).toBe(hostname);
      } else {
        expect(server.hostname).toBeString();
      }
    });
    test(".port", () => {
      if (unix) {
        expect(server.port).toBeUndefined();
      } else {
        expect(server.port).toBeInteger();
        expect(server.port).toBeWithin(1, 65536 + 1);
      }
    });
    test(".url", () => {
      expect(server.url).toBeInstanceOf(URL);
      expect(server.url).toBe(server.url); // check if URL is properly cached
      const { protocol, hostname, port, pathname } = server.url;
      expect({ protocol, hostname, port, pathname }).toMatchObject(url);
    });
  });
});

// Windows has no SO_REUSEPORT. Its SO_REUSEADDR lets any local process rebind an
// in-use TCP port and receive its connections, so reusePort:true must not fall
// back to SO_REUSEADDR there. See libuv issue #1360.
describe.skipIf(!isWindows)("reusePort on Windows", () => {
  test("Bun.serve({reusePort:true}) does not let a second listener bind the port", async () => {
    using first = serve({
      port: 0,
      hostname: "127.0.0.1",
      reusePort: true,
      fetch: () => new Response("first"),
    });
    const port = first.port;
    expect(port).toBeInteger();

    let second: ReturnType<typeof serve> | undefined;
    let thrown: unknown;
    try {
      second = serve({
        port,
        hostname: "127.0.0.1",
        reusePort: true,
        fetch: () => new Response("second"),
      });
    } catch (e) {
      thrown = e;
    } finally {
      second?.stop(true);
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as NodeJS.ErrnoException).code).toBe("EADDRINUSE");

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe("first");
  });

  // bun:ffi dlopen() is unavailable on Windows arm64 (TinyCC is disabled there).
  test.skipIf(isArm64)(
    "Bun.serve({reusePort:true}) sets SO_EXCLUSIVEADDRUSE so a SO_REUSEADDR hijacker cannot bind",
    () => {
      const ws2 = dlopen("ws2_32.dll", {
        socket: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.u64 },
        setsockopt: { args: [FFIType.u64, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
        bind: { args: [FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
        closesocket: { args: [FFIType.u64], returns: FFIType.i32 },
        WSAGetLastError: { args: [], returns: FFIType.i32 },
      }).symbols;

      using first = serve({
        port: 0,
        hostname: "127.0.0.1",
        reusePort: true,
        fetch: () => new Response("first"),
      });
      const port = first.port;

      const AF_INET = 2;
      const SOCK_STREAM = 1;
      const IPPROTO_TCP = 6;
      const SOL_SOCKET = 0xffff;
      const SO_REUSEADDR = 0x0004;
      const INVALID_SOCKET = 0xffffffffffffffffn;
      const WSAEACCES = 10013;

      const s = ws2.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
      expect(BigInt(s)).not.toBe(INVALID_SOCKET);
      try {
        const one = new Int32Array([1]);
        expect(ws2.setsockopt(s, SOL_SOCKET, SO_REUSEADDR, ptr(one), 4)).toBe(0);

        // sockaddr_in: family(u16 LE), port(u16 BE), addr(4 bytes), zero(8 bytes)
        const sa = new Uint8Array(16);
        new DataView(sa.buffer).setUint16(0, AF_INET, true);
        new DataView(sa.buffer).setUint16(2, port, false);
        sa.set([127, 0, 0, 1], 4);

        const rc = ws2.bind(s, ptr(sa), sa.length);
        const err = ws2.WSAGetLastError();
        expect({ rc, err }).toEqual({ rc: -1, err: WSAEACCES });
      } finally {
        ws2.closesocket(s);
      }
    },
  );

  test("Bun.listen({reusePort:true}) reports ENOTSUP (matches Node's UV_TCP_REUSEPORT behavior)", () => {
    let listener: ReturnType<typeof Bun.listen> | undefined;
    let thrown: unknown;
    try {
      listener = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        reusePort: true,
        socket: { data() {}, open() {}, close() {}, error() {} },
      });
    } catch (e) {
      thrown = e;
    } finally {
      listener?.stop(true);
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as NodeJS.ErrnoException).code).toBe("ENOTSUP");
  });

  test("net.Server.listen({reusePort:true}) emits 'error' so checkSupportReusePort() rejects", async () => {
    const server = net.createServer();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    server.on("listening", () => {
      server.close();
      reject(new Error("listening fired; expected an error event"));
    });
    server.on("error", err => {
      server.close();
      resolve(err);
    });
    server.listen({ port: 0, reusePort: true });
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).syscall).toBe("listen");
  });
});

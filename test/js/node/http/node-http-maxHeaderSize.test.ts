import { afterEach, describe, expect, test } from "bun:test";
import { bunRun } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "path";

test("maxHeaderSize", async () => {
  const originalMaxHeaderSize = http.maxHeaderSize;
  expect(http.maxHeaderSize).toBe(16 * 1024);
  // @ts-expect-error its a liar
  http.maxHeaderSize = 1024;
  expect(http.maxHeaderSize).toBe(1024);
  {
    using server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(JSON.stringify(req.headers, null, 2));
      },
    });

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(8 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(15 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }
  }
  (http as any).maxHeaderSize = 16 * 1024;
  {
    using server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(JSON.stringify(req.headers, null, 2));
      },
    });

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(15 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(200);
    }

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(17 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }
  }

  (http as any).maxHeaderSize = originalMaxHeaderSize;
});

describe("maxHeaderSize is not wrapped to 32 or to 64 bits", () => {
  const originalMaxHeaderSize = http.maxHeaderSize;
  afterEach(() => {
    (http as any).maxHeaderSize = originalMaxHeaderSize;
  });

  test.each([
    ['"5000000000"', "5000000000", 5000000000],
    ['"3000000000"', "3000000000", 3000000000],
    ["an object whose valueOf gives 5000000000", { valueOf: () => 5000000000 }, 5000000000],
    ["an object whose valueOf gives 5n", { valueOf: () => 5n }, 5],
    ["Infinity", Infinity, 2 ** 63],
    ["2 ** 63", 2 ** 63, 2 ** 63],
    ["2n ** 63n", 2n ** 63n, 2 ** 63],
    ["2n ** 64n + 16384n", 2n ** 64n + 16384n, 2 ** 63],
  ])("%s", (_, value, expected) => {
    (http as any).maxHeaderSize = value;
    expect(http.maxHeaderSize).toBe(expected);
  });

  test.each([
    ['"-4294950912"', "-4294950912"],
    ["-(2n ** 64n) + 5n", -(2n ** 64n) + 5n],
  ])("%s is negative", (_, value) => {
    expect(() => {
      (http as any).maxHeaderSize = value;
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });
});

test("server.maxHeaderSize assigned after construction is not narrowed to a smaller limit", async () => {
  // server.maxHeaderSize is a plain property and only the constructor option is validated.
  // Node casts the number to uint64_t. On x64, -1 became 2^64 - 1 here too, and the parser
  // added its framing slack to it: the limit wrapped to 863 bytes, and to 63 bytes for -800.
  // On arm64 the same happened to Infinity.
  async function statusFor(maxHeaderSize: number, headerValueLength: number) {
    const server = http.createServer((req, res) => res.end("ok"));
    (server as any).maxHeaderSize = maxHeaderSize;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as net.AddressInfo;
      return await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let data = "";
        socket.on("data", chunk => {
          data += chunk;
          const end = data.indexOf("\r\n");
          if (end === -1) return;
          socket.destroy();
          resolve(data.slice(0, end));
        });
        socket.on("close", () => reject(new Error(`closed before the status line: ${JSON.stringify(data)}`)));
        socket.on("error", reject);
        socket.write(`GET / HTTP/1.1\r\nHost: x\r\nX-Pad: ${Buffer.alloc(headerValueLength, "a")}\r\n\r\n`);
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  expect({
    "-1, 2000 bytes": await statusFor(-1, 2000),
    "-800, 100 bytes": await statusFor(-800, 100),
    "Infinity, 20000 bytes": await statusFor(Infinity, 20000),
    // Node's result for these two depends on the CPU, because the cast is undefined for them:
    // no limit on x64, the default limit on arm64. Bun uses the default limit.
    "-1, 20000 bytes": await statusFor(-1, 20000),
    "NaN, 20000 bytes": await statusFor(NaN, 20000),
    "4000, 2000 bytes": await statusFor(4000, 2000),
    "4000, 5000 bytes": await statusFor(4000, 5000),
  }).toEqual({
    "-1, 2000 bytes": "HTTP/1.1 200 OK",
    "-800, 100 bytes": "HTTP/1.1 200 OK",
    "Infinity, 20000 bytes": "HTTP/1.1 200 OK",
    "-1, 20000 bytes": "HTTP/1.1 431 Request Header Fields Too Large",
    "NaN, 20000 bytes": "HTTP/1.1 431 Request Header Fields Too Large",
    "4000, 2000 bytes": "HTTP/1.1 200 OK",
    "4000, 5000 bytes": "HTTP/1.1 431 Request Header Fields Too Large",
  });
});

test.concurrent("--max-http-header-size=1024", async () => {
  const size = 1024;
  expect(
    await bunRun(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")], {
      BUN_HTTP_MAX_HEADER_SIZE: String(size),
    }),
  ).toSpawn();
});

test.concurrent("--max-http-header-size=NaN", async () => {
  const { exitCode } = await bunRun([
    "--max-http-header-size=" + "NaN",
    path.join(import.meta.dir, "max-header-size-fixture.ts"),
  ]);
  expect(exitCode).not.toBe(0);
});

test.concurrent("--max-http-header-size=16*1024", async () => {
  const size = 16 * 1024;
  expect(
    await bunRun(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")], {
      BUN_HTTP_MAX_HEADER_SIZE: String(size),
    }),
  ).toSpawn();
});

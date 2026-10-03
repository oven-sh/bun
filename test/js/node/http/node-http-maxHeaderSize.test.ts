import { expect, test } from "bun:test";
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
  http.maxHeaderSize = 16 * 1024;
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

  http.maxHeaderSize = originalMaxHeaderSize;
});

test("server.maxHeaderSize assigned after construction is not narrowed to a smaller limit", async () => {
  // server.maxHeaderSize is a plain property and only the constructor option is validated.
  // Node casts the number to uint64_t. On x64, -1 became 2^64 - 1 here too, and the parser
  // added its framing slack to it: the limit wrapped to 863 bytes, and to 63 bytes for -800.
  // On arm64 the same happened to Infinity.
  async function statusFor(maxHeaderSize: number, headerValueLength: number) {
    const server = http.createServer((req, res) => res.end("ok"));
    server.maxHeaderSize = maxHeaderSize;
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

// A head of `size` bytes with two fields. The spaces before the value of the second are not
// part of the value, so maxHeaderSize does not count them.
function paddedHead(size: number) {
  const start = "GET / HTTP/1.1\r\nHost: x\r\nX-Pad:";
  const end = "v\r\n\r\n";
  return start + Buffer.alloc(size - start.length - end.length, " ") + end;
}

// Writes the parts in order on one connection and resolves with the status line of every
// response. It waits for a response after a part with `responds`, then calls its `then`.
async function statusLines(port: number, parts: { write: string; responds: boolean; then?: () => void }[]) {
  const socket = net.connect(port, "127.0.0.1");
  socket.on("error", () => {});
  await once(socket, "connect");
  const lines: string[] = [];
  let received = "";
  let onResponse: (() => void) | undefined;
  socket.setEncoding("latin1");
  socket.on("data", chunk => {
    received += chunk;
    for (let headEnd; (headEnd = received.indexOf("\r\n\r\n")) !== -1; ) {
      const line = received.slice(0, received.indexOf("\r\n"));
      // Every response here is a 200 with the body "ok", or a 431 with no body.
      const responseEnd = headEnd + 4 + (line === "HTTP/1.1 200 OK" ? 2 : 0);
      if (received.length < responseEnd) break;
      received = received.slice(responseEnd);
      lines.push(line);
      onResponse?.();
    }
  });
  const closed = once(socket, "close");
  try {
    for (const { write, responds, then } of parts) {
      const response = Promise.withResolvers<void>();
      onResponse = response.resolve;
      socket.write(write);
      if (responds) await Promise.race([response.promise, closed]);
      then?.();
    }
    return lines;
  } finally {
    socket.destroy();
  }
}

test("a request head may have maxHeaderSize bytes and the framing of the fields that server.maxHeadersCount allows", async () => {
  // maxHeaderSize counts the target, the names and the values, like Node. A head may also have 4
  // bytes that it does not count for each field that the limit allows (": " and CRLF), and 64. A
  // field counts for 1 byte of maxHeaderSize or more, so no limit allows maxHeaderSize fields.
  // A limit below 200 fields allows the framing of 200.
  const maxHeaderSize = 16 * 1024;
  async function statusAround(maxHeadersCount: number | null, fields: number) {
    const server = http.createServer((req, res) => res.end("ok"));
    server.maxHeadersCount = maxHeadersCount;
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as net.AddressInfo;
      const largest = maxHeaderSize + 4 * fields + 64;
      return [
        ...(await statusLines(port, [{ write: paddedHead(largest), responds: true }])),
        ...(await statusLines(port, [{ write: paddedHead(largest + 1), responds: true }])),
      ];
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  const passesThenFails = ["HTTP/1.1 200 OK", "HTTP/1.1 431 Request Header Fields Too Large"];
  expect({
    "100 fields": await statusAround(100, 200),
    // The limit of a server that does not set the option is 198 fields.
    "not set": await statusAround(null, 200),
    "1000 fields": await statusAround(1000, 1000),
    "2000 fields": await statusAround(2000, 2000),
    "no limit": await statusAround(0, maxHeaderSize),
  }).toEqual({
    "100 fields": passesThenFails,
    "not set": passesThenFails,
    "1000 fields": passesThenFails,
    "2000 fields": passesThenFails,
    "no limit": passesThenFails,
  });
});

test("a connection keeps its head size bound when server.maxHeadersCount is lowered under a head that is not complete", async () => {
  const server = http.createServer((req, res) => res.end("ok"));
  server.maxHeadersCount = 1000;
  try {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;
    // The connection opens with a limit of 1000 fields: a head may have 20 448 bytes.
    // A limit of 3 fields allows 17 248 bytes, which is less than the connection holds by then.
    const largest = 16 * 1024 + 4 * 1000 + 64;
    const fits = paddedHead(largest);
    const tooLong = paddedHead(largest + 1);
    expect(
      await statusLines(port, [
        // The server reads the start of the second head with the first request, so it holds
        // 18 000 bytes of a head when the limit changes.
        {
          write: "GET / HTTP/1.1\r\nHost: x\r\n\r\n" + fits.slice(0, 18000),
          responds: true,
          then: () => (server.maxHeadersCount = 3),
        },
        { write: fits.slice(18000), responds: true },
        { write: tooLong.slice(0, 18000), responds: false },
        { write: tooLong.slice(18000), responds: true },
      ]),
    ).toEqual(["HTTP/1.1 200 OK", "HTTP/1.1 200 OK", "HTTP/1.1 431 Request Header Fields Too Large"]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// Bun.serve has no option for it. server.maxHeadersCount of node:http does not apply to it.
test("Bun.serve passes 198 header fields and answers the 199th with 431", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: req => new Response(String(Array.from(req.headers).length)),
  });
  async function respondsTo(fields: number) {
    let head = "GET / HTTP/1.1\r\nHost: x\r\n";
    for (let i = 0; i < fields - 2; i++) head += `X-${i}: ${i}\r\n`;
    const socket = net.connect(server.port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", chunk => chunks.push(chunk));
    socket.write(head + "Connection: close\r\n\r\n");
    await once(socket, "close");
    const response = Buffer.concat(chunks).toString("latin1");
    return [response.slice(0, response.indexOf("\r\n")), response.slice(response.indexOf("\r\n\r\n") + 4)];
  }

  expect({ 198: await respondsTo(198), 199: await respondsTo(199) }).toEqual({
    198: ["HTTP/1.1 200 OK", "198"],
    199: ["HTTP/1.1 431 Request Header Fields Too Large", ""],
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

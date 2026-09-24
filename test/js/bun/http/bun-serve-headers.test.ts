import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/9180
test("weird headers", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch(req) {
      const headers = new Headers();
      req.headers.forEach((value, key) => {
        headers.append(key, value);
      });

      return new Response("OK", {
        headers,
      });
    },
  });

  {
    for (let i = 0; i < 255; i++) {
      const headers = new Headers();
      const name = "X-" + String.fromCharCode(i);
      try {
        headers.set(name, "1");
      } catch {
        continue;
      }

      const res = await fetch(server.url, {
        headers,
      });
      expect(res.headers.get(name)).toBe("1");
    }
  }
});

// https://fetch.spec.whatwg.org/#concept-header-value
// Header values are ByteStrings: U+00E9 goes out as the single byte 0xE9, not as
// UTF-8 0xC3 0xA9. The bytes must not depend on whether JSC stores the string as
// 8-bit (a literal) or 16-bit (TextDecoder, normalize(), JSON.parse output).
describe("response header values are isomorphic-encoded on the wire", () => {
  const eightBit = "caf\u00e9-\u0080\u00ff";
  // A utf-16le decode always yields a 16-bit string, even for latin-1 content.
  const sixteenBit = new TextDecoder("utf-16le").decode(new Uint16Array([0x63, 0x61, 0x66, 0xe9, 0x2d, 0x80, 0xff]));
  const expectedHex = "63 61 66 e9 2d 80 ff";

  async function rawResponse(port: number, path: string): Promise<string> {
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      let raw = "";
      await new Promise<void>(resolve => {
        socket.on("data", chunk => (raw += chunk.toString("latin1")));
        socket.on("close", resolve);
      });
      return raw;
    } finally {
      socket.destroy();
    }
  }

  function headerHex(raw: string, name: string): string[] {
    const head = raw.split("\r\n\r\n")[0];
    return head
      .split("\r\n")
      .filter(line => line.toLowerCase().startsWith(name + ":"))
      .map(line =>
        [...Buffer.from(line.slice(name.length + 2), "latin1")].map(c => c.toString(16).padStart(2, "0")).join(" "),
      );
  }

  test("Response headers", async () => {
    expect(sixteenBit).toBe(eightBit);
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const value = new URL(req.url).pathname === "/16" ? sixteenBit : eightBit;
        return new Response("ok", { headers: { "x-t": value } });
      },
    });

    expect(headerHex(await rawResponse(server.port, "/8"), "x-t")).toEqual([expectedHex]);
    expect(headerHex(await rawResponse(server.port, "/16"), "x-t")).toEqual([expectedHex]);

    // A fetch() client reads the same value back, not mojibake.
    const res = await fetch(`http://127.0.0.1:${server.port}/16`);
    expect(res.headers.get("x-t")).toBe(eightBit);
  });

  test("Set-Cookie headers", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const value = new URL(req.url).pathname === "/16" ? sixteenBit : eightBit;
        const headers = new Headers();
        headers.append("set-cookie", `a=${value}`);
        headers.append("set-cookie", `b=${value}`);
        return new Response("ok", { headers });
      },
    });

    const expected = ["61 3d " + expectedHex, "62 3d " + expectedHex];
    expect(headerHex(await rawResponse(server.port, "/8"), "set-cookie")).toEqual(expected);
    expect(headerHex(await rawResponse(server.port, "/16"), "set-cookie")).toEqual(expected);
  });

  test("long values and values that start with a non-ASCII char", async () => {
    // 300 ASCII code units, then latin-1, then digits: longer than the writer's inline buffer.
    const units = Array.from({ length: 300 }, (_, i) => 0x41 + (i % 26));
    units.push(0xe9, 0x80, 0xff, ...Array.from({ length: 100 }, (_, i) => 0x30 + (i % 10)));
    const values: Record<string, Uint16Array> = {
      long: new Uint16Array(units),
      lead: new Uint16Array([0xe9, 0x61]),
      ascii: new Uint16Array([0x61, 0x62, 0x63]),
    };
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const url = new URL(req.url);
        const codeUnits = values[url.pathname.slice(1)];
        const value =
          url.searchParams.get("bits") === "16"
            ? new TextDecoder("utf-16le").decode(codeUnits)
            : String.fromCharCode(...codeUnits);
        return new Response("ok", { headers: { "x-t": value } });
      },
    });

    for (const [name, codeUnits] of Object.entries(values)) {
      const expected = [[...codeUnits].map(c => c.toString(16).padStart(2, "0")).join(" ")];
      expect(headerHex(await rawResponse(server.port, `/${name}?bits=8`), "x-t")).toEqual(expected);
      expect(headerHex(await rawResponse(server.port, `/${name}?bits=16`), "x-t")).toEqual(expected);
    }
  });
});

// Sends one raw request and collects the response head lines (status line
// first) until the server closes the connection. A server that does not close
// hangs the test, which is the failure these tests look for.
async function rawHeadLines(port: number, request: string, onConnected?: () => Promise<void>) {
  const socket = net.connect(port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write(request);
    await onConnected?.();
    let raw = "";
    await new Promise<void>(resolve => {
      socket.on("data", chunk => (raw += chunk.toString("latin1")));
      socket.on("close", resolve);
    });
    return raw.split("\r\n\r\n")[0].split("\r\n");
  } finally {
    socket.destroy();
  }
}

function connectionLines(head: string[]) {
  return head.slice(1).filter(l => /^connection:/i.test(l));
}

// RFC 9110 §6.6.1: an origin server with a clock MUST send Date. A response
// with no body (HEAD, 204) ends its headers on a separate path that skipped it.
describe("Date header on responses without a body", () => {
  test("HEAD from the fetch handler, a 204, and a static route HEAD", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      routes: { "/static": new Response("bye") },
      fetch(req) {
        return new Response(req.method === "HEAD" ? "bye" : null, { status: req.method === "HEAD" ? 200 : 204 });
      },
    });
    for (const request of ["HEAD /", "GET /", "HEAD /static"]) {
      const head = await rawHeadLines(server.port, `${request} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      expect({ request, date: head.filter(l => /^date:/i.test(l)) }).toEqual({
        request,
        date: [expect.stringMatching(/^date: \w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/i)],
      });
    }
  });
});

// RFC 9112 §9.6: a server that sends "Connection: close" MUST close the
// connection after that response. Bun was emitting the header but leaving the
// socket in the keep-alive pool, servicing further requests on the "closed"
// connection.
describe("response Connection: close closes the socket", () => {
  async function check(makeResponse: () => Response) {
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch() {
        handled++;
        return makeResponse();
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");

      // Collect everything the server sends until it closes the connection, or
      // until it services a second request on the same socket (the bug). Either
      // event resolves the promise, so this never relies on a wall-clock wait.
      const result = await new Promise<{ raw: string; closedByServer: boolean }>(resolve => {
        let raw = "";
        let sentSecond = false;
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          // Once the first response body has fully arrived, send a follow-up
          // request. A correct server has already closed (or is about to) and
          // will never answer it; a buggy server answers and we resolve below.
          if (!sentSecond && raw.includes("\r\n\r\n") && raw.includes("bye")) {
            sentSecond = true;
            socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
          }
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length > 1) {
            resolve({ raw, closedByServer: false });
          }
        });
        socket.on("close", () => resolve({ raw, closedByServer: true }));
      });

      const responses = (result.raw.match(/HTTP\/1\.1 200/g) ?? []).length;
      const head = result.raw.split("\r\n\r\n")[0];
      expect(head).toMatch(/\r\nconnection:[^\r\n]*\bclose\b/i);
      expect({ responses, handled, closedByServer: result.closedByServer }).toEqual({
        responses: 1,
        handled: 1,
        closedByServer: true,
      });
    } finally {
      socket.destroy();
    }
  }

  test("string body", async () => {
    await check(() => new Response("bye", { headers: { Connection: "close" } }));
  });

  test("case-insensitive value", async () => {
    await check(() => new Response("bye", { headers: { connection: "Close" } }));
  });

  test("token list", async () => {
    // Connection is 1#connection-option: "close" as one of several tokens must
    // still trigger closure.
    await check(() => new Response("bye", { headers: { Connection: "TE, close" } }));
  });

  test("streaming body", async () => {
    await check(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("bye"));
              c.close();
            },
          }),
          { headers: { Connection: "close" } },
        ),
    );
  });

  test("keep-alive still the default", async () => {
    // Negative: without Connection: close, a second request on the same socket
    // must be serviced.
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch() {
        handled++;
        return new Response("bye");
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");

      let raw = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length >= 2) resolve();
        });
        socket.on("close", () => reject(new Error("server closed a keep-alive connection")));
      });

      expect(handled).toBe(2);
      expect(raw.toLowerCase()).not.toContain("connection: close");
    } finally {
      socket.destroy();
    }
  });
});

// RFC 9112 §9.6: a server that closes the connection after a response SHOULD
// send "Connection: close" in that response, also when the request asked for
// the close. Without it, a pooling client (node:http's default agent, undici)
// reuses the socket the server closed and loses the next request (#43853).
describe("Connection: close is sent on every response that closes the connection", () => {
  const dir = tempDir("serve-connection-close", {
    "small.txt": "bye",
    // Above the 1 MiB sendfile threshold on Linux.
    "big.bin": Buffer.alloc(1536 * 1024, 0x61),
  });
  afterAll(() => dir[Symbol.dispose]());
  const smallFile = join(String(dir), "small.txt");
  const bigFile = join(String(dir), "big.bin");

  async function rawExchange(port: number, request: string) {
    const head = await rawHeadLines(port, request);
    return { status: head[0], connection: connectionLines(head) };
  }

  const bodies: Record<string, () => Response> = {
    "in-memory body": () => new Response("bye"),
    "HEAD / no body": () => new Response("bye"),
    "204": () => new Response(null, { status: 204 }),
    "streamed body": () =>
      new Response(
        new ReadableStream({
          async pull(c) {
            await 1;
            c.enqueue(new TextEncoder().encode("bye"));
            c.close();
          },
        }),
      ),
    "small Bun.file body": () => new Response(Bun.file(smallFile)),
    "large Bun.file body (sendfile)": () => new Response(Bun.file(bigFile)),
    "user Connection: close header": () => new Response("bye", { headers: { connection: "close" } }),
  };

  const requests: Record<string, (method: string) => string> = {
    "request Connection: close": m => `${m} / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
    "HTTP/1.0 request": m => `${m} / HTTP/1.0\r\nHost: x\r\n\r\n`,
  };

  for (const [bodyName, makeResponse] of Object.entries(bodies)) {
    for (const [requestName, makeRequest] of Object.entries(requests)) {
      test(`${bodyName}, ${requestName}`, async () => {
        using server = Bun.serve({
          port: 0,
          development: false,
          idleTimeout: 0,
          async fetch() {
            await 1;
            return makeResponse();
          },
        });
        const method = bodyName.startsWith("HEAD") ? "HEAD" : "GET";
        const result = await rawExchange(server.port, makeRequest(method));
        expect(result).toEqual({
          status: expect.stringMatching(/^HTTP\/1\.1 (200|204)/),
          connection: [expect.stringMatching(/^connection: close$/i)],
        });
      });
    }
  }

  test("static and file routes", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      routes: {
        "/static": new Response("bye"),
        "/static-close": new Response("bye", { headers: { connection: "close" } }),
        "/file": new Response(Bun.file(smallFile)),
        "/file-big": new Response(Bun.file(bigFile)),
      },
      fetch() {
        return new Response("nf", { status: 404 });
      },
    });
    for (const path of ["/static", "/static-close", "/file", "/file-big", "/404"]) {
      for (const method of ["GET", "HEAD"]) {
        const result = await rawExchange(
          server.port,
          `${method} ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
        );
        expect({ path, method, ...result }).toEqual({
          path,
          method,
          status: expect.stringMatching(/^HTTP\/1\.1 (200|404)/),
          connection: [expect.stringMatching(/^connection: close$/i)],
        });
      }
    }
  });

  test("graceful server.stop() while a request is in flight", async () => {
    // stop(false) marks a busy connection to close once its response is out,
    // so that response must say so.
    const { promise: started, resolve: markStarted } = Promise.withResolvers<void>();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      async fetch() {
        markStarted();
        await gate;
        return new Response("bye");
      },
    });
    let stopped: Promise<void> | undefined;
    const head = await rawHeadLines(server.port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n", async () => {
      await started;
      stopped = server.stop(false);
      release();
    });
    await stopped;
    expect(connectionLines(head)).toEqual([expect.stringMatching(/^connection: close$/i)]);
  });

  test("node:http server: a handler that throws before writeHead()", async () => {
    // Bun ends the response for it and closes the connection. Runs in a child
    // because the throw reaches uncaughtException.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { createServer } = require("node:http");
        const { connect } = require("node:net");
        process.on("uncaughtException", err => {
          if (err.message !== "boom") throw err;
        });
        const server = createServer(() => {
          throw new Error("boom");
        });
        server.listen(0, "127.0.0.1", () => {
          const socket = connect(server.address().port, "127.0.0.1", () => {
            socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          });
          let raw = "";
          socket.on("data", chunk => (raw += chunk.toString("latin1")));
          socket.on("error", () => {});
          socket.on("close", () => {
            console.log(JSON.stringify(raw.split("\\r\\n\\r\\n")[0].split("\\r\\n")));
            server.close();
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const head: string[] = JSON.parse(stdout);
    expect({ status: head[0], connection: connectionLines(head) }).toEqual({
      status: expect.stringMatching(/^HTTP\/1\.1 /),
      connection: [expect.stringMatching(/^connection: close$/i)],
    });
    expect(exitCode).toBe(0);
  });

  test("node:http server: res.destroy() before writeHead() sends no response", async () => {
    // Node destroys the socket without a status line. A fabricated 200 would
    // tell the client its request succeeded.
    await using server = createServer((_req, res) => {
      res.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const head = await rawHeadLines(port, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    expect(head).toEqual([""]);
  });

  test("node:http default agent: four requests with Connection: close all succeed", async () => {
    // The issue's repro. Without the response header, the agent pools the
    // socket after the first request and the second one is written to a socket
    // the server closed (ECONNRESET).
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      async fetch(req) {
        await req.text();
        return new Response("ok");
      },
    });
    const results: (number | string)[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await new Promise<number | string>(resolve => {
          const req = request(
            {
              host: "127.0.0.1",
              port: server.port,
              path: "/",
              method: "POST",
              headers: { connection: "close" },
            },
            res => {
              res.resume();
              res.on("end", () => resolve(res.statusCode!));
            },
          );
          req.on("error", e => resolve("error " + (e as NodeJS.ErrnoException).code));
          req.end("x");
        }),
      );
    }
    expect(results).toEqual([200, 200, 200, 200]);
  });
});

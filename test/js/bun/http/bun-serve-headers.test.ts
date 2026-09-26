import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import * as http from "node:http";
import * as net from "node:net";

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

// https://github.com/oven-sh/bun/issues/43848
describe("keep-alive headers", () => {
  // Sends one raw request and returns the response header lines, so the test
  // sees every header the server wrote, duplicates included.
  async function rawHeaders(port: number, request: string): Promise<string[]> {
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write(request);
      const head = await new Promise<string>((resolve, reject) => {
        let raw = "";
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          const end = raw.indexOf("\r\n\r\n");
          if (end !== -1) resolve(raw.slice(0, end));
        });
        socket.on("close", () => reject(new Error("closed before the headers arrived: " + JSON.stringify(raw))));
      });
      return head.split("\r\n").slice(1);
    } finally {
      socket.destroy();
    }
  }

  function pick(lines: string[], name: string): string[] {
    const prefix = name.toLowerCase() + ":";
    return lines.filter(line => line.toLowerCase().startsWith(prefix)).map(line => line.slice(prefix.length).trim());
  }

  function keepAlive(lines: string[]) {
    return { connection: pick(lines, "connection"), keepAlive: pick(lines, "keep-alive") };
  }

  const GET = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";

  test("default idleTimeout advertises the idle time the socket is sure to survive", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    // 10 s arms 3 sweeps of 4 s, the socket can close 8 s after the response.
    expect(keepAlive(await rawHeaders(server.port, GET))).toEqual({
      connection: ["keep-alive"],
      keepAlive: ["timeout=8"],
    });
  });

  test("idleTimeout rounds down to the sweep before the one that can close the socket", async () => {
    // 1 to 4 s can close at the next sweep: no value is safe, so no hint.
    for (const [idleTimeout, advertised] of [
      [30, ["timeout=28"]],
      [8, ["timeout=4"]],
      [4, []],
      [1, []],
      [255, ["timeout=252"]],
    ] as const) {
      using server = Bun.serve({ port: 0, idleTimeout, fetch: () => new Response("ok") });
      expect({ idleTimeout, ...keepAlive(await rawHeaders(server.port, GET)) }).toEqual({
        idleTimeout,
        connection: ["keep-alive"],
        keepAlive: advertised,
      });
    }
  });

  test("idleTimeout: 0 sends Connection: keep-alive alone", async () => {
    using server = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => new Response("ok") });
    expect(keepAlive(await rawHeaders(server.port, GET))).toEqual({ connection: ["keep-alive"], keepAlive: [] });
  });

  test("server.timeout(request, seconds) changes the advertised value", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.timeout(req, 20);
        return new Response("ok");
      },
    });
    expect(keepAlive(await rawHeaders(server.port, GET))).toEqual({
      connection: ["keep-alive"],
      keepAlive: ["timeout=16"],
    });
  });

  test("a response that closes the connection advertises nothing", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    expect(keepAlive(await rawHeaders(server.port, "GET / HTTP/1.0\r\nHost: x\r\n\r\n"))).toEqual({
      connection: [],
      keepAlive: [],
    });
    expect(keepAlive(await rawHeaders(server.port, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"))).toEqual({
      connection: [],
      keepAlive: [],
    });
  });

  test("the handler's Connection header wins and gets no Keep-Alive hint", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: req =>
        new Response("ok", {
          headers: { Connection: new URL(req.url).pathname === "/close" ? "close" : "keep-alive" },
        }),
    });
    expect(keepAlive(await rawHeaders(server.port, "GET /close HTTP/1.1\r\nHost: x\r\n\r\n"))).toEqual({
      connection: ["close"],
      keepAlive: [],
    });
    expect(keepAlive(await rawHeaders(server.port, GET))).toEqual({ connection: ["keep-alive"], keepAlive: [] });
  });

  test("the handler's Keep-Alive header wins", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok", { headers: { "Keep-Alive": "timeout=9, max=100" } }),
    });
    expect(keepAlive(await rawHeaders(server.port, GET))).toEqual({
      connection: ["keep-alive"],
      keepAlive: ["timeout=9, max=100"],
    });
  });

  test("a handler Connection header written after Content-Length is not duplicated", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok", { headers: { "Content-Length": "2", Connection: "close" } }),
    });
    const lines = await rawHeaders(server.port, GET);
    expect(keepAlive(lines)).toEqual({ connection: ["close"], keepAlive: [] });
    expect(pick(lines, "date")).toHaveLength(1);
  });

  test("every route kind and body kind gets the pair once", async () => {
    using dir = tempDir("keep-alive-file", { "a.txt": "file body" });
    using server = Bun.serve({
      port: 0,
      routes: {
        "/static": new Response("static"),
        "/file": new Response(Bun.file(`${dir}/a.txt`)),
        "/stream": () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue("stream");
                c.close();
              },
            }),
          ),
        "/204": () => new Response(null, { status: 204 }),
        "/304": () => new Response(null, { status: 304 }),
        "/file-304-user-date": () =>
          new Response(Bun.file(`${dir}/a.txt`), { status: 304, headers: { Date: "Thu, 01 Jan 1970 00:00:00 GMT" } }),
      },
      fetch: () => new Response("fetch"),
    });
    for (const path of ["/static", "/file", "/stream", "/204", "/304", "/file-304-user-date", "/fetch"]) {
      for (const method of ["GET", "HEAD"]) {
        const lines = await rawHeaders(server.port, `${method} ${path} HTTP/1.1\r\nHost: x\r\n\r\n`);
        expect({ path, method, ...keepAlive(lines), date: pick(lines, "date").length }).toEqual({
          path,
          method,
          connection: ["keep-alive"],
          keepAlive: ["timeout=8"],
          date: 1,
        });
      }
    }
  });

  test("a static or file route with Connection: close sends it once and closes the socket", async () => {
    using dir = tempDir("keep-alive-close", { "a.txt": "file body" });
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      routes: {
        "/static": new Response("static", { headers: { Connection: "close" } }),
        "/file": new Response(Bun.file(`${dir}/a.txt`), { headers: { Connection: "Keep-Alive, Close" } }),
      },
      fetch() {
        handled++;
        return new Response("fetch");
      },
    });
    for (const path of ["/static", "/file"]) {
      const socket = net.connect(server.port, "127.0.0.1");
      try {
        socket.on("error", () => {});
        await once(socket, "connect");
        // The second request must never be answered: the server closes first.
        // A second response resolves too, so a server that keeps the socket
        // open fails the assertion below instead of hanging.
        socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\n\r\n`);
        const raw = await new Promise<string>(resolve => {
          let raw = "";
          socket.on("data", chunk => {
            raw += chunk.toString("latin1");
            if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length > 1) resolve(raw);
          });
          socket.on("close", () => resolve(raw));
        });
        const lines = raw.split("\r\n\r\n")[0].split("\r\n").slice(1);
        expect({ path, ...keepAlive(lines), responses: (raw.match(/HTTP\/1\.1 200/g) ?? []).length }).toEqual({
          path,
          connection: [path === "/static" ? "close" : "Keep-Alive, Close"],
          keepAlive: [],
          responses: 1,
        });
      } finally {
        socket.destroy();
      }
    }
    expect(handled).toBe(0);
  });

  test("a WebSocket upgrade keeps Connection: Upgrade alone", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no")),
      websocket: { message() {} },
    });
    const lines = await rawHeaders(
      server.port,
      "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    expect(keepAlive(lines)).toEqual({ connection: ["Upgrade"], keepAlive: [] });
  });

  test("a response ended with close after the handler threw does not advertise keep-alive", async () => {
    // node:http ends a pending response with close when the handler throws
    // before writeHead. The close mark must land before the server headers.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        process.on("uncaughtException", () => {});
        const server = http.createServer(() => { throw new Error("boom"); });
        server.listen(0, "127.0.0.1", () => {
          const s = net.connect(server.address().port, "127.0.0.1");
          let raw = "";
          s.on("connect", () => s.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n"));
          s.on("data", d => (raw += d.toString("latin1")));
          s.on("close", () => { console.log(raw.split("\\r\\n\\r\\n")[0]); server.close(); });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.trim().split("\r\n").slice(1);
    expect({ ...keepAlive(lines), stderr }).toEqual({ connection: ["close"], keepAlive: [], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("node:http keeps rendering its own pair once", async () => {
    await using server = http.createServer((req, res) => res.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    expect(keepAlive(await rawHeaders(port, GET))).toEqual({ connection: ["keep-alive"], keepAlive: ["timeout=5"] });
  });
});

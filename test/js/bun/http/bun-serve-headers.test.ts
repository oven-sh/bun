import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import * as net from "node:net";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";

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

// `return fetch(upstream)` reverse-proxy: fetch decodes Content-Encoding, so
// Bun.serve must not forward that header against the now-plaintext body.
describe("proxied fetch() response drops decoded Content-Encoding", () => {
  const payload = Buffer.alloc(2700, "The quick brown fox jumps over the lazy dog. ").toString();
  const codings: [string, Buffer][] = [
    ["gzip", gzipSync(payload)],
    ["deflate", deflateSync(payload)],
    ["br", brotliCompressSync(payload)],
    ["zstd", zstdCompressSync(payload)],
  ];

  async function rawGet(port: number, bodyLen: number): Promise<{ head: string; body: Buffer }> {
    let buf = Buffer.alloc(0);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(s) {
          s.write("GET / HTTP/1.1\r\nHost: x\r\nAccept-Encoding: gzip, deflate, br, zstd\r\n\r\n");
        },
        data(s, d) {
          buf = Buffer.concat([buf, Buffer.from(d)]);
          const sep = buf.indexOf("\r\n\r\n");
          if (sep !== -1 && buf.length - sep - 4 >= bodyLen) {
            s.end();
            resolve();
          }
        },
        error(s, e) {
          reject(e);
        },
        close() {
          resolve();
        },
      },
    });
    await promise;
    const sep = buf.indexOf("\r\n\r\n");
    return { head: buf.subarray(0, sep).toString(), body: buf.subarray(sep + 4, sep + 4 + bodyLen) };
  }

  for (const [name, compressed] of codings) {
    test(name, async () => {
      using upstream = Bun.serve({
        port: 0,
        development: false,
        fetch() {
          return new Response(compressed, { headers: { "content-encoding": name } });
        },
      });

      let sawUpstreamEncoding: string | null | undefined;
      using proxy = Bun.serve({
        port: 0,
        development: false,
        async fetch(req) {
          const res = await fetch(new URL(new URL(req.url).pathname, upstream.url));
          sawUpstreamEncoding = res.headers.get("content-encoding");
          return res;
        },
      });

      const { head, body } = await rawGet(proxy.port, payload.length);
      expect(head.toLowerCase()).not.toContain("content-encoding");
      expect(head).toMatch(/content-length: 2700\b/i);
      expect(body.toString()).toBe(payload);
      // fetch() itself still exposes the upstream header (issue #5668).
      expect(sawUpstreamEncoding).toBe(name);

      const res = await fetch(proxy.url);
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(await res.text()).toBe(payload);
    });
  }

  test("static route built from a fetch() Response", async () => {
    using upstream = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return new Response(gzipSync(payload), { headers: { "content-encoding": "gzip" } });
      },
    });
    const snapshot = await fetch(upstream.url);
    using proxy = Bun.serve({ port: 0, development: false, routes: { "/": snapshot } });

    const { head, body } = await rawGet(proxy.port, payload.length);
    expect(head.toLowerCase()).not.toContain("content-encoding");
    expect(body.toString()).toBe(payload);
  });

  test("explicit Content-Encoding on a handler-built Response is preserved", async () => {
    const gz = gzipSync(payload);
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return new Response(gz, { headers: { "content-encoding": "gzip" } });
      },
    });
    const { head } = await rawGet(server.port, gz.length);
    expect(head.toLowerCase()).toContain("content-encoding: gzip");
    const res = await fetch(server.url);
    expect(await res.text()).toBe(payload);
  });

  test("decompress: false keeps the body compressed and forwards the header", async () => {
    const gz = gzipSync(payload);
    using upstream = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return new Response(gz, { headers: { "content-encoding": "gzip" } });
      },
    });
    using proxy = Bun.serve({
      port: 0,
      development: false,
      fetch: req => fetch(new URL(new URL(req.url).pathname, upstream.url), { decompress: false }),
    });

    const { head, body } = await rawGet(proxy.port, gz.length);
    expect(head.toLowerCase()).toContain("content-encoding: gzip");
    expect(body.equals(gz)).toBe(true);
    const res = await fetch(proxy.url);
    expect(await res.text()).toBe(payload);
  });
});

import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import * as net from "node:net";
import { Readable } from "node:stream";

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

// https://github.com/oven-sh/bun/issues/10507
// Bun.serve stripped a handler-set Content-Length on ReadableStream bodies and
// fell back to Transfer-Encoding: chunked, so clients never saw the size the
// handler already knew (proxies, downloads).
describe("response Content-Length for ReadableStream bodies", () => {
  async function rawGET(port: number, method = "GET"): Promise<{ head: string; body: Buffer }> {
    const socket = net.connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write(`${method} / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      const chunks: Buffer[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      socket.on("data", c => {
        chunks.push(c);
        // Resolve as soon as the response is complete so we don't depend on
        // Connection: close actually closing the socket.
        const raw = Buffer.concat(chunks);
        const sep = raw.indexOf("\r\n\r\n");
        if (sep === -1) return;
        const head = raw.subarray(0, sep).toString("latin1");
        const body = raw.subarray(sep + 4);
        if (method === "HEAD") return finish();
        const m = head.match(/^content-length:\s*(\d+)\r?$/im);
        if (m) {
          if (body.length >= Number(m[1])) finish();
        } else if (/^transfer-encoding:\s*chunked/im.test(head)) {
          if (body.includes("\r\n0\r\n\r\n") || body.subarray(0, 5).equals(Buffer.from("0\r\n\r\n"))) finish();
        }
      });
      socket.on("close", finish);
      await promise;
      const raw = Buffer.concat(chunks);
      const sep = raw.indexOf("\r\n\r\n");
      return { head: raw.subarray(0, sep).toString("latin1"), body: raw.subarray(sep + 4) };
    } finally {
      socket.destroy();
    }
  }

  function contentLength(head: string): string[] {
    return [...head.matchAll(/^content-length:\s*(\d+)\r?$/gim)].map(m => m[1]);
  }

  test.concurrent("async pull stream", async () => {
    const chunk = Buffer.alloc(1024, "A");
    const total = 5 * chunk.length;
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        let left = 5;
        return new Response(
          new ReadableStream({
            async pull(c) {
              if (left-- === 0) return c.close();
              await new Promise(r => setImmediate(r));
              c.enqueue(chunk);
            },
          }),
          { headers: { "Content-Length": String(total) } },
        );
      },
    });

    const { head, body } = await rawGET(server.port);
    expect(head.toLowerCase()).not.toContain("transfer-encoding");
    expect(contentLength(head)).toEqual([String(total)]);
    expect(body.length).toBe(total);
    expect(body.subarray(0, 4).toString()).toBe("AAAA");
  });

  // Exercises HTTPServerWritable's single-write fast path: a sub-highWaterMark
  // stream that enqueues once and closes synchronously buffers then ends in one
  // send, and end() must not let try_end() add a second Content-Length.
  test.concurrent("sub-highWaterMark stream, single write", async () => {
    const payload = Buffer.alloc(100, "S");
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(payload);
              c.close();
            },
          }),
          { headers: { "Content-Length": String(payload.length) } },
        );
      },
    });

    const { head, body } = await rawGET(server.port);
    expect(head.toLowerCase()).not.toContain("transfer-encoding");
    expect(contentLength(head)).toEqual([String(payload.length)]);
    expect(body.equals(payload)).toBe(true);
  });

  // The stream errors after the Content-Length is already on the wire: the
  // server must close the socket rather than leave the client waiting on the
  // promised bytes.
  test.concurrent("stream that errors after Content-Length is committed closes the socket", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return new Response(
          new ReadableStream({
            async pull() {
              await new Promise(r => setImmediate(r));
              throw new Error("boom");
            },
          }),
          { headers: { "Content-Length": "100" } },
        );
      },
      error() {},
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      const chunks: Buffer[] = [];
      socket.on("data", c => chunks.push(c));
      await once(socket, "close");
      const head = Buffer.concat(chunks).toString("latin1").split("\r\n\r\n")[0] ?? "";
      expect(contentLength(head).length).toBeLessThanOrEqual(1);
    } finally {
      socket.destroy();
    }
  });

  test.concurrent("Readable.toWeb stream (node:stream source)", async () => {
    const payload = Buffer.alloc(4096, "C");
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        const r = Readable.from([payload.subarray(0, 2048), payload.subarray(2048)]);
        return new Response(Readable.toWeb(r) as ReadableStream, {
          headers: { "Content-Length": String(payload.length) },
        });
      },
    });

    const { head, body } = await rawGET(server.port);
    expect(head.toLowerCase()).not.toContain("transfer-encoding");
    expect(contentLength(head)).toEqual([String(payload.length)]);
    expect(body.equals(payload)).toBe(true);
  });

  test.concurrent("proxied fetch().body", async () => {
    const payload = Buffer.alloc(8000, "D");
    using upstream = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        // Stream the body so the proxy cannot have it fully buffered before
        // rendering (the byte_stream path, not the blob fast path).
        let sent = 0;
        return new Response(
          new ReadableStream({
            async pull(c) {
              if (sent >= payload.length) return c.close();
              await new Promise(r => setImmediate(r));
              c.enqueue(payload.subarray(sent, (sent += 2000)));
            },
          }),
          { headers: { "Content-Length": String(payload.length) } },
        );
      },
    });
    using proxy = Bun.serve({
      port: 0,
      development: false,
      async fetch() {
        const r = await fetch(upstream.url);
        return new Response(r.body, {
          headers: { "Content-Length": String(payload.length) },
        });
      },
    });

    const res = await fetch(proxy.url);
    expect(res.headers.get("content-length")).toBe(String(payload.length));
    expect(res.headers.has("transfer-encoding")).toBe(false);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(payload)).toBe(true);
  });

  test.concurrent("HEAD matches GET framing", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        let left = 3;
        return new Response(
          new ReadableStream({
            pull(c) {
              if (left-- === 0) return c.close();
              c.enqueue(new Uint8Array(10));
            },
          }),
          { headers: { "Content-Length": "30" } },
        );
      },
    });

    const { head, body } = await rawGET(server.port, "HEAD");
    expect(head.toLowerCase()).not.toContain("transfer-encoding");
    expect(contentLength(head)).toEqual(["30"]);
    expect(body.length).toBe(0);
  });

  test.concurrent("no Content-Length still uses chunked", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        let left = 2;
        return new Response(
          new ReadableStream({
            async pull(c) {
              if (left-- === 0) return c.close();
              await new Promise(r => setImmediate(r));
              c.enqueue(new TextEncoder().encode("abc"));
            },
          }),
        );
      },
    });

    const { head } = await rawGET(server.port);
    expect(head.toLowerCase()).toContain("transfer-encoding: chunked");
    expect(contentLength(head)).toEqual([]);
  });

  // Unchanged: for in-memory bodies Bun frames from the actual byte length,
  // not the handler's header.
  test.concurrent("in-memory body still framed from actual size", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch: () => new Response("hi", { headers: { "Content-Length": "999" } }),
    });

    const { head, body } = await rawGET(server.port);
    expect(contentLength(head)).toEqual(["2"]);
    expect(body.toString()).toBe("hi");
  });

  test.concurrent("keep-alive: second request parses after a CL-framed stream body", async () => {
    const payload = Buffer.alloc(256, "E");
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        handled++;
        let left = 2;
        return new Response(
          new ReadableStream({
            async pull(c) {
              if (left-- === 0) return c.close();
              await new Promise(r => setImmediate(r));
              c.enqueue(payload.subarray(0, 128));
            },
          }),
          { headers: { "Content-Length": String(payload.length) } },
        );
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      const chunks: Buffer[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      let sent2 = false;
      socket.on("data", c => {
        chunks.push(c);
        const raw = Buffer.concat(chunks);
        const sep = raw.indexOf("\r\n\r\n");
        if (!sent2 && sep !== -1 && raw.length >= sep + 4 + payload.length) {
          sent2 = true;
          socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        }
        if ((raw.toString("latin1").match(/HTTP\/1\.1 200/g) ?? []).length === 2) resolve();
      });
      socket.on("close", resolve);
      await promise;
      const raw = Buffer.concat(chunks).toString("latin1");
      const head1 = raw.split("\r\n\r\n")[0];
      expect(contentLength(head1)).toEqual([String(payload.length)]);
      expect((raw.match(/HTTP\/1\.1 200/g) ?? []).length).toBe(2);
      expect(handled).toBe(2);
    } finally {
      socket.destroy();
    }
  });
});

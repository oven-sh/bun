import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import * as net from "node:net";
import * as path from "node:path";

// An empty (or whitespace-only) header value must be treated as absent for the
// well-known headers Bun fills in automatically, so the response head carries
// exactly one Content-Type and exactly one Date (RFC 9110 forbids duplicate
// Content-Type; an origin server MUST send a valid Date).
describe("empty header value does not duplicate auto-headers", () => {
  async function readHead(port: number): Promise<string> {
    const socket = net.connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      let raw = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", c => (raw += c.toString("latin1")));
        socket.on("error", reject);
        socket.on("close", resolve);
      });
      return raw.split("\r\n\r\n")[0];
    } finally {
      socket.destroy();
    }
  }

  async function rawHead(makeResponse: () => Response): Promise<string> {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      fetch: makeResponse,
    });
    return await readHead(server.port);
  }

  const lines = (head: string, name: string) => head.split("\r\n").filter(l => l.toLowerCase().startsWith(name + ":"));

  for (const [label, value] of [
    ["empty", ""],
    ["whitespace", "  \t "],
  ] as const) {
    test(`content-type: ${label}`, async () => {
      const head = await rawHead(() => new Response("x", { headers: { "content-type": value } }));
      const ct = lines(head, "content-type");
      expect(ct).toHaveLength(1);
      expect(ct[0].toLowerCase()).toBe("content-type: text/plain;charset=utf-8");
    });

    test(`date: ${label}`, async () => {
      const head = await rawHead(() => new Response("x", { headers: { date: value } }));
      const date = lines(head, "date");
      expect(date).toHaveLength(1);
      // auto Date is a valid IMF-fixdate, never an empty value
      expect(date[0]).toMatch(/^Date: \S/);
      expect(Number.isFinite(new Date(date[0].slice(6)).getTime())).toBe(true);
    });
  }

  test("headers.set('content-type', '')", async () => {
    const head = await rawHead(() => {
      const r = new Response("x");
      r.headers.set("content-type", "");
      return r;
    });
    const ct = lines(head, "content-type");
    expect(ct).toHaveLength(1);
    expect(ct[0].toLowerCase()).toBe("content-type: text/plain;charset=utf-8");
  });

  test("Response.json with empty content-type", async () => {
    // The Fetch spec's "initialize a response" gates the default Content-Type on
    // "header list contains" (key presence), so the Response object keeps the
    // empty value; the wire serializer drops it and backfills from the body.
    const r = Response.json({ a: 1 }, { headers: { "content-type": "" } });
    expect(r.headers.get("content-type")).toBe("");
    const head = await rawHead(() => Response.json({ a: 1 }, { headers: { "content-type": "" } }));
    const ct = lines(head, "content-type");
    expect(ct).toHaveLength(1);
    expect(ct[0]).toMatch(/^content-type: \S/i);
  });

  test("both empty at once: one of each", async () => {
    const head = await rawHead(() => new Response("x", { headers: { "content-type": "", "date": "" } }));
    expect(lines(head, "content-type")).toHaveLength(1);
    expect(lines(head, "date")).toHaveLength(1);
  });

  async function rawHeadStatic(response: Response): Promise<string> {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      static: { "/": response },
      fetch() {
        return new Response("unreachable");
      },
    });
    return await readHead(server.port);
  }

  test("static route: content-type empty", async () => {
    const head = await rawHeadStatic(new Response("x", { headers: { "content-type": "" } }));
    const ct = lines(head, "content-type");
    expect(ct).toHaveLength(1);
    expect(ct[0].toLowerCase()).toBe("content-type: text/plain;charset=utf-8");
  });

  test("static route: date empty", async () => {
    const head = await rawHeadStatic(new Response("x", { headers: { date: "" } }));
    const date = lines(head, "date");
    expect(date).toHaveLength(1);
    expect(date[0]).toMatch(/^Date: \S/);
    expect(Number.isFinite(new Date(date[0].slice(6)).getTime())).toBe(true);
  });

  test("static route: both empty", async () => {
    const head = await rawHeadStatic(new Response("x", { headers: { "content-type": "", "date": "" } }));
    const ct = lines(head, "content-type");
    const date = lines(head, "date");
    expect({ ct: ct.length, date: date.length }).toEqual({ ct: 1, date: 1 });
    expect(ct[0].toLowerCase()).toBe("content-type: text/plain;charset=utf-8");
    expect(date[0]).toMatch(/^Date: \S/);
  });

  test("static route: non-empty user values preserved", async () => {
    const head = await rawHeadStatic(
      new Response("x", { headers: { "content-type": "text/html", "date": "Sun, 06 Oct 2024 13:37:01 GMT" } }),
    );
    expect(lines(head, "content-type")).toEqual(["Content-Type: text/html"]);
    expect(lines(head, "date")).toEqual(["Date: Sun, 06 Oct 2024 13:37:01 GMT"]);
  });

  test("file route: date empty", async () => {
    using dir = tempDir("serve-file-empty-date", { "a.txt": "x" });
    const head = await rawHeadStatic(
      new Response(Bun.file(path.join(String(dir), "a.txt")), { headers: { date: "" } }),
    );
    const date = lines(head, "date");
    expect(date).toHaveLength(1);
    expect(date[0]).toMatch(/^Date: \S/);
  });

  test("non-empty user values are still preserved", async () => {
    const head = await rawHead(
      () => new Response("x", { headers: { "content-type": "text/html", "date": "Sun, 06 Oct 2024 13:37:01 GMT" } }),
    );
    expect(lines(head, "content-type")).toEqual(["Content-Type: text/html"]);
    expect(lines(head, "date")).toEqual(["Date: Sun, 06 Oct 2024 13:37:01 GMT"]);
  });

  test("empty custom header is dropped on both paths", async () => {
    for (const head of [
      await rawHead(() => new Response("x", { headers: { "x-custom": "", "content-type": "text/html" } })),
      await rawHeadStatic(new Response("x", { headers: { "x-custom": "", "content-type": "text/html" } })),
    ]) {
      expect(lines(head, "x-custom")).toEqual([]);
      expect(lines(head, "content-type")).toEqual(["Content-Type: text/html"]);
    }
  });

  test("empty set-cookie is dropped on both paths", async () => {
    for (const head of [
      await rawHead(() => new Response("x", { headers: { "set-cookie": "" } })),
      await rawHeadStatic(new Response("x", { headers: { "set-cookie": "" } })),
    ]) {
      expect(lines(head, "set-cookie")).toEqual([]);
    }
  });

  test("static route: empty etag gets the auto content-hash", async () => {
    const head = await rawHeadStatic(new Response("x", { headers: { etag: "" } }));
    const etag = lines(head, "etag");
    expect(etag).toHaveLength(1);
    expect(etag[0]).toMatch(/^etag: "\S/);
  });
});

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

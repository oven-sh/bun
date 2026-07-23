import { describe, expect, test } from "bun:test";
import { once } from "node:events";
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

// The Content-Type on the wire must be the body's declared type string, not a
// re-canonicalized entry from Bun's MIME table. Previously a Blob typed
// "text/html; charset=utf-16" was sent as "text/html;charset=utf-8", silently
// replacing the declared charset.
test("Blob body Content-Type is sent verbatim", async () => {
  const cases: Record<string, () => Response> = {
    "blob-utf16": () => new Response(new Blob(["<b>x</b>"], { type: "text/html; charset=utf-16" })),
    "blob-latin1": () => new Response(new Blob(["\xe9"], { type: "text/plain; charset=iso-8859-1" })),
    "blob-param": () => new Response(new Blob(["b"], { type: "application/octet-stream; foo=bar" })),
    "blob-json": () => new Response(new Blob(["{}"], { type: "application/json; charset=utf-16" })),
    "file-utf16": () => new Response(new File(["<b>x</b>"], "x.bin", { type: "text/html; charset=utf-16" })),
    // non-table essence already passed through untouched; keep as a control
    "control-nontable": () =>
      new Response(new Blob(["b"], { type: "application/vnd.api+json; charset=utf-16" })),
  };

  using server = Bun.serve({
    port: 0,
    development: false,
    fetch(req) {
      return cases[new URL(req.url).pathname.slice(1)]();
    },
  });

  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "");
  const results: Record<string, { declared: string; wire: string }> = {};
  for (const k of Object.keys(cases)) {
    const declared = norm(cases[k]().headers.get("content-type"));
    const r = await fetch(new URL("/" + k, server.url));
    await r.arrayBuffer();
    results[k] = { declared, wire: norm(r.headers.get("content-type")) };
  }

  expect(results).toEqual({
    "blob-utf16": { declared: "text/html;charset=utf-16", wire: "text/html;charset=utf-16" },
    "blob-latin1": { declared: "text/plain;charset=iso-8859-1", wire: "text/plain;charset=iso-8859-1" },
    "blob-param": { declared: "application/octet-stream;foo=bar", wire: "application/octet-stream;foo=bar" },
    "blob-json": { declared: "application/json;charset=utf-16", wire: "application/json;charset=utf-16" },
    "file-utf16": { declared: "text/html;charset=utf-16", wire: "text/html;charset=utf-16" },
    "control-nontable": {
      declared: "application/vnd.api+json;charset=utf-16",
      wire: "application/vnd.api+json;charset=utf-16",
    },
  });
});

import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
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

// RFC 6266 §4.1: content-disposition = disposition-type *( ";" disposition-parm )
// The disposition-type token is mandatory; a bare `filename="..."` is invalid and
// UAs / strict parsers handle it inconsistently.
describe("auto Content-Disposition for Bun.file() responses", () => {
  test("includes a disposition-type", async () => {
    using dir = tempDir("cd-serve", {
      "asset.bin": "0123456789",
      "report.pdf": "0123456789",
      "bundle.zip": "0123456789",
      "page.html": "0123456789",
      "data.json": "0123456789",
      "photo.png": "0123456789",
    });
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const name = new URL(req.url).pathname.slice(1);
        return new Response(Bun.file(join(String(dir), name)));
      },
    });

    const seen: Record<string, string | null> = {};
    for (const name of ["asset.bin", "report.pdf", "bundle.zip", "page.html", "data.json", "photo.png"]) {
      const res = await fetch(new URL(name, server.url));
      await res.arrayBuffer();
      seen[name] = res.headers.get("content-disposition");
    }
    expect(seen).toEqual({
      "asset.bin": 'attachment; filename="asset.bin"',
      "report.pdf": 'attachment; filename="report.pdf"',
      "bundle.zip": 'attachment; filename="bundle.zip"',
      // inline-rendered categories must not get the header at all
      "page.html": null,
      "data.json": null,
      "photo.png": null,
    });
  });

  test("user-set header is not overridden", async () => {
    using dir = tempDir("cd-serve-user", { "asset.bin": "x" });
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return new Response(Bun.file(join(String(dir), "asset.bin")), {
          headers: { "content-disposition": "inline" },
        });
      },
    });
    const res = await fetch(server.url);
    await res.arrayBuffer();
    expect(res.headers.get("content-disposition")).toBe("inline");
  });
});

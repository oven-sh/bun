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

// Reads the raw HTTP response off the wire so we can count header lines —
// going through `fetch()` would run the response through Bun's HTTP client,
// which has its own header-joining behavior and would mask a server-side
// multi-value regression.
function readRawResponse(port: number): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const sock = net.connect(port, "127.0.0.1", () => {
    sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  });
  let buf = "";
  sock.on("data", d => (buf += d));
  sock.on("end", () => resolve(buf));
  sock.on("error", reject);
  return promise;
}

// https://github.com/oven-sh/bun/issues/31317
// `Response` headers built from a sequence-of-sequences init must produce one
// wire line per entry (RFC 7230 §3.2.2), not a single `, `-joined line.
test("Bun.serve emits multi-value headers as separate wire lines", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("hi", {
        headers: [
          ["x-multi", "a"],
          ["x-multi", "b"],
          ["x-multi", "c"],
        ],
      });
    },
  });

  const raw = await readRawResponse(server.port);
  const count = (raw.match(/^x-multi:/gim) ?? []).length;
  expect(count).toBe(3);
  expect(raw).toMatch(/x-multi: a\r\n/);
  expect(raw).toMatch(/x-multi: b\r\n/);
  expect(raw).toMatch(/x-multi: c\r\n/);
});

test("Bun.serve preserves multiple set-cookie and multi-value headers together", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const headers = new Headers();
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      headers.append("x-multi", "alpha");
      headers.append("x-multi", "beta");
      return new Response("hi", { headers });
    },
  });

  const raw = await readRawResponse(server.port);
  expect((raw.match(/^set-cookie:/gim) ?? []).length).toBe(2);
  expect((raw.match(/^x-multi:/gim) ?? []).length).toBe(2);
});

// Headers.append keeps WHATWG semantics: Headers.get() returns the joined
// string. The extra-storage path must not change that contract.
test("Headers.get() returns the joined string for WHATWG-appended duplicates", () => {
  const h = new Headers();
  h.append("x-multi", "a");
  h.append("x-multi", "b");
  h.append("x-multi", "c");
  expect(h.get("x-multi")).toBe("a, b, c");

  // Cookie uses the RFC 6265 `"; "` separator.
  const c = new Headers();
  c.append("Cookie", "a=1");
  c.append("Cookie", "b=2");
  expect(c.get("Cookie")).toBe("a=1; b=2");
});

// Headers.set() and Headers.delete() must drop every extra duplicate for a
// given name.
test("Headers.set() overwrites all prior appended values", () => {
  const h = new Headers();
  h.append("x-multi", "a");
  h.append("x-multi", "b");
  h.append("x-multi", "c");
  h.set("x-multi", "only");
  expect(h.get("x-multi")).toBe("only");
});

test("Headers.delete() removes every value for the given name", () => {
  const h = new Headers();
  h.append("x-multi", "a");
  h.append("x-multi", "b");
  h.append("x-multi", "c");
  h.delete("x-multi");
  expect(h.has("x-multi")).toBe(false);
  expect(h.get("x-multi")).toBeNull();
});

import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { once } from "node:events";

test("keepalive", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(JSON.stringify(req.headers.toJSON()));
    },
  });
  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
    });
    const headers = await res.json();
    expect(headers.connection).toBeUndefined();
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: true,
    });
    const headers = await res.json();
    expect(headers.connection).toBe("keep-alive");
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
      headers: {
        "Connection": "HELLO!",
      },
    });
    const headers = await res.json();
    expect(headers.connection).toBe("HELLO!");
  }
});

// RFC 7230 §6.3.1: a client MUST NOT automatically retry a non-idempotent
// request once any response has been received. allow_retry exists to recover
// from a reused keep-alive socket that was already dead (request never
// arrived); once the server replies, the socket was not stale and replaying
// the POST could duplicate the side effect.
test("keep-alive does not replay non-idempotent request after response bytes arrive", async () => {
  let postCount = 0;
  let connCount = 0;

  const server = createServer(socket => {
    connCount++;
    const isFirstConn = connCount === 1;
    let buf = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buf += chunk.toString("latin1");
      while (true) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const head = buf.slice(0, headerEnd);
        const m = /content-length: (\d+)/i.exec(head);
        const bodyLen = m ? parseInt(m[1]) : 0;
        const total = headerEnd + 4 + bodyLen;
        if (buf.length < total) return;
        const method = head.slice(0, head.indexOf(" "));
        buf = buf.slice(total);

        if (method === "GET") {
          socket.write("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok");
        } else if (method === "POST") {
          postCount++;
          if (isFirstConn) {
            // Server processed the POST and started replying, then drops the
            // connection mid-body (Content-Length: 100, only 7 bytes sent).
            socket.write("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 100\r\n\r\npartial", () => {
              socket.destroy();
            });
          } else {
            // This is the (buggy) retry on a fresh connection.
            socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 7\r\n\r\nretried", () => {
              socket.end();
            });
          }
        }
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  try {
    // Prime the keep-alive pool so the next request reuses this socket and
    // sets allow_retry.
    const res1 = await fetch(url);
    expect(await res1.text()).toBe("ok");

    const result = await fetch(url, { method: "POST", body: "hello" }).then(
      r => r.text().then(text => ({ ok: true as const, text })),
      e => ({ ok: false as const, error: String(e) }),
    );

    expect({ postCount, result }).toEqual({
      postCount: 1,
      result: { ok: false, error: expect.stringMatching(/ConnectionClosed|ECONNRESET|socket connection was closed/i) },
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// Counterpart to the test above: when the reused keep-alive socket closes
// before any response bytes are sent, the client cannot know whether the
// request was received, so the one-shot retry must still fire. This guards
// against over-correcting the fix above into "never retry on reuse".
test("keep-alive still retries when a reused socket closes before any response bytes", async () => {
  let connCount = 0;
  let postCount = 0;

  const server = createServer(socket => {
    connCount++;
    const isFirstConn = connCount === 1;
    let buf = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buf += chunk.toString("latin1");
      while (true) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const head = buf.slice(0, headerEnd);
        const m = /content-length: (\d+)/i.exec(head);
        const bodyLen = m ? parseInt(m[1]) : 0;
        const total = headerEnd + 4 + bodyLen;
        if (buf.length < total) return;
        const method = head.slice(0, head.indexOf(" "));
        buf = buf.slice(total);

        if (method === "GET") {
          socket.write("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok");
        } else if (method === "POST") {
          postCount++;
          if (isFirstConn) {
            // Simulate a stale keep-alive race: drop the reused socket
            // without writing a single response byte.
            socket.destroy();
          } else {
            socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok", () => {
              socket.end();
            });
          }
        }
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  try {
    const res1 = await fetch(url);
    expect(await res1.text()).toBe("ok");

    const res2 = await fetch(url, { method: "POST", body: "hello" });
    expect({ text: await res2.text(), status: res2.status, connCount, postCount }).toEqual({
      text: "ok",
      status: 200,
      connCount: 2,
      postCount: 2,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

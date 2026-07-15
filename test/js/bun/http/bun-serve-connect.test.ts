import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import * as net from "node:net";

// RFC 9110 9.3.6: an origin server that is not acting as a tunnel must not
// respond 2xx to CONNECT. Bun.serve is never a proxy, so CONNECT is refused
// (socket closed, no bytes written) and never reaches the fetch handler.
// Matches Node.js http.Server with no 'connect' listener.

async function sendRaw(port: number, bytes: string): Promise<{ received: string; serverClosed: boolean }> {
  const chunks: Buffer[] = [];
  const socket = net.connect({ port, host: "127.0.0.1" });
  await once(socket, "connect");
  socket.write(bytes);
  // Under the bug the server answers and leaves the connection open (keep-alive),
  // so 'close' never fires on its own. Race data-vs-close; if any bytes arrive,
  // tear the socket down ourselves so the test fails on the assertion instead
  // of timing out.
  const serverClosed = await new Promise<boolean>((resolve, reject) => {
    socket.on("data", d => {
      chunks.push(d);
      socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(chunks.length === 0));
  });
  return { received: Buffer.concat(chunks).toString("latin1"), serverClosed };
}

describe("Bun.serve CONNECT", () => {
  test("fetch handler never sees CONNECT; socket is closed with no response", async () => {
    let handlerSaw: string | null = null;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        handlerSaw = `${req.method} ${req.url}`;
        return new Response("hello from the handler");
      },
    });

    const { received, serverClosed } = await sendRaw(
      server.port,
      "CONNECT h.test:80 HTTP/1.1\r\nHost: h.test:80\r\n\r\n",
    );

    expect({ handlerSaw, received, serverClosed }).toEqual({
      handlerSaw: null,
      received: "",
      serverClosed: true,
    });

    // The server itself stays up; a normal request on a fresh connection works.
    const res = await fetch(`http://127.0.0.1:${server.port}/ok`);
    expect(await res.text()).toBe("hello from the handler");
    expect(handlerSaw).toBe(`GET http://127.0.0.1:${server.port}/ok`);
  });

  test("routes catch-all handler never sees CONNECT", async () => {
    let handlerSaw: string | null = null;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/*": req => {
          handlerSaw = `${req.method} ${req.url}`;
          return new Response("from route");
        },
      },
    });

    const { received, serverClosed } = await sendRaw(
      server.port,
      "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
    );

    expect({ handlerSaw, received, serverClosed }).toEqual({
      handlerSaw: null,
      received: "",
      serverClosed: true,
    });
  });

  test("routes-only server (no fetch handler) closes on CONNECT", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/hello": () => new Response("hi"),
      },
    });

    const { received, serverClosed } = await sendRaw(
      server.port,
      "CONNECT h.test:80 HTTP/1.1\r\nHost: h.test:80\r\n\r\n",
    );

    expect({ received, serverClosed }).toEqual({ received: "", serverClosed: true });
  });

  test("pipelined bytes after CONNECT are discarded, not parsed as HTTP", async () => {
    const seen: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(`${req.method} ${new URL(req.url).pathname}`);
        return new Response("ok");
      },
    });

    const pipelined =
      "CONNECT h.test:80 HTTP/1.1\r\nHost: h.test:80\r\n\r\n" +
      "GET /smuggled HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    const { received, serverClosed } = await sendRaw(server.port, pipelined);

    expect({ seen, received, serverClosed }).toEqual({ seen: [], received: "", serverClosed: true });
  });
});

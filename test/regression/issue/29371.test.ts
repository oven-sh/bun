// https://github.com/oven-sh/bun/issues/29371
//
// Bun was unconditionally inserting `:80` (or `:443`) into the absolute-form
// request-URI sent to an HTTP proxy, even when the target URL had no explicit
// port. That turned e.g. `http://example.com/path` into
// `POST http://example.com:80/path HTTP/1.1`, which breaks proxies that do
// strict Host/authority matching. Per RFC 7230 §5.3.2 the default port should
// be omitted; curl and Node's `http.request` both do this.

import { expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";

function createCapturingProxy() {
  const requests: string[] = [];
  const server = net.createServer((socket: net.Socket) => {
    let buf = "";
    socket.on("data", chunk => {
      buf += chunk.toString("utf8");
      // Capture the request-line + headers on the first request we see.
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        requests.push(buf.slice(0, headerEnd));
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        buf = "";
      }
    });
    // If the socket errors (e.g. client RSTs mid-write), destroy it so
    // server.close() can drop its tracking and emit 'close'. A bare
    // empty handler leaves the socket tracked forever.
    socket.on("error", () => socket.destroy());
  });
  return {
    server,
    requests,
    async listen() {
      server.listen(0);
      await once(server, "listening");
      return (server.address() as net.AddressInfo).port;
    },
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

test("proxy request-line omits default :80 for http:// without explicit port", async () => {
  const proxy = createCapturingProxy();
  const port = await proxy.listen();
  try {
    const res = await fetch("http://example.com/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      proxy: `http://localhost:${port}`,
      keepalive: false,
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(proxy.requests.length).toBeGreaterThanOrEqual(1);
    const requestLine = proxy.requests[0].split("\r\n")[0];
    // Must NOT contain the injected default port.
    expect(requestLine).toBe("POST http://example.com/test HTTP/1.1");
    expect(requestLine).not.toContain(":80");
  } finally {
    await proxy.close();
  }
});

test("proxy request-line keeps explicit non-default port for http://host:PORT/", async () => {
  const proxy = createCapturingProxy();
  const port = await proxy.listen();
  try {
    const res = await fetch("http://example.com:8080/test", {
      method: "GET",
      proxy: `http://localhost:${port}`,
      keepalive: false,
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(proxy.requests.length).toBeGreaterThanOrEqual(1);
    const requestLine = proxy.requests[0].split("\r\n")[0];
    // Explicit non-default port must be preserved.
    expect(requestLine).toBe("GET http://example.com:8080/test HTTP/1.1");
  } finally {
    await proxy.close();
  }
});

test("proxy request-line strips explicit :80 that fetch normalized away", async () => {
  // Even if the user writes `:80`, WHATWG URL normalization in fetch() drops
  // it before the URL reaches the HTTP client. The request-line must match
  // that normalized form — no phantom `:80` reappearing on the wire.
  const proxy = createCapturingProxy();
  const port = await proxy.listen();
  try {
    const res = await fetch("http://example.com:80/test", {
      method: "GET",
      proxy: `http://localhost:${port}`,
      keepalive: false,
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(proxy.requests.length).toBeGreaterThanOrEqual(1);
    const requestLine = proxy.requests[0].split("\r\n")[0];
    expect(requestLine).toBe("GET http://example.com/test HTTP/1.1");
  } finally {
    await proxy.close();
  }
});

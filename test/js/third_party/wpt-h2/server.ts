// Minimal stand-in for the wptserve endpoints the vendored .h2.any.js
// files hit. Routes by URL suffix so the WPT files' hardcoded paths
// (../resources/foo.py, /xhr/..., /fetch/...) all resolve regardless of
// what RESOURCES_DIR prefix we feed them.

import { createSecureServer } from "node:http2";
import { once } from "node:events";
import { tls } from "harness";

export async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  // Per-uuid request counter for the network-partition-key.py route, so the
  // 421 no-retry assertion observes the actual request count instead of a
  // hardcoded "1".
  const partitionHits = new Map<string, number>();

  const server = createSecureServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const url = new URL(req.url, "https://localhost");
    const path = url.pathname;

    if (path.endsWith("/echo-content.h2.py")) {
      res.writeHead(200, { "content-type": "text/plain" });
      req.pipe(res);
      return;
    }

    if (path.endsWith("/redirect.h2.py")) {
      const status = Number(url.searchParams.get("redirect_status") ?? 302);
      const location = url.searchParams.get("location") ?? "";
      res.writeHead(status, { location });
      res.end();
      return;
    }

    if (path.endsWith("/top.txt")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("top");
      return;
    }

    if (path.includes("/status.py")) {
      const code = Number(url.searchParams.get("code") ?? 200);
      res.writeHead(code);
      res.end();
      return;
    }

    if (path.includes("/network-partition-key.py")) {
      const status = Number(url.searchParams.get("status") ?? 200);
      const uuid = url.searchParams.get("uuid") ?? "";
      const n = (partitionHits.get(uuid) ?? 0) + 1;
      partitionHits.set(uuid, n);
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(`ok. Request was sent ${n} times. 1 connections were created.`);
      return;
    }

    if (path.includes("/authentication.py")) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end("not found: " + path);
  });

  const sessions = new Set<import("node:http2").ServerHttp2Session>();
  server.on("session", s => {
    sessions.add(s);
    s.on("close", () => sessions.delete(s));
  });
  // Track raw TCP sockets too: a client connection that handshook but never
  // became an h2 session (ALPN miss / mid-handshake reset) is invisible to
  // `sessions`, and net.Server.close() will block on it.
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", s => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  server.on("clientError", () => {});

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;

  return {
    origin: `https://localhost:${port}`,
    close: () =>
      new Promise(resolve => {
        for (const s of sessions) s.destroy();
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

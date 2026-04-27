// Minimal stand-in for the wptserve endpoints the vendored .h2.any.js
// files hit. Routes by URL suffix so the WPT files' hardcoded paths
// (../resources/foo.py, /xhr/..., /fetch/...) all resolve regardless of
// what RESOURCES_DIR prefix we feed them.

import { createSecureServer } from "node:http2";
import { once } from "node:events";
import { tls } from "harness";

export async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
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
      res.writeHead(status, { "content-type": "text/plain" });
      res.end("ok. Request was sent 1 times. 1 connections were created.");
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

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;

  return {
    origin: `https://localhost:${port}`,
    close: () =>
      new Promise(resolve => {
        for (const s of sessions) s.destroy();
        server.close(() => resolve());
      }),
  };
}

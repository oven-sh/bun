import { describe, expect, it } from "bun:test";
import { tls as tlsCert } from "harness";
import WebSocket from "ws";

// https://github.com/oven-sh/bun/issues/31396
//
// The npm `ws` package accepts TLS options as top-level options on the
// WebSocket constructor and forwards them to https.request/tls.connect:
//
//   new WebSocket("wss://host", { rejectUnauthorized: false });
//
// Bun's `ws` shim only read TLS options from `options.tls`, so top-level keys
// like `rejectUnauthorized: false` were dropped and connecting to a self-signed
// `wss://` server failed with "TLS handshake failed".
describe("ws top-level TLS options", () => {
  function serveTls() {
    return Bun.serve({
      port: 0,
      tls: { key: tlsCert.key, cert: tlsCert.cert },
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("expected websocket", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });
  }

  it("rejectUnauthorized: false connects to a self-signed server", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://localhost:${server.port}`, { rejectUnauthorized: false });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  it("a self-signed server is still rejected without rejectUnauthorized: false", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<{ message: string }>();

    const ws = new WebSocket(`wss://localhost:${server.port}`);
    ws.on("open", () => reject(new Error("unexpectedly connected to a self-signed server")));
    ws.on("error", resolve);

    const err = await promise;
    expect(err.message).toContain("TLS handshake failed");
  });
});

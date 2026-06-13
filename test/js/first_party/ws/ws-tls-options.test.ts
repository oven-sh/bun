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

  // A top-level TLS key must not shadow TLS material an agent carries: `ws`
  // forwards both to the connection. Here the agent supplies `ca` (the
  // self-signed cert is its own CA, so validation passes with the default
  // `rejectUnauthorized: true`) while the top level supplies `servername`.
  // Both must reach the handshake — a naive replace would drop the agent's `ca`.
  it("merges agent TLS options with top-level TLS options", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const agent = { connectOpts: { ca: tlsCert.cert } };
    const ws = new WebSocket(`wss://localhost:${server.port}`, { agent, servername: "localhost" });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // Node/`ws` accept `ALPNProtocols` as a string[], but Bun's native TLS parser
  // only takes string/ArrayBuffer/null. Forwarding the array form used to throw
  // a TypeError from the constructor; it must stay a no-op (WebSocket negotiates
  // subprotocols over Sec-WebSocket-Protocol, not TLS ALPN) so the rest of the
  // options still apply and the connection proceeds.
  it("ignores a string[] ALPNProtocols instead of throwing", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://localhost:${server.port}`, {
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // Node/`ws` accept `key`/`cert` as an array of `{ pem, passphrase }` objects
  // (per-key passphrases), but Bun's native parser only understands
  // string/ArrayBuffer/Blob (or arrays of those). Forwarding the object-array
  // form used to throw a TypeError from the constructor; it must stay a no-op
  // (as it was before top-level TLS forwarding) so construction doesn't throw.
  it("ignores an object-array key instead of throwing", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    // The server doesn't request a client cert, so dropping the unparseable key
    // is harmless and the connection still opens with rejectUnauthorized: false.
    const ws = new WebSocket(`wss://localhost:${server.port}`, {
      rejectUnauthorized: false,
      key: [{ pem: tlsCert.key, passphrase: "" }],
      cert: tlsCert.cert,
    });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // The bare (non-array) `{ pem, passphrase }` object form must behave the same
  // as the array-wrapped form above: the native parser has no arm for a plain
  // object, so it's skipped rather than forwarded into a constructor throw.
  it("ignores a bare object key instead of throwing", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://localhost:${server.port}`, {
      rejectUnauthorized: false,
      key: { pem: tlsCert.key, passphrase: "" },
      cert: tlsCert.cert,
    });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // An explicit Bun `tls` object is a hard override: an agent's connect options
  // (which target the proxy hop) must not leak into it. Here the explicit `tls`
  // leaves `rejectUnauthorized` at its default (true) while the agent carries
  // `rejectUnauthorized: false`. The agent's value must not disable target
  // verification, so the self-signed server is still rejected.
  it("keeps an explicit tls object authoritative over agent options", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<{ message: string }>();

    const agent = { connectOpts: { rejectUnauthorized: false } };
    const ws = new WebSocket(`wss://localhost:${server.port}`, { tls: {}, agent });
    ws.on("open", () => reject(new Error("agent rejectUnauthorized:false leaked into explicit tls")));
    ws.on("error", resolve);

    const err = await promise;
    expect(err.message).toContain("TLS handshake failed");
  });
});

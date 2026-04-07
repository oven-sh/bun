// Regression test for WebSocket upgrade request crash on non-ASCII inputs.
//
// The HTTP upgrade request is built in Zig. Before the fix, header values,
// host, path, client protocol and proxy parameters were passed from C++ as
// `ZigString` wrappers over the underlying `WTF::StringImpl`. When a
// WTFStringImpl was not 8-bit ASCII (either Latin1 with high bytes, or UTF-16),
// calling `.slice()` on the ZigString returned raw Latin1 / UTF-16 code units.
// Those bytes were then substituted into a printf-like format string and the
// resulting garbage length could cause heap corruption in mimalloc
// (`_mi_heap_realloc_zero`) during `std.fmt.allocPrint`.
//
// The fix migrates the WebSocket upgrade client FFI from ZigString to
// BunString and decodes every input with `bun.String.toUTF8(allocator)`.

import { describe, expect, test } from "bun:test";
import net from "node:net";
import { once } from "node:events";

describe("WebSocket upgrade with non-ASCII inputs", () => {
  test("Latin1 header value with high bytes is sent as UTF-8 without crashing", async () => {
    // Spin up a trivial HTTP listener that captures the raw upgrade request
    // bytes and responds with a valid 101 Switching Protocols handshake.
    const server = net.createServer();
    const receivedRequests: Buffer[] = [];
    server.on("connection", socket => {
      const chunks: Buffer[] = [];
      socket.on("data", chunk => {
        chunks.push(chunk);
        const joined = Buffer.concat(chunks);
        if (joined.includes("\r\n\r\n")) {
          receivedRequests.push(joined);
          // Extract Sec-WebSocket-Key and compute Sec-WebSocket-Accept.
          const text = joined.toString("latin1");
          const match = text.match(/sec-websocket-key:\s*([^\r\n]+)/i);
          if (!match) {
            socket.destroy();
            return;
          }
          const key = match[1];
          const crypto = require("node:crypto");
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n` +
              "\r\n",
          );
        }
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as net.AddressInfo).port;

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    // "vàlüé-ñ" contains U+00E0, U+00FC, U+00E9, U+00F1 — all in Latin1
    // range, so the underlying WTFStringImpl stays 8-bit.
    const latin1Value = "vàlüé-ñ";

    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
      headers: {
        "X-Latin1": latin1Value,
      },
    });
    ws.onopen = () => {
      ws.close();
      resolve();
    };
    ws.onerror = e => reject(new Error(String((e as any).message ?? "error")));
    await promise;
    server.close();

    expect(receivedRequests.length).toBe(1);
    // Before the fix, the upgrade request buffer would either contain raw
    // Latin1 bytes (0xE0, 0xFC, 0xE9, 0xF1) or be completely corrupted and
    // crash the runtime. With the fix, the header is emitted as proper UTF-8.
    const body = receivedRequests[0].toString("utf8");
    expect(body).toContain("X-Latin1:");
    expect(body).toContain(latin1Value);
  });

  test("does not crash when target URL path contains non-ASCII characters", async () => {
    // Target port 1 is reserved — connection will fail quickly. The point is
    // that the upgrade request build step must not crash regardless of what
    // the URL parser produces for non-ASCII path segments.
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket("ws://127.0.0.1:1/pâth/ünîcôdé");
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("does not crash when proxy target with Latin1 header + tls is unreachable", async () => {
    // Proxy + custom TLS config + non-ASCII headers — this is the combination
    // that matched the original crash backtrace. Construct, let it fail to
    // connect, and make sure nothing heap-corrupts along the way.
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket("wss://127.0.0.1:1/", {
      headers: {
        "X-Latin1": "vàlüé-ñ",
        Authorization: "Bearer tökën",
      },
      proxy: "http://127.0.0.1:2",
      tls: {
        cert: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        key: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
        rejectUnauthorized: false,
      },
    });
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("does not crash with many Latin1 headers through proxy", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const headers: Record<string, string> = {};
    for (let i = 0; i < 16; i++) {
      headers[`X-Hdr-${i}`] = `vàlüé-${i}-ñ`.repeat(4);
    }
    const ws = new WebSocket("wss://127.0.0.1:1/", {
      headers,
      proxy: "http://127.0.0.1:2",
      tls: { rejectUnauthorized: false },
    });
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("does not crash with Latin1 proxy header values", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket("ws://127.0.0.1:1/", {
      proxy: {
        url: "http://127.0.0.1:2",
        headers: {
          "X-Proxy": "prôxy-vàlüé",
        },
      },
    });
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });
});
